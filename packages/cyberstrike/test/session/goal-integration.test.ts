import { expect, test } from "bun:test"
import { SessionGoal } from "../../src/session/goal"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionCompaction } from "../../src/session/compaction"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Bus } from "../../src/bus"
import { withGoal } from "../fixture/goal"
import { parseGoal } from "../../src/cli/cmd/tui/component/prompt/goal"
import { Instance } from "../../src/project/instance"

const model = { providerID: "alibaba", modelID: "qwen-plus" }

test("text stops continue internally until the no-progress guard blocks", async () => {
  await withGoal(
    () => ({ text: "The work is complete" }),
    async (sessionID, requests) => {
      await SessionGoal.create(sessionID, { objective: "Produce an artifact and verify it", model })
      await SessionPrompt.goal(sessionID)
      expect(SessionGoal.get(sessionID)?.status).toBe("blocked")
      expect(SessionGoal.get(sessionID)?.continuationCount).toBe(2)
      expect(SessionGoal.get(sessionID)?.tokensUsed).toBe(36)
      expect(requests).toHaveLength(3)
      expect(
        JSON.stringify(requests[0].messages.findLast((message) => message.role === "user")?.content),
      ).not.toContain("Keep going until the goal is complete; believe in yourself.")
      expect(JSON.stringify(requests[1].messages.findLast((message) => message.role === "user")?.content)).toContain(
        "Keep going until the goal is complete; believe in yourself.",
      )
      const messages = await Session.messages({ sessionID })
      const users = messages.filter((message) => message.info.role === "user")
      expect(
        users.every(
          (message) =>
            message.info.role === "user" &&
            message.info.origin === "goal-continuation" &&
            message.parts.every((part) => part.type === "text" && part.synthetic),
        ),
      ).toBe(true)
      expect(SessionGoal.get(sessionID)?.completedAt).toBeUndefined()
    },
  )
})

test("pause, resume and compaction retain objective and usage, while chat stays independent", async () => {
  await withGoal(
    () => ({ text: "Partial progress" }),
    async (sessionID, requests) => {
      const original = await SessionGoal.create(sessionID, { objective: "Preserve\nall deliverables", model })
      const unsubscribe = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
        if (event.properties.part.type === "step-finish" && SessionGoal.shouldContinue(sessionID))
          SessionGoal.pause(sessionID)
      })
      await SessionPrompt.goal(sessionID)
      expect(requests).toHaveLength(1)
      expect(SessionGoal.get(sessionID)?.status).toBe("paused")
      await SessionCompaction.create({ sessionID, agent: original.agent, model, auto: true })
      await SessionGoal.resume(sessionID)
      await SessionPrompt.goal(sessionID)
      expect(SessionGoal.get(sessionID)?.objective).toBe(original.objective)
      expect(SessionGoal.get(sessionID)?.id).toBe(original.id)
      expect(SessionGoal.get(sessionID)?.tokensUsed).toBe(24)
      expect(SessionGoal.get(sessionID)?.status).toBe("paused")
      unsubscribe()
      const consumed = SessionGoal.get(sessionID)!.tokensUsed
      await SessionPrompt.prompt({ sessionID, model, parts: [{ type: "text", text: "Ordinary chat" }] })
      expect(requests.at(-1)?.tools?.some((tool) => tool.function.name === "goal")).toBe(false)
      expect(SessionGoal.get(sessionID)?.tokensUsed).toBe(consumed)
    },
  )
})

test("budget exhaustion stops with the unfinished goal retained", async () => {
  await withGoal(
    () => ({ text: "Still incomplete" }),
    async (sessionID, requests) => {
      await SessionGoal.create(sessionID, { objective: "Unfinished deliverable", model, tokenBudget: 12 })
      await SessionPrompt.goal(sessionID)
      expect(requests).toHaveLength(1)
      expect(SessionGoal.get(sessionID)?.status).toBe("budget-limited")
      expect(SessionGoal.get(sessionID)?.tokensUsed).toBe(12)
      expect(SessionGoal.get(sessionID)?.completedAt).toBeUndefined()
    },
  )
})

