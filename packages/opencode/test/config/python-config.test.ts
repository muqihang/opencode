import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("config.python", () => {
  test("loads python config defaults", async () => {
    await using tmp = await tmpdir({
      config: {
        python: {
          allowProjectScripts: true,
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const cfg = await Config.get()
        expect(cfg.python?.allowProjectScripts ?? false).toBe(true)
        expect(cfg.python?.allowNetwork ?? false).toBe(false)
      },
    })
  })
})
