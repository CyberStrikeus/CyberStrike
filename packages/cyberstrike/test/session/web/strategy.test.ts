import { beforeEach, describe, expect, test } from "bun:test"
import { WebStrategy } from "../../../src/session/web/strategy"
import { PageState } from "../../../src/session/web/page-state"
import { Crawl } from "../../../src/session/web/crawl"

beforeEach(() => {
  WebStrategy._reset()
  PageState._reset()
  Crawl._reset()
})

const state = (url: string): PageState.StatePayload => ({ url, title: "t", clickables: [], forms: [], links: [] })

describe("WebStrategy.ensure — cadence + caching + fallback", () => {
  test("computes once, then serves from cache on the same host", async () => {
    let calls = 0
    const reasoner = async () => {
      calls++
      return { purpose: "shop", priorities: ["cart", "checkout"] }
    }
    const p1 = await WebStrategy.ensure("s", state("https://h/a"), reasoner)
    expect(p1.priorities).toEqual(["cart", "checkout"])
    await WebStrategy.ensure("s", state("https://h/b"), reasoner) // same host → cached
    expect(calls).toBe(1)
  })

  test("recomputes when the host (area) changes", async () => {
    let calls = 0
    const reasoner = async () => {
      calls++
      return { purpose: "x", priorities: [] }
    }
    await WebStrategy.ensure("s", state("https://one.tld/a"), reasoner)
    await WebStrategy.ensure("s", state("https://two.tld/a"), reasoner) // new host → recompute
    expect(calls).toBe(2)
  })

  test("a failing reasoner caches an empty plan and never throws", async () => {
    const reasoner = async () => {
      throw new Error("no model configured")
    }
    const p = await WebStrategy.ensure("s", state("https://h/a"), reasoner)
    expect(p.purpose).toBe("")
    expect(p.priorities).toEqual([])
    expect(WebStrategy.get("s")).toBeDefined() // cached, so it won't hammer a broken model
  })

  test("caps the priorities list", async () => {
    const reasoner = async () => ({ purpose: "x", priorities: Array.from({ length: 40 }, (_, i) => `p${i}`) })
    const p = await WebStrategy.ensure("s", state("https://h/a"), reasoner)
    expect(p.priorities.length).toBe(20)
  })
})
