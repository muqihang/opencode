import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import {
  computeFileSha256,
  ensureVenv,
  pipFreeze,
  pipInstallOffline,
  pipInstallOnline,
  resolveVenvDir,
  resolveVenvPythonPath,
} from "../../src/python/env"

describe("python env helpers", () => {
  test("computeFileSha256 returns deterministic hash", async () => {
    await using tmp = await tmpdir()
    const filePath = path.join(tmp.path, "sample.txt")
    await Bun.write(filePath, "hello")
    const hash = await computeFileSha256(filePath)
    expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
  })

  test("resolveVenvDir is deterministic under .opencode", () => {
    const resolved = resolveVenvDir({ baseDir: "/tmp/project", venvKey: "abc" })
    expect(resolved).toBe(path.join("/tmp/project", ".opencode", "runtime", "python", "venv", "abc"))
  })

  test("resolveVenvPythonPath uses platform layout", () => {
    const venvDir = "/tmp/venv"
    const expected =
      process.platform === "win32"
        ? path.join(venvDir, "Scripts", "python.exe")
        : path.join(venvDir, "bin", "python")
    expect(resolveVenvPythonPath(venvDir)).toBe(expected)
  })

  test("ensureVenv creates venv with python3", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir()
    const venvDir = path.join(tmp.path, ".opencode", "runtime", "python", "venv", "base")
    await ensureVenv({ pythonPath: python, venvDir })
    const venvPython = resolveVenvPythonPath(venvDir)
    const exists = await Bun.file(venvPython).exists()
    expect(exists).toBe(true)
  })

  test("pipFreeze returns output for a fresh venv", async () => {
    const python = Bun.which("python3")
    if (!python) return
    await using tmp = await tmpdir()
    const venvDir = path.join(tmp.path, ".opencode", "runtime", "python", "venv", "freeze")
    await ensureVenv({ pythonPath: python, venvDir })
    const venvPython = resolveVenvPythonPath(venvDir)
    const output = await pipFreeze({ venvPython })
    expect(typeof output).toBe("string")
  })

  test("pipInstallOffline reports error when python is missing", async () => {
    await using tmp = await tmpdir()
    const wheelhouse = path.join(tmp.path, "wheelhouse")
    const lockFile = path.join(tmp.path, "requirements.txt")
    await Bun.write(lockFile, "")
    await Bun.write(path.join(wheelhouse, ".keep"), "")
    const result = await pipInstallOffline({
      venvPython: path.join(tmp.path, "missing-python"),
      wheelhousePath: wheelhouse,
      lockFile,
      timeoutMs: 1000,
    })
    expect(result.ok).toBe(false)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  test("pipInstallOnline reports error when python is missing", async () => {
    await using tmp = await tmpdir()
    const lockFile = path.join(tmp.path, "requirements.txt")
    await Bun.write(lockFile, "")
    const result = await pipInstallOnline({
      venvPython: path.join(tmp.path, "missing-python"),
      lockFile,
      timeoutMs: 1000,
    })
    expect(result.ok).toBe(false)
    expect(result.stderr.length).toBeGreaterThan(0)
  })
})
