import { beforeEach, describe, expect, test } from "bun:test"
import { HBLog } from "../../../src/session/web/hblog"

beforeEach(() => HBLog._reset())

describe("HBLog", () => {
  test("records events per session and reads them back newest-last", () => {
    HBLog.record("s", "server", "launch", { target: "https://h" })
    HBLog.record("s", "extension", "content-mounted")
    const e = HBLog.entries("s")
    expect(e.map((x) => x.event)).toEqual(["launch", "content-mounted"])
    expect(e[0].source).toBe("server")
    expect(e[0].data).toEqual({ target: "https://h" })
    expect(typeof e[0].t).toBe("number")
  })

  test("entries limit returns the most recent N", () => {
    for (let i = 0; i < 10; i++) HBLog.record("s", "codrive", "act", { i })
    const last3 = HBLog.entries("s", 3)
    expect(last3.map((x) => (x.data as { i: number }).i)).toEqual([7, 8, 9])
  })

  test("sessions are isolated; clearSession wipes one", () => {
    HBLog.record("a", "server", "x")
    HBLog.record("b", "server", "y")
    HBLog.clearSession("a")
    expect(HBLog.entries("a")).toEqual([])
    expect(HBLog.entries("b").length).toBe(1)
  })

  test("file() is a per-session, discoverable path", () => {
    expect(HBLog.file("sess_1")).toContain("sess_1.jsonl")
    expect(HBLog.file("sess_1")).toContain("hackbrowser")
  })
})
