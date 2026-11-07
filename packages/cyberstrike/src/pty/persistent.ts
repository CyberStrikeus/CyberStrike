import stripAnsi from "strip-ansi"
import { Instance } from "../project/instance"
import { InstanceBootstrap } from "../project/bootstrap"
import { Pty } from "./index"

// Persistent terminals: v1 PTYs created through the persistent surface, remembered with their session and directory.
// The process lives in the v1 Pty registry, so it outlives any single client connection for as long as it runs.
// Nothing is written to disk; a restart ends every terminal, the same as it does for v1 PTYs.
export namespace Persistent {
  type Socket = Parameters<typeof Pty.connect>[1]
  type Size = { cols: number; rows: number }
  export type Entry = { id: string; sessionID: string; directory: string; controlled: number }

  const entries = new Map<string, Entry>()
  let clock = 0

  // Identifies this server process in handoff tickets.
  export const instanceID = crypto.randomUUID()

  // v1 PTY state is per instance, so every call that touches a PTY runs inside the directory it was created in.
  const within = <A>(directory: string, fn: () => A | Promise<A>) =>
    Instance.provide({ directory, init: InstanceBootstrap, fn }) as Promise<A>

  // Must run inside the entry's directory. An entry whose PTY is gone is dropped here.
  const view = (entry: Entry) => {
    const live = Pty.get(entry.id)
    const out = Pty.output(entry.id)
    if (!live || !out) {
      entries.delete(entry.id)
      return
    }
    return {
      ...live,
      sessionID: entry.sessionID,
      foregroundProcess: out.process || null,
      size: { cols: out.cols, rows: out.rows },
      output: { head: out.head, tail: out.tail },
    }
  }

  // Live entries matching `keep`, most recently controlled first.
  const ranked = async (keep: (entry: Entry) => boolean) => {
    const matched = Array.from(entries.values()).filter(keep)
    await Promise.all(matched.map((entry) => within(entry.directory, () => view(entry))))
    return Array.from(entries.values())
      .filter(keep)
      .sort((a, b) => b.controlled - a.controlled)
  }

  // Plain text of the retained output: ANSI sequences removed, carriage returns folded into line breaks.
  const plain = (raw: string) => stripAnsi(raw).replace(/\r\n?/g, "\n")

  // The last `lines` rows of output, blank rows kept. The cursor sits on the last row, where a shell prompt waits.
  // Cursor movement and line wrapping are not emulated, so the cursor is an approximation of the live screen.
  const screen = (raw: string, size: Size, lines: number) => {
    const rows = plain(raw).split("\n")
    const shown = rows.slice(-lines)
    const last = rows[rows.length - 1] ?? ""
    return {
      text: shown.join("\n"),
      cols: size.cols,
      rows: size.rows,
      cursor: { x: last.length % size.cols, y: Math.min(shown.length, size.rows) - 1 },
    }
  }

  export function record(id: string) {
    return entries.get(id)
  }

  export async function exists(id: string) {
    return (await get(id)) !== undefined
  }

  export async function get(id: string) {
    const entry = entries.get(id)
    if (!entry) return
    return within(entry.directory, () => view(entry))
  }

  export async function list(sessionID: string) {
    const matched = Array.from(entries.values()).filter((entry) => entry.sessionID === sessionID)
    const views = await Promise.all(matched.map((entry) => within(entry.directory, () => view(entry))))
    return views.filter((item) => item !== undefined)
  }

  export async function create(
    sessionID: string,
    directory: string,
    input: {
      command?: string
      args: readonly string[]
      cwd?: string
      title: string
      env: Record<string, string>
      size?: Size
    },
  ) {
    return within(directory, async () => {
      const created = await Pty.create({
        command: input.command,
        args: [...input.args],
        cwd: input.cwd ?? directory,
        title: input.title,
        env: input.env,
      })
      if (input.size) await Pty.update(created.id, { size: input.size })
      const entry = { id: created.id, sessionID, directory, controlled: ++clock }
      entries.set(entry.id, entry)
      return view(entry)
    })
  }

  // Resizing takes control of the terminal. The attachment identifier the wire format carries is not modelled.
  export async function update(id: string, size: Size) {
    const entry = entries.get(id)
    if (!entry) return
    return within(entry.directory, async () => {
      if (!view(entry)) return
      await Pty.update(id, { size })
      entry.controlled = ++clock
      return view(entry)
    })
  }

  export async function remove(id: string) {
    const entry = entries.get(id)
    if (!entry) return false
    return within(entry.directory, async () => {
      if (!view(entry)) return false
      await Pty.remove(id)
      entries.delete(id)
      return true
    })
  }

  export async function shutdown() {
    const ids = Array.from(entries.keys())
    await Promise.all(ids.map((id) => remove(id)))
  }

  // Reads the session's most recently controlled terminal without taking control of it.
  export async function read(sessionID: string, lines?: number) {
    const [entry] = await ranked((item) => item.sessionID === sessionID)
    if (!entry) return null
    return within(entry.directory, () => {
      const info = view(entry)
      const out = Pty.output(entry.id)
      if (!info || !out) return null
      const size = { cols: out.cols, rows: out.rows }
      const shown = screen(out.raw, size, lines ?? out.rows)
      return {
        ptyID: entry.id,
        title: info.title,
        cwd: info.cwd,
        foregroundProcess: info.foregroundProcess,
        screen: { text: shown.text, cols: shown.cols, rows: shown.rows, cursor: shown.cursor },
      }
    })
  }

  export async function snapshot(id: string) {
    const entry = entries.get(id)
    if (!entry) return
    return within(entry.directory, () => {
      const info = view(entry)
      const out = Pty.output(id)
      if (!info || !out) return
      const shown = screen(out.raw, { cols: out.cols, rows: out.rows }, out.rows)
      return {
        info,
        text: plain(out.raw),
        // The retained raw output. Replaying it into a fresh terminal approximates the current screen.
        checkpoint: new TextEncoder().encode(out.raw),
        cursor: shown.cursor,
      }
    })
  }

  // The most recently controlled live terminal, across every session. Used by handoff.
  export async function handoff() {
    const [entry] = await ranked(() => true)
    return entry
  }

  // Attaches a socket and takes control of the terminal. Returns undefined, and closes the socket, when it is gone.
  export async function connect(id: string, ws: Socket, cursor?: number) {
    const entry = entries.get(id)
    if (!entry) {
      ws.close()
      return
    }
    return within(entry.directory, () => {
      if (!view(entry)) {
        ws.close()
        return
      }
      entry.controlled = ++clock
      return Pty.connect(id, ws, cursor)
    })
  }
}
