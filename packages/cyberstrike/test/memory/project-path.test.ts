import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Memory } from "../../src/memory"

describe("memory project paths", () => {
  test("uses the active project directory when no git worktree exists", async () => {
    const project = await fs.mkdtemp(path.join(os.homedir(), ".cyberstrike-memory-test-"))

    try {
      await Instance.provide({
        directory: project,
        fn: async () => {
          expect(Memory.getMemoryDir()).toBe(path.join(project, ".cyberstrike", "memory"))
          expect(Memory.getMemoryFile()).toBe(path.join(project, ".cyberstrike", "MEMORY.md"))

          await Memory.appendToDailyMemory("project note")
          await Memory.appendToLongTermMemory("project decision")

          expect(
            await fs.readFile(
              path.join(project, ".cyberstrike", "memory", `${new Date().toISOString().split("T")[0]}.md`),
              "utf8",
            ),
          ).toContain("project note")
          expect(await fs.readFile(path.join(project, ".cyberstrike", "MEMORY.md"), "utf8")).toContain(
            "project decision",
          )
        },
      })
    } finally {
      await fs.rm(project, { recursive: true, force: true })
    }
  })
})
