import { describe, expect, test } from "bun:test"
import { ProviderError } from "../../src/provider/error"

describe("ProviderError.parseStreamError", () => {
  test("does not retry OpenAI cybersecurity rejections", () => {
    const error = ProviderError.parseStreamError({
      type: "error",
      sequence_number: 3,
      error: {
        type: "invalid_request",
        code: "cybersecurity_risk",
        message: "This request was flagged for possible cybersecurity risk.",
      },
    })

    expect(error).toEqual({
      type: "api_error",
      message: "This request was flagged for possible cybersecurity risk.",
      isRetryable: false,
      responseBody:
        '{"type":"error","sequence_number":3,"error":{"type":"invalid_request","code":"cybersecurity_risk","message":"This request was flagged for possible cybersecurity risk."}}',
    })
  })
})
