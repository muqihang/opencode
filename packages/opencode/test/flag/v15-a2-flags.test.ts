import { afterEach, describe, expect, test } from "bun:test"

const saved = structuredClone(process.env)

const reset = () => {
  Object.keys(process.env).forEach((key) => {
    delete process.env[key]
  })
  Object.assign(process.env, saved)
}

const load = async () => {
  const tag = crypto.randomUUID()
  const mod = await import(`../../src/flag/flag.ts?${tag}`)
  return mod.Flag
}

afterEach(() => {
  reset()
})

describe("flag.v15.a2", () => {
  test("reads orchestrator v15 a2 switch", async () => {
    delete process.env["OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2"]

    const off = await load()
    expect(off.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2).toBe(false)

    process.env["OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2"] = "1"

    const on = await load()
    expect(on.OPENCODE_EXPERIMENTAL_ORCHESTRATOR_V15_A2).toBe(true)
  })

  test("keeps offline eval gates enabled by default", async () => {
    delete process.env["OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES"]

    const flag = await load()
    expect(flag.OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES).toBe(true)
  })

  test("disables offline eval gates when env is false-like", async () => {
    process.env["OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES"] = "false"

    const off = await load()
    expect(off.OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES).toBe(false)

    process.env["OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES"] = "0"

    const zero = await load()
    expect(zero.OPENCODE_EXPERIMENTAL_OFFLINE_EVAL_GATES).toBe(false)
  })
})
