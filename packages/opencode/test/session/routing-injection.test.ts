import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("session routing injection", () => {
  test("returns pointer-only routing system prompt and writes artifacts", async () => {
    await using fixture = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await Bun.write(path.join(dir, "src", "alpha.ts"), "export const alpha = 1\n")
        await Bun.write(path.join(dir, "src", "beta.ts"), "export const beta = 2\n")
      },
    })

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const mod = await import("../../src/session/routing-injection").catch(() => null as never)
        expect(mod).not.toBeNull()

        const result = await mod.maybeRunRoutingInjection({
          step: 1,
          sessionId: "ses_routing_inject",
          messageId: "msg_routing_inject",
          intentText: "routing injection test",
          tier: "plan",
        })

        expect(result.kind).toBe("injected")
        if (result.kind !== "injected") return

        expect(result.systemPrompt).toContain("<routing>")
        expect(result.systemPrompt).toContain("</routing>")
        expect(result.systemPrompt).toContain(result.pointers.capsule)
        expect(result.systemPrompt).toContain(result.pointers.request)
        for (const item of result.pointers.results) {
          expect(result.systemPrompt).toContain(item)
        }

        // Pointer-first: prompt should reference capsule path, not embed capsule content.
        expect(result.systemPrompt).not.toContain("# Routing Capsule")

        const artifactRootAbs = path.join(Instance.worktree, result.artifactRoot)
        expect(await Bun.file(path.join(artifactRootAbs, result.pointers.request)).exists()).toBe(true)
        expect(await Bun.file(path.join(artifactRootAbs, result.pointers.capsule)).exists()).toBe(true)
        for (const item of result.pointers.results) {
          expect(await Bun.file(path.join(artifactRootAbs, item)).exists()).toBe(true)
        }
      },
    })
  })

  test("skips routing injection for non-first steps", async () => {
    const mod = await import("../../src/session/routing-injection").catch(() => null as never)
    expect(mod).not.toBeNull()

    const result = await mod.maybeRunRoutingInjection({
      step: 2,
      sessionId: "ses_routing_inject",
      messageId: "msg_routing_inject",
      intentText: "routing injection test",
      tier: "plan",
    })
    expect(result.kind).toBe("none")
  })

  test("skips routing injection for child sessions", async () => {
    const mod = await import("../../src/session/routing-injection").catch(() => null as never)
    expect(mod).not.toBeNull()

    const result = await mod.maybeRunRoutingInjection({
      step: 1,
      sessionId: "ses_child",
      messageId: "msg_child",
      parentSessionId: "ses_parent",
      intentText: "routing injection test",
      tier: "plan",
    })
    expect(result.kind).toBe("none")
  })
})

