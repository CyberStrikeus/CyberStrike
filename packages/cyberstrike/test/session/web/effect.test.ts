import { beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "../../../src/session/web/effect"

beforeEach(() => Effect._reset())

describe("Effect — productive-repeat vs dead", () => {
  test("a productive click makes a control re-eligible", () => {
    expect(Effect.eligible("s", "k")).toBe(false) // never clicked
    Effect.onClick("s", "k", true)
    expect(Effect.eligible("s", "k")).toBe(true)
  })

  test("a non-productive click marks it dead — never eligible again", () => {
    Effect.onClick("s", "k", false)
    expect(Effect.eligible("s", "k")).toBe(false)
  })

  test("productive then dead stops the repeat", () => {
    Effect.onClick("s", "k", true)
    expect(Effect.eligible("s", "k")).toBe(true)
    Effect.onClick("s", "k", false)
    expect(Effect.eligible("s", "k")).toBe(false)
  })

  test("the repeat cap bounds even an endlessly-productive control", () => {
    for (let i = 0; i < Effect.REPEAT_CAP; i++) Effect.onClick("s", "k", true)
    expect(Effect.eligible("s", "k")).toBe(false) // repeats === CAP → done
  })

  test("per-session isolation", () => {
    Effect.onClick("a", "k", true)
    expect(Effect.eligible("a", "k")).toBe(true)
    expect(Effect.eligible("b", "k")).toBe(false)
  })
})
