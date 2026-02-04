import { afterEach, describe, expect, test } from "bun:test"

const original = structuredClone(process.env)

const resetEnv = () => {
  Object.keys(process.env).forEach((key) => {
    delete process.env[key]
  })
  Object.assign(process.env, original)
}

const loadFlag = async () => {
  const suffix = crypto.randomUUID()
  const module = await import(`../../src/flag/flag.ts?${suffix}`)
  return module.Flag
}

afterEach(() => {
  resetEnv()
})

describe("flag.orchestrator", () => {
  test("reads OPENCODE_EXPERIMENTAL_ORCHESTRATOR independently", async () => {
    process.env["OPENCODE_EXPERIMENTAL"] = "1"
    delete process.env["OPENCODE_EXPERIMENTAL_ORCHESTRATOR"]

    const flag = await loadFlag()
    expect(flag.OPENCODE_EXPERIMENTAL_ORCHESTRATOR).toBe(false)

    process.env["OPENCODE_EXPERIMENTAL_ORCHESTRATOR"] = "1"

    const enabled = await loadFlag()
    expect(enabled.OPENCODE_EXPERIMENTAL_ORCHESTRATOR).toBe(true)
  })

  test("parses OPENCODE_ORCHESTRATOR_UX_MODE values", async () => {
    process.env["OPENCODE_ORCHESTRATOR_UX_MODE"] = "DeEp"

    const flag = await loadFlag()
    expect(flag.OPENCODE_ORCHESTRATOR_UX_MODE).toBe("deep")

    process.env["OPENCODE_ORCHESTRATOR_UX_MODE"] = "invalid"

    const invalid = await loadFlag()
    expect(invalid.OPENCODE_ORCHESTRATOR_UX_MODE).toBeUndefined()
  })
})
