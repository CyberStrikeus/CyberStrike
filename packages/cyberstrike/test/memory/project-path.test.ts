import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Memory } from "../../src/memory"
import { tmpdir } from "../fixture/fixture"

describe("memory project paths", () => {
  test("uses the active project directory when no git worktree exists", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Memory.getMemoryDir()).toBe(path.join(tmp.path, ".cyberstrike", "memory"))
        expect(Memory.getMemoryFile()).toBe(path.join(tmp.path, ".cyberstrike", "MEMORY.md"))

        await Memory.appendToDailyMemory("project note")
        await Memory.appendToLongTermMemory("project decision")

        expect(await Bun.file(Memory.getDailyMemoryFile()).text()).toContain("project note")
        expect(await Bun.file(Memory.getMemoryFile()).text()).toContain("project decision")
      },
    })
  })
})
