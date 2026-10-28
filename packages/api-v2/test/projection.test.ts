import { expect, test } from "bun:test"
import { projectForm, projectMessage, projectPermission, projectSession } from "../src/projection"
import { Schema } from "effect"
import { Form } from "@opencode/schema/form"

const info = (overrides: Record<string, unknown> = {}) => ({
  id: "msg_1",
  sessionID: "ses_1",
  role: "user" as const,
  time: { created: 1 },
  agent: "build",
  ...overrides,
})

test("a user message with one text part projects to a user message", () => {
  const message = projectMessage({ info: info(), parts: [{ id: "prt_1", type: "text", text: "hello" }] })
  expect(message).toMatchObject({ id: "msg_1", type: "user", text: "hello" })
})

test("an assistant message with a text part projects to assistant content", () => {
  const message = projectMessage({
    info: info({ role: "assistant", providerID: "openai", modelID: "gpt-5" }),
    parts: [{ id: "prt_2", type: "text", text: "done" }],
  })
  expect(message).toMatchObject({
    type: "assistant",
    model: { providerID: "openai", id: "gpt-5" },
    content: [{ type: "text", text: "done" }],
  })
})

test("a tool part with status error projects to an error tool state", () => {
  const message = projectMessage({
    info: info({ role: "assistant" }),
    parts: [
      {
        id: "prt_3",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: { status: "error", input: { cmd: "ls" }, error: "AbortedError" },
      },
    ],
  })
  expect((message as { content?: unknown }).content).toEqual([
    {
      type: "tool",
      id: "call_1",
      name: "bash",
      executed: true,
      state: {
        status: "error",
        input: { cmd: "ls" },
        error: { type: "unknown", message: "AbortedError" },
        metadata: undefined,
      },
      time: { created: 0 },
    },
  ])
})

test("a part with an unknown type is skipped and the rest of the message survives", () => {
  const message = projectMessage({
    info: info({ role: "assistant" }),
    parts: [
      { id: "prt_4", type: "some-future-part" },
      { id: "prt_5", type: "text", text: "still here" },
    ],
  })
  expect((message as { content?: unknown }).content).toEqual([{ type: "text", text: "still here" }])
})

test("a compaction part projects to a compaction message", () => {
  const message = projectMessage({
    info: info({ role: "assistant" }),
    parts: [{ id: "prt_6", type: "compaction", auto: true }],
  })
  expect(message).toMatchObject({ type: "compaction", reason: "auto", status: "completed" })
})

test("a session with a directory projects its location", () => {
  const session = projectSession({
    id: "ses_1",
    projectID: "prj_1",
    directory: "/work/app",
    title: "t",
    time: { created: 1, updated: 2 },
  })
  expect(session.location).toEqual({ directory: "/work/app" })
})

test("a v1 question with two options becomes a multiselect form", () => {
  const form = projectForm({
    id: "que_1",
    sessionID: "ses_1",
    questions: [
      {
        question: "Which?",
        header: "pick",
        multiple: true,
        options: [{ label: "A" }, { label: "B" }],
      },
    ],
  })
  expect(form.fields).toEqual([
    {
      key: "question-0",
      type: "multiselect",
      title: "Which?",
      options: [
        { value: "A", label: "A" },
        { value: "B", label: "B" },
      ],
    },
  ])
  expect(form.id).toBe("frm_1")
  expect(() => Schema.decodeUnknownSync(Form.Info)(form)).not.toThrow()
})

test("a single-choice question uses the upstream string field", () => {
  const form = projectForm({
    id: "que_2",
    sessionID: "ses_1",
    questions: [{ header: "pick", question: "Which?", options: [{ label: "A" }] }],
  })
  expect(form.fields[0]?.type).toBe("string")
  expect(() => Schema.decodeUnknownSync(Form.Info)(form)).not.toThrow()
})

test("a permission request projects its id and action", () => {
  const permission = projectPermission({
    id: "per_1",
    sessionID: "ses_1",
    permission: "bash",
    patterns: [],
    metadata: {},
    always: [],
  })
  expect(permission).toMatchObject({ id: "per_1", action: "bash", resources: [] })
})
