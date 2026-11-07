import { expect, test } from "bun:test"
import { projectEvent } from "../src/events"

test("a text delta on the text field maps to session.text.delta", () => {
  const event = projectEvent({
    type: "message.part.delta",
    properties: { sessionID: "ses_1", messageID: "msg_1", partID: "prt_1", field: "text", delta: "hi" },
  })
  expect(event).toEqual({
    type: "session.text.delta",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "hi" },
  })
})

test("a delta on another field has no v2 counterpart", () => {
  expect(
    projectEvent({
      type: "message.part.delta",
      properties: { sessionID: "ses_1", messageID: "msg_1", partID: "prt_1", field: "input", delta: "{" },
    }),
  ).toBeUndefined()
})

test("an assistant message update maps to session.message.content.updated", () => {
  const event = projectEvent({
    type: "message.updated",
    properties: { info: { id: "msg_1", sessionID: "ses_1", role: "assistant" } },
  })
  expect(event?.type).toBe("session.message.content.updated")
})

test("a new permission request maps to permission.asked with its action and resources", () => {
  const event = projectEvent({
    type: "permission.asked",
    properties: { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: ["ls"], metadata: {}, always: [] },
  })
  expect(event).toEqual({
    type: "permission.asked",
    data: { id: "per_1", sessionID: "ses_1", action: "bash", resources: ["ls"], metadata: {} },
  })
})

test("an unknown v1 event type is dropped", () => {
  expect(projectEvent({ type: "lsp.updated", properties: {} })).toBeUndefined()
})

test("text deltas and endings preserve the resolved content ordinal", () => {
  expect(
    projectEvent(
      {
        type: "message.part.delta",
        properties: {
          sessionID: "ses_1",
          messageID: "msg_1",
          partID: "prt_2",
          field: "text",
          delta: "second",
        },
      },
      2,
    )?.data.ordinal,
  ).toBe(2)
  expect(
    projectEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_1",
            messageID: "msg_1",
            id: "prt_2",
            type: "text",
            text: "second",
          },
        },
      },
      2,
    )?.data.ordinal,
  ).toBe(2)
})

test("question events use the same form IDs as list responses", () => {
  expect(
    projectEvent({
      type: "question.asked",
      properties: {
        id: "que_1",
        sessionID: "ses_1",
        questions: [{ header: "pick", question: "Which?", options: [{ label: "A" }] }],
      },
    })?.data,
  ).toMatchObject({ form: { id: "frm_1" } })
  expect(
    projectEvent({
      type: "question.replied",
      properties: {
        requestID: "que_1",
        sessionID: "ses_1",
        answers: [["A"]],
      },
    })?.data,
  ).toEqual({ id: "frm_1", sessionID: "ses_1", answer: { "question-0": "A" } })
  expect(
    projectEvent({ type: "question.rejected", properties: { requestID: "que_1", sessionID: "ses_1" } })?.data,
  ).toEqual({ id: "frm_1", sessionID: "ses_1" })
})
