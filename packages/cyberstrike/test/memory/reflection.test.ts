import { describe, expect, test } from "bun:test"
import { ToolReflection } from "../../src/memory/reflection"

const part = (state: Record<string, unknown>) => ({
  type: "message.part.updated",
  properties: {
    part: {
      id: "prt_test",
      sessionID: "ses_test",
      messageID: "msg_test",
      type: "tool",
      callID: "call_test",
      tool: "nmap",
      state,
    },
  },
})

describe("tool reflection", () => {
  test("records explicit tool errors", () => {
    expect(
      ToolReflection.failure(
        part({
          status: "error",
          error: "permission denied",
        }),
      ),
    ).toEqual({
      sessionID: "ses_test",
      callID: "call_test",
      tool: "nmap",
      title: "nmap failed",
      reason: "permission denied",
    })
  })

  test("ignores completed shell exits but records failed task outcomes", () => {
    expect(
      ToolReflection.failure(
        part({
          status: "completed",
          title: "Scan target",
          metadata: { exit: 2 },
        }),
      ),
    ).toBeUndefined()
    expect(
      ToolReflection.failure(
        part({
          status: "completed",
          metadata: { outcome: "aborted" },
        }),
      )?.reason,
    ).toBe("outcome aborted")
  })

  test("ignores successful and streaming tool updates", () => {
    expect(ToolReflection.failure(part({ status: "running", metadata: {} }))).toBeUndefined()
    expect(ToolReflection.failure(part({ status: "completed", metadata: { exit: 0 } }))).toBeUndefined()
    expect(ToolReflection.failure({ type: "message.part.delta", properties: {} })).toBeUndefined()
  })
})
