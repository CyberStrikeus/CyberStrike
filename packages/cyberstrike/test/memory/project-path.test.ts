import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
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

        expect(
          await fs.readFile(
            path.join(tmp.path, ".cyberstrike", "memory", `${new Date().toISOString().split("T")[0]}.md`),
            "utf8",
          ),
        ).toContain("project note")
        expect(await fs.readFile(path.join(tmp.path, ".cyberstrike", "MEMORY.md"), "utf8")).toContain(
          "project decision",
        )
      },
    })
  })
})
