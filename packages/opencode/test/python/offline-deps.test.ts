import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { PythonTool } from "../../src/tool/python"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { EventV1 } from "../../src/protocol/event"

const baseCtx = {
  sessionID: "",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

function ctx(sessionID: string) {
  return { ...baseCtx, sessionID }
}

async function readEventTypes(sessionID: string) {
  const eventsPath = path.join(Instance.worktree, ".opencode", "evidence", sessionID, "events.jsonl")
  const text = await Bun.file(eventsPath).text().catch(() => "")
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => EventV1.parse(JSON.parse(line)).type)
}

describe("python deps offline-first", () => {
  test("no deps configured uses base python", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const result = await tool.execute(
          { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
          ctx("nodeps"),
        )
        expect(result.metadata.python_path.includes(`${path.sep}.opencode${path.sep}runtime${path.sep}python${path.sep}venv`)).toBe(
          false,
        )
        const lockArtifact = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "nodeps",
          "python",
          "deps-lock.sha256.txt",
        )
        const lockExists = await Bun.file(lockArtifact).exists()
        expect(lockExists).toBe(false)
      },
    })
  })

  test("offline deps with missing wheelhouse fails and records policy", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({
      git: true,
      config: {
        python: {
          deps: {
            lockFile: "requirements.txt",
          },
        },
      },
    })
    await Bun.write(path.join(tmp.path, "requirements.txt"), "")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        await expect(
          tool.execute(
            { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
            ctx("missing-wheelhouse"),
          ),
        ).rejects.toThrow()
        const lockArtifact = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "missing-wheelhouse",
          "python",
          "deps-lock.sha256.txt",
        )
        const lockExists = await Bun.file(lockArtifact).exists()
        expect(lockExists).toBe(true)
        const types = await readEventTypes("missing-wheelhouse")
        expect(types).toContain("tool.python.deps.policy")
        expect(types).toContain("tool.python.deps.offline_install_failed")
      },
    })
  })

  test("deps disabled ignores lock file", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({
      git: true,
      config: {
        python: {
          deps: {
            mode: "disabled",
            lockFile: "requirements.txt",
          },
        },
      },
    })
    await Bun.write(path.join(tmp.path, "requirements.txt"), "")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const result = await tool.execute(
          { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
          ctx("disabled"),
        )
        expect(result.metadata.python_path.includes(`${path.sep}.opencode${path.sep}runtime${path.sep}python${path.sep}venv`)).toBe(
          false,
        )
        const lockArtifact = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "disabled",
          "python",
          "deps-lock.sha256.txt",
        )
        const lockExists = await Bun.file(lockArtifact).exists()
        expect(lockExists).toBe(false)
      },
    })
  })

  test("offline deps with empty lock and wheelhouse succeeds and writes freeze", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({
      git: true,
      config: {
        python: {
          deps: {
            lockFile: "requirements.txt",
            wheelhousePath: "wheelhouse",
          },
        },
      },
    })
    await Bun.write(path.join(tmp.path, "requirements.txt"), "")
    await fs.mkdir(path.join(tmp.path, "wheelhouse"), { recursive: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const result = await tool.execute(
          { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
          ctx("offline-empty"),
        )
        expect(result.metadata.python_path.includes(`${path.sep}.opencode${path.sep}runtime${path.sep}python${path.sep}venv`)).toBe(
          true,
        )
        const lockArtifact = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "offline-empty",
          "python",
          "deps-lock.sha256.txt",
        )
        const lockText = await Bun.file(lockArtifact).text()
        expect(lockText.trim()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        const freezeArtifact = path.join(
          Instance.worktree,
          ".opencode",
          "artifacts",
          "offline-empty",
          "python",
          "pip-freeze.txt",
        )
        const freezeExists = await Bun.file(freezeArtifact).exists()
        expect(freezeExists).toBe(true)
      },
    })
  })

  test("online fallback blocked when network deny_all", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({
      git: true,
      config: {
        python: {
          allowNetwork: false,
          deps: {
            lockFile: "requirements.txt",
            wheelhousePath: "wheelhouse",
            allowOnlineFallback: true,
          },
        },
      },
    })
    await Bun.write(path.join(tmp.path, "requirements.txt"), "requests==2.0.0")
    await fs.mkdir(path.join(tmp.path, "wheelhouse"), { recursive: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const requests: Array<{ permission: string }> = []
        const testCtx = {
          ...ctx("fallback-deny"),
          ask: async (req: { permission: string }) => {
            requests.push(req)
          },
        }
        await expect(
          tool.execute(
            { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
            testCtx,
          ),
        ).rejects.toThrow()
        const permissions = requests.map((req) => req.permission)
        expect(permissions).not.toContain("python.deps_online")
      },
    })
  })

  test("online fallback requests explicit approval when allowed", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir({
      git: true,
      config: {
        python: {
          allowNetwork: true,
          deps: {
            lockFile: "requirements.txt",
            wheelhousePath: "wheelhouse",
            allowOnlineFallback: true,
          },
        },
      },
    })
    await Bun.write(path.join(tmp.path, "requirements.txt"), "requests==2.0.0")
    await fs.mkdir(path.join(tmp.path, "wheelhouse"), { recursive: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PythonTool.init()
        const requests: Array<{ permission: string }> = []
        const testCtx = {
          ...ctx("fallback-ask"),
          ask: async (req: { permission: string }) => {
            requests.push(req)
            if (req.permission === "python.deps_online") {
              throw new Error("denied")
            }
          },
        }
        await expect(
          tool.execute(
            { script_id: "summarize-json", input_json: { ok: true }, description: "Summarize JSON" },
            testCtx,
          ),
        ).rejects.toThrow()
        const permissions = requests.map((req) => req.permission)
        expect(permissions).toContain("python.deps_online")
      },
    })
  })
})
