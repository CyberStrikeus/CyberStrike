import { expect, test } from "bun:test"
import { ModelsDev } from "../../src/provider/models"

test("accepts current catalog models without legacy optional fields", () => {
  const model = ModelsDev.Model.parse({
    id: "gpt-next",
    name: "GPT Next",
    release_date: "2026-10-18",
    attachment: false,
    reasoning: true,
    reasoning_options: [{ type: "effort", values: [null, "low"] }],
    tool_call: true,
    limit: { context: 128_000, output: 32_000 },
  })
  expect(model.temperature).toBeUndefined()
  expect(model.options).toEqual({})
  expect(model.reasoning_options).toEqual([{ type: "effort", values: ["none", "low"] }])
})
