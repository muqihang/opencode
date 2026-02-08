import { describe, expect, test } from "bun:test"
import { validatePluginContract } from "../../src/plugin/contract"

describe("plugin contract", () => {
  test("keeps legacy plugins without manifest compatible", () => {
    const result = validatePluginContract({
      specifier: "legacy-plugin",
      module: {
        default: async () => ({}),
      },
      coreVersion: "1.5.0",
    })

    expect(result.ok).toBe(true)
    expect(result.manifest).toBeUndefined()
  })

  test("rejects incompatible core range", () => {
    const result = validatePluginContract({
      specifier: "range-plugin",
      module: {
        manifest: {
          specVersion: "plugin-manifest/1.0",
          name: "range-plugin",
          version: "1.0.0",
          coreRange: ">=2.0.0",
        },
      },
      coreVersion: "1.5.0",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("core_version_incompatible")
  })

  test("rejects blocked compatibility matrix entry", () => {
    const result = validatePluginContract({
      specifier: "blocked-plugin",
      module: {
        manifest: {
          specVersion: "plugin-manifest/1.0",
          name: "blocked-plugin",
          version: "1.2.0",
          coreRange: ">=1.0.0 <2.0.0",
          compatibility: [
            {
              coreRange: ">=1.0.0 <2.0.0",
              pluginRange: "^1.0.0",
              status: "blocked",
              reason: "known bug",
            },
          ],
        },
      },
      coreVersion: "1.5.0",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("compatibility_matrix_blocked")
  })

  test("rejects plugin policy patch that loosens core deny", () => {
    const result = validatePluginContract({
      specifier: "policy-plugin",
      module: {
        manifest: {
          specVersion: "plugin-manifest/1.0",
          name: "policy-plugin",
          version: "1.0.0",
          coreRange: ">=1.0.0",
          policy: {
            patch: {
              "tool.exec": "allow",
            },
          },
        },
      },
      coreVersion: "1.5.0",
      policy: {
        core: {
          "tool.exec": "deny",
        },
      },
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("policy_conflict_denied")
    expect(result.conflicts[0]?.code).toBe("policy_conflict_denied")
    expect(result.conflicts[0]?.key).toBe("tool.exec")
  })

  test("accepts supported matrix and computes effective policy", () => {
    const result = validatePluginContract({
      specifier: "ok-plugin",
      module: {
        manifest: {
          specVersion: "plugin-manifest/1.0",
          name: "ok-plugin",
          version: "1.3.0",
          coreRange: ">=1.0.0 <2.0.0",
          compatibility: [
            {
              coreRange: ">=1.0.0 <2.0.0",
              pluginRange: "^1.0.0",
              status: "supported",
            },
          ],
          policy: {
            patch: {
              "tool.read": "deny",
            },
          },
        },
      },
      coreVersion: "1.5.0",
      policy: {
        runtimeHint: {
          "tool.read": "allow",
          "tool.write": "ask",
        },
      },
    })

    expect(result.ok).toBe(true)
    expect(result.policy["tool.read"]).toBe("deny")
    expect(result.policy["tool.write"]).toBe("ask")
  })
})