test("abort keeps the execution slot until the turn settles", async () => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await withGoal(
    async () => {
      requested.resolve()
      await release.promise
      return { text: "Interrupted" }
    },
    async (sessionID, requests) => {
      await SessionGoal.create(sessionID, { objective: "Wait for an interruption", model })
      const running = SessionPrompt.goal(sessionID)
      await requested.promise
      SessionPrompt.cancel(sessionID, { stopCrawl: true })
      await expect(SessionPrompt.goal(sessionID)).rejects.toThrow("busy")
      release.resolve()
      await running
      SessionPrompt.assertNotBusy(sessionID)
      expect(SessionGoal.get(sessionID)?.status).toBe("paused")
      expect(requests).toHaveLength(1)
    },
  )
})

test("provider failure suspends goal execution without retrying forever", async () => {
  await withGoal(
    () => ({ status: 503 }),
    async (sessionID, requests) => {
      await SessionGoal.create(sessionID, { objective: "Finish despite an unavailable provider", model })
      await SessionPrompt.goal(sessionID)
      expect(SessionGoal.get(sessionID)?.status).toBe("blocked")
      expect(requests).toHaveLength(1)
    },
  )
})

test("failed commands and permission denials suspend continuation", async () => {
  await withGoal(
    () => ({ calls: [{ name: "bash", input: { command: "exit 3", description: "Exercise a failed command" } }] }),
    async (sessionID, requests) => {
      await SessionGoal.create(sessionID, { objective: "Run and verify a command", model })
      await SessionPrompt.goal(sessionID)
      expect(SessionGoal.get(sessionID)?.status).toBe("blocked")
      expect(requests).toHaveLength(1)
      SessionGoal.drop(sessionID)
      await Session.setPermission({ sessionID, permission: [{ permission: "bash", pattern: "*", action: "deny" }] })
      await SessionGoal.create(sessionID, { objective: "Preserve the command permission denial", model })
      await SessionPrompt.goal(sessionID)
      expect(SessionGoal.get(sessionID)?.status).toBe("blocked")
      expect(requests).toHaveLength(2)
      const parts = (await Session.messages({ sessionID })).flatMap((message) => message.parts)
      expect(parts.some((part) => part.type === "tool" && part.state.status === "error")).toBe(true)
    },
  )
})

test("typed goal parsing preserves multiline objectives and rejects invalid controls", () => {
  expect(parseGoal("/goal First deliverable\nSecond deliverable\n")).toEqual({
    op: "create",
    objective: "First deliverable\nSecond deliverable\n",
  })
  expect(parseGoal("/goal\n")).toEqual({ op: "dialog" })
  expect(parseGoal("/goal budget off")).toEqual({ op: "budget", tokenBudget: null })
  expect(() => parseGoal("/goal budget -1")).toThrow("positive")
  expect(() => parseGoal("/goal pause extra")).toThrow("no arguments")
})

test("drop retains usage reported by the in-flight call", async () => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await withGoal(
    async () => {
      requested.resolve()
      await release.promise
      return { text: "Stopped without completion" }
    },
    async (sessionID, requests) => {
      await SessionGoal.create(sessionID, { objective: "Retain usage after stopping", model })
      const running = SessionPrompt.goal(sessionID)
      await requested.promise
      SessionGoal.drop(sessionID)
      release.resolve()
      await running
      expect(SessionGoal.get(sessionID)?.status).toBe("dropped")
      expect(SessionGoal.get(sessionID)?.tokensUsed).toBe(12)
      expect(requests).toHaveLength(1)
    },
  )
})

test("instance disposal releases the goal after its execution settles", async () => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await withGoal(
    async () => {
      requested.resolve()
      await release.promise
      return { text: "Interrupted" }
    },
    async (sessionID) => {
      await SessionGoal.create(sessionID, { objective: "Retain a resumable goal after reload", model })
      const running = SessionPrompt.goal(sessionID)
      await requested.promise
      await Instance.dispose()
      release.resolve()
      await running
      expect(SessionGoal.get(sessionID)?.runner).toBeUndefined()
      expect(SessionGoal.shouldContinue(sessionID)).toBe(false)
      expect((await SessionGoal.resume(sessionID)).objective).toBe("Retain a resumable goal after reload")
    },
  )
})
