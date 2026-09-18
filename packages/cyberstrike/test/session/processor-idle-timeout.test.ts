// Stream idle-timeout (issue #38 follow-up): a provider stream that yields nothing for too long must
// be abandoned with a RETRYABLE error instead of parking the loop forever. These cover the pure
// timeout helper — no provider/LLM involved.
import { describe, test, expect } from "bun:test"
import { SessionProcessor } from "../../src/session/processor"
import { MessageV2 } from "../../src/session/message-v2"

describe("SessionProcessor.nextWithIdleTimeout", () => {
  test("returns the next value when the stream yields in time", async () => {
    const it = (async function* () {
      yield 1
      yield 2
    })()[Symbol.asyncIterator]()
    const step = await SessionProcessor.nextWithIdleTimeout(it, 1000)
    expect(step.done).toBe(false)
    expect(step.value).toBe(1)
  })

  test("signals done at end of stream", async () => {
    const it = (async function* () {})()[Symbol.asyncIterator]()
    const step = await SessionProcessor.nextWithIdleTimeout(it, 1000)
    expect(step.done).toBe(true)
  })

  test("rejects with a retryable APIError when the stream stalls past idleMs", async () => {
    const it = { next: () => new Promise<IteratorResult<number>>(() => {}) } as AsyncIterator<number> // never settles
    let err: unknown
    await SessionProcessor.nextWithIdleTimeout(it, 20).catch((e) => (err = e))
    expect(err).toBeDefined()
    expect(MessageV2.APIError.isInstance(err)).toBe(true)
    // retryable → flows into the existing retry path (fresh request) rather than surfacing immediately
    expect((err as MessageV2.APIError).data.isRetryable).toBe(true)
    expect((err as MessageV2.APIError).data.message).toContain("stalled")
  })

  test("idleMs=0 disables the timeout (a slow-but-live stream is not rejected)", async () => {
    let resolved = false
    const it = {
      next: () =>
        new Promise<IteratorResult<number>>((r) =>
          setTimeout(() => {
            resolved = true
            r({ value: 7, done: false })
          }, 40),
        ),
    } as AsyncIterator<number>
    const step = await SessionProcessor.nextWithIdleTimeout(it, 0)
    expect(resolved).toBe(true)
    expect(step.done).toBe(false)
    expect(step.value).toBe(7)
  })
})
