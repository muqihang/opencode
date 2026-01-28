import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"

describe("python.script contract", () => {
  test("summarize-json consumes --input and --output", async () => {
    const python = Bun.which("python3")
    if (!python) return
    const script = path.join(__dirname, "../../src/python/scripts/summarize-json.py")
    const input = path.join(__dirname, "input.json")
    const output = path.join(__dirname, "output.json")
    await Bun.write(input, JSON.stringify({ ok: true }))
    await $`python3 ${script} --input ${input} --output ${output}`.quiet()
    const text = await Bun.file(output).text()
    const data = JSON.parse(text)
    expect(data).toHaveProperty("summary")
  })
})
