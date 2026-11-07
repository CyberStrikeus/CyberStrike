// HackBrowser 2.0 diagnostic log — a per-session, cross-layer event trail.
//
// Co-driving spans server + extension + content script, and a break anywhere shows up as
// silence. This store records every layer's events into one session-keyed stream: kept in
// memory (served by GET /web/log) AND appended to a JSONL file on disk, so the events can be
// inspected without copy-pasting a service-worker console. The extension POSTs its own events
// to /web/log, so the ABSENCE of extension events is itself the signal (the extension isn't
// running the current code / isn't reaching this server / CfT didn't load it).
import path from "path"
import fs from "fs"
import { Global } from "../../global"
import { Log } from "../../util/log"

const log = Log.create({ service: "hblog" })

export namespace HBLog {
  export interface Entry {
    t: number
    source: string // "server" | "codrive" | "extension" | "content"
    event: string
    data?: unknown
  }
  const CAP = 3000 // per-session in-memory ring
  const bySession = new Map<string, Entry[]>()
  const announced = new Set<string>()
  const DIR = path.join(Global.Path.log, "hackbrowser")

  export function file(sessionID: string): string {
    return path.join(DIR, `${sessionID}.jsonl`)
  }

  export function record(sessionID: string, source: string, event: string, data?: unknown): void {
    const entry: Entry = { t: Date.now(), source, event, ...(data !== undefined ? { data } : {}) }
    let arr = bySession.get(sessionID)
    if (!arr) {
      arr = []
      bySession.set(sessionID, arr)
    }
    arr.push(entry)
    if (arr.length > CAP) arr.splice(0, arr.length - CAP) // bound memory
    // Mirror to the terminal too, so `bun run dev` shows it live.
    log.info(`${source}:${event}`, { sessionID, ...(data && typeof data === "object" ? (data as object) : data !== undefined ? { data } : {}) })
    // Persist so it can be read back later (the whole point — I can Read this file).
    try {
      fs.mkdirSync(DIR, { recursive: true })
      fs.appendFileSync(file(sessionID), JSON.stringify(entry) + "\n")
      if (!announced.has(sessionID)) {
        announced.add(sessionID)
        log.info("hackbrowser log file", { sessionID, file: file(sessionID) })
      }
    } catch (e) {
      // Diagnostics must never break the flow they observe.
      log.debug("hblog file append failed", { err: String(e) })
    }
  }

  export function entries(sessionID: string, limit = 1000): Entry[] {
    const arr = bySession.get(sessionID) ?? []
    return limit > 0 ? arr.slice(-limit) : arr.slice()
  }

  export function clearSession(sessionID: string): void {
    bySession.delete(sessionID)
    announced.delete(sessionID)
  }
  export function _reset(): void {
    bySession.clear()
    announced.clear()
  }
}
