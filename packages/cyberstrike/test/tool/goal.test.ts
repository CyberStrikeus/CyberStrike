import { expect, test } from "bun:test"
import { SessionGoal } from "../../src/session/goal"
import { SessionPrompt } from "../../src/session/prompt"
import { Session } from "../../src/session"
import { GoalTool } from "../../src/tool/goal"
import { withGoal } from "../fixture/goal"
import type { Tool } from "../../src/tool/tool"
import z from "zod"

const model = { providerID: "alibaba", modelID: "qwen-plus" }

test("verified completion audits the original objective and stops further execution", async () => {
  await withGoal(
    (request, count) => {
      if (count === 1) return { text: "goal-proof" }
      if (count === 2) return { calls: [{ name: "goal", input: { op: "complete" } }] }
      if (count > 3) return { text: "Ordinary chat response" }
      const audit = z
        .object({ objective: z.string(), evidence: z.array(z.object({ id: z.string(), text: z.string() })) })
        .parse(JSON.parse(String(request.messages.at(-1)?.content)))
      const proof = audit.evidence.find((part) => part.text === "goal-proof")!
      return {
        text: JSON.stringify({
          complete: true,
          reason: "The exact requested text was delivered",
          checks: [{ requirement: audit.objective, evidence: [proof.id] }],
        }),
      }
    },
    async (sessionID, requests) => {
      await SessionGoal.create(sessionID, { objective: "Reply with the exact text goal-proof", model })
      await SessionPrompt.goal(sessionID)
      expect(SessionGoal.get(sessionID)?.status).toBe("completed")
      expect(SessionGoal.get(sessionID)?.report).toContain("goal-proof")
      expect(SessionGoal.get(sessionID)?.tokensUsed).toBe(36)
      expect(requests).toHaveLength(3)
      expect(requests[0].tools?.some((tool) => tool.function.name === "goal")).toBe(true)
      const other = await Session.create({ title: "Independent chat" })
      await SessionPrompt.prompt({ sessionID: other.id, model, parts: [{ type: "text", text: "Ordinary chat" }] })
      expect(requests.at(-1)?.tools?.some((tool) => tool.function.name === "goal")).toBe(false)
      expect(SessionGoal.get(other.id)).toBeUndefined()
      await Session.remove(other.id)
    },
  )
})

test("completion rejects unsupported evidence citations", async () => {
  await withGoal(
    (_request, count) =>
      count === 1
        ? { text: "I finished everything" }
        : count === 2
          ? { calls: [{ name: "goal", input: { op: "complete" } }] }
          : {
              text: JSON.stringify({
                complete: true,
                reason: "Unsupported completion claim",
                checks: [{ requirement: "Create the file", evidence: ["invented"] }],
              }),
            },
    async (sessionID) => {
      await SessionGoal.create(sessionID, { objective: "Create and verify a file", model })
      await SessionPrompt.goal(sessionID)
      expect(SessionGoal.get(sessionID)?.status).toBe("blocked")
      expect(SessionGoal.get(sessionID)?.completedAt).toBeUndefined()
    },
  )
})

test("goal tool cannot run in ordinary or paused sessions", async () => {
  await withGoal(
    () => ({ text: "Unused" }),
    async (sessionID) => {
      const tool = await GoalTool.init()
      const ctx: Tool.Context = {
        sessionID,
        messageID: "message-test",
        agent: "goaltest",
        abort: new AbortController().signal,
        messages: [],
        metadata: async () => {},
        ask: async () => {},
      }
      await expect(tool.execute({ op: "get" }, ctx)).rejects.toThrow("active primary")
      await SessionGoal.create(sessionID, { objective: "An active objective", model, tokenBudget: 100 })
      SessionGoal.recordUsage(sessionID, "used", 25)
      expect(JSON.parse((await tool.execute({ op: "get" }, ctx)).output).remainingBudget).toBe(75)
      SessionGoal.pause(sessionID)
      await expect(tool.execute({ op: "complete" }, ctx)).rejects.toThrow("active primary")
    },
  )
})

test("pause during an audit prevents completion", async () => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await withGoal(
    async (request, count) => {
      if (count === 1) return { text: "goal-proof" }
      if (count === 2) return { calls: [{ name: "goal", input: { op: "complete" } }] }
      const audit = z
        .object({ evidence: z.array(z.object({ id: z.string(), text: z.string() })) })
        .parse(JSON.parse(String(request.messages.at(-1)?.content)))
      requested.resolve()
      await release.promise
      return {
        text: JSON.stringify({
          complete: true,
          reason: "The exact text is present",
          checks: [{ requirement: "Reply with goal-proof", evidence: [audit.evidence[0].id] }],
        }),
      }
    },
    async (sessionID) => {
      await SessionGoal.create(sessionID, { objective: "Reply with goal-proof", model })
      const running = SessionPrompt.goal(sessionID)
      await requested.promise
      SessionGoal.pause(sessionID)
      release.resolve()
      await running
      expect(SessionGoal.get(sessionID)?.status).toBe("paused")
      expect(SessionGoal.get(sessionID)?.completedAt).toBeUndefined()
      expect(SessionGoal.get(sessionID)?.tokensUsed).toBe(36)
    },
  )
})
