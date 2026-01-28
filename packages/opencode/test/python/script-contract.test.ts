import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { tmpdir } from "../fixture/fixture"

describe("python.script contract", () => {
  test("summarize-json consumes --input and --output", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/summarize-json.py")
    await using tmp = await tmpdir({})
    const input = path.join(tmp.path, "input.json")
    const output = path.join(tmp.path, "output.json")
    await Bun.write(input, JSON.stringify({ ok: true }))
    await $`${python} ${script} --input ${input} --output ${output}`.quiet()
    const text = await Bun.file(output).text()
    const data = JSON.parse(text)
    expect(data).toHaveProperty("summary")
  })
})
