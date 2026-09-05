import { expect, test } from "bun:test"
import { SystemCapabilities } from "../../src/system/capabilities"

test("reports typed execution-plane readiness", async () => {
  const info = await SystemCapabilities.get()
  expect(SystemCapabilities.Info.parse(info)).toEqual(info)
  expect(info.hostname.length).toBeGreaterThan(0)
  expect(info.cpu.cores).toBeGreaterThan(0)
  expect(info.memory.total).toBeGreaterThan(0)
  expect(info.tools.some((tool) => tool.name === "node")).toBe(true)
})
