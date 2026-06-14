import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

export const TodoWriteTool = Tool.define("todowrite", {
  description: DESCRIPTION_WRITE,
  parameters: z.object({
    todos: z.array(z.object(Todo.Info.shape)).describe("The updated todo list"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const activeCount = params.todos.filter((x) => x.status === "pending" || x.status === "in_progress").length
    if (activeCount > 25) {
      return {
        title: "error",
        output:
          "Cannot have more than 25 active (pending/in_progress) todos. Consolidate related items or complete/cancel existing ones first.",
        metadata: {
          todos: params.todos,
        },
      }
    }

    await Todo.update({
      sessionID: ctx.sessionID,
      todos: params.todos,
    })
    return {
      title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
      output: JSON.stringify(params.todos, null, 2),
      metadata: {
        todos: params.todos,
      },
    }
  },
})

export const TodoReadTool = Tool.define("todoread", {
  description: "Use this tool to read your todo list",
  parameters: z.object({}),
  async execute(_params, ctx) {
    await ctx.ask({
      permission: "todoread",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const todos = await Todo.get(ctx.sessionID)
    const active = todos.filter((x) => x.status === "pending" || x.status === "in_progress")
    const doneCount = todos.length - active.length
    const output =
      doneCount > 0
        ? JSON.stringify(active, null, 2) + `\n\n(${doneCount} completed/cancelled items hidden)`
        : JSON.stringify(active, null, 2)
    return {
      title: `${active.length} todos`,
      metadata: {
        todos,
      },
      output,
    }
  },
})
