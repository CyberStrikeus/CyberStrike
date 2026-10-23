import { expect, test } from "bun:test"
import { SessionGoal } from "../../src/session/goal"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { GoalTable } from "../../src/session/session.sql"
import { tmpdir } from "../fixture/fixture"
import { Global } from "../../src/global"
import path from "path"

const model = { providerID: "alibaba", modelID: "qwen-plus" }

test("goal lifecycle preserves the objective, consumption and history", async () => {
  await using dir = await tmpdir({ config: { model: "alibaba/qwen-plus", snapshot: false } })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({ title: "Goal lifecycle" })
      const objective = "Inspect all inputs.\nVerify both outputs.\nKeep the original constraints."
      const results = await Promise.allSettled([1, 2].map(() => SessionGoal.create(session.id, { objective, model })))
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      const original = SessionGoal.get(session.id)!
      expect(original.objective).toBe(objective)
      SessionGoal.recordUsage(session.id, "step-1", 20, 2)
      SessionGoal.recordUsage(session.id, "step-1", 20, 2)
      SessionGoal.pause(session.id)
      expect(SessionGoal.shouldContinue(session.id)).toBe(false)
      const resumed = await SessionGoal.resume(session.id)
      expect(resumed.id).toBe(original.id)
      expect(resumed.objective).toBe(objective)
      expect(resumed.tokensUsed).toBe(20)
      expect(resumed.timeUsedSeconds).toBe(2)
      expect(SessionGoal.setBudget(session.id, 20).status).toBe("budget-limited")
      await expect(SessionGoal.resume(session.id)).rejects.toThrow("budget")
      expect(SessionGoal.setBudget(session.id, null).status).toBe("paused")
      await SessionGoal.resume(session.id)
      const fork = await Session.fork({ sessionID: session.id })
      expect(SessionGoal.get(fork.id)).toBeUndefined()
      SessionGoal.drop(session.id)
      const next = await SessionGoal.create(session.id, { objective: "Another objective", model })
      expect(next.id).not.toBe(original.id)
      expect(
        Database.use((db) => db.select().from(GoalTable).where(eq(GoalTable.session_id, session.id)).all())
          .map((goal) => goal.status)
          .sort(),
      ).toEqual(["active", "dropped"])
      await Session.remove(session.id)
      expect(SessionGoal.get(session.id)).toBeUndefined()
      await Session.remove(fork.id)
    },
  })
})

test("a new process pauses restored active goals without executing them", async () => {
  await using dir = await tmpdir({ config: { model: "alibaba/qwen-plus", snapshot: false } })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({ title: "Restart goal" })
      await SessionGoal.create(session.id, { objective: "Retain this objective after restart", model })
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          'import { Database } from "./src/storage/db"; import { Global } from "./src/global"; Database.Client(); console.log(Global.Path.data)',
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, XDG_DATA_HOME: path.dirname(Global.Path.data) },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(output.trim()).toBe(Global.Path.data)
      expect(SessionGoal.get(session.id)?.status).toBe("paused")
      expect(SessionGoal.get(session.id)?.objective).toBe("Retain this objective after restart")
      expect(await Session.messages({ sessionID: session.id })).toEqual([])
      await Session.remove(session.id)
    },
  })
})

test("a live process keeps exclusive ownership when another process opens the database", async () => {
  await using dir = await tmpdir({ config: { model: "alibaba/qwen-plus", snapshot: false } })
  await Instance.provide({
    directory: dir.path,
    fn: async () => {
      const session = await Session.create({ title: "Exclusive goal" })
      await SessionGoal.create(session.id, { objective: "Keep one execution owner", model })
      SessionGoal.claim(session.id)
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `import { SessionGoal } from "./src/session/goal"; if (SessionGoal.get("${session.id}")?.status !== "active") throw new Error("Live owner lost"); try { SessionGoal.claim("${session.id}"); process.exit(1) } catch (error) { if (!(error instanceof SessionGoal.Conflict)) throw error; console.log("owned") }`,
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, XDG_DATA_HOME: path.dirname(Global.Path.data) },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      expect(await new Response(child.stdout).text()).toContain("owned")
      expect(await child.exited).toBe(0)
      expect(SessionGoal.get(session.id)?.status).toBe("active")
      SessionGoal.pause(session.id)
      SessionGoal.release(session.id)
      expect((await SessionGoal.resume(session.id)).objective).toBe("Keep one execution owner")
      await Session.remove(session.id)
    },
  })
})
