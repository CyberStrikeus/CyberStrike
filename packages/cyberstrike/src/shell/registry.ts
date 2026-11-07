import { spawn, type ChildProcess } from "child_process"
import { closeSync, openSync } from "fs"
import { mkdir, rm } from "fs/promises"
import path from "path"
import { Shell as Wire } from "@opencode/schema/shell"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Shell } from "./shell"

// Output is captured to a file, so a command's output never has to fit in memory.
export namespace Registry {
  export const PAGE = 64 * 1024
  export const MAX = 1024 * 1024

  export type Status = "running" | "exited" | "timeout" | "killed"

  export type Entry = {
    id: string
    status: Status
    command: string
    cwd: string
    shell: string
    file: string
    pid?: number
    exit?: number
    signal?: string
    metadata: Record<string, unknown>
    started: number
    completed?: number
    stop?: "timeout"
    child: ChildProcess
  }

  export type Page = {
    output: string
    cursor: number
    size: number
  }

  const stop = (entry: Entry) => Shell.killTree(entry.child, { exited: () => entry.status !== "running" })

  const state = Instance.state(
    async () => new Map<string, Entry>(),
    async (entries) => {
      await Promise.all([...entries.values()].filter((entry) => entry.status === "running").map(stop))
    },
  )

  // Program and args are spawned directly. Use `shell` to run a command string through the user's shell.
  export const shell = (command: string) => [Shell.acceptable(), process.platform === "win32" ? "/c" : "-c", command]

  export async function start(input: {
    argv: readonly string[]
    cwd?: string
    timeout?: number
    metadata?: Record<string, unknown>
    stderr?: boolean
  }) {
    const [program, ...args] = input.argv
    if (program === undefined) throw new Error("Command is empty")
    const cwd = path.resolve(Instance.directory, input.cwd ?? ".")
    if (!(await Filesystem.isDir(cwd))) throw new Error(`Working directory not found: ${cwd}`)

    const id = Wire.ID.create()
    const dir = path.join(Global.Path.state, "shell")
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, `${id}.log`)
    const fd = openSync(file, "a")
    const child = spawn(program, args, {
      cwd,
      env: process.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", fd, input.stderr === false ? "ignore" : fd],
    })
    closeSync(fd)

    const entries = await state()
    const entry: Entry = {
      id,
      status: "running",
      command: input.argv.join(" "),
      cwd,
      shell: program,
      file,
      pid: child.pid,
      metadata: input.metadata ?? {},
      started: Date.now(),
      child,
    }
    entries.set(id, entry)
    watch(entry)

    if (input.timeout !== undefined) {
      const timer = setTimeout(() => {
        entry.stop = "timeout"
        void stop(entry)
      }, input.timeout)
      child.once("exit", () => clearTimeout(timer))
    }

    // A command that cannot start (missing program) fails here rather than reporting a running process.
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve())
      child.once("error", (error) => reject(error))
    }).catch(async (error: unknown) => {
      entries.delete(id)
      await rm(file, { force: true })
      throw error
    })

    return entry
  }

  const watch = (entry: Entry) =>
    entry.child.once("exit", (code, signal) => {
      entry.completed = Date.now()
      entry.exit = code ?? undefined
      entry.signal = signal ?? undefined
      entry.status = entry.stop ?? (signal ? "killed" : "exited")
    })

  // Registers a child that another caller already spawned, so it is listed and killed like any other entry.
  // The caller owns the child's output: it must point the child's pipes at the returned file.
  export async function adopt(input: { child: ChildProcess; command: string; cwd: string; shell: string }) {
    const id = Wire.ID.create()
    const dir = path.join(Global.Path.state, "shell")
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, `${id}.log`)
    await Bun.write(file, "")
    const entry: Entry = {
      id,
      status: "running",
      command: input.command,
      cwd: input.cwd,
      shell: input.shell,
      file,
      pid: input.child.pid,
      metadata: {},
      started: Date.now(),
      child: input.child,
    }
    ;(await state()).set(id, entry)
    watch(entry)
    return entry
  }

  export async function get(id: string) {
    return (await state()).get(id)
  }

  export async function list() {
    return [...(await state()).values()].filter((entry) => entry.status === "running")
  }

  // Returns a page of combined output starting at an absolute byte cursor. A page never ends inside a multi-byte
  // character: pages are at least 4 bytes, the longest UTF-8 character, so every page holds a complete one.
  export async function output(id: string, cursor = 0, limit = PAGE): Promise<Page | undefined> {
    const entry = (await state()).get(id)
    if (!entry) return
    const size = Bun.file(entry.file).size
    const start = Math.min(Math.max(cursor, 0), size)
    const end = Math.min(size, start + Math.min(Math.max(limit, 4), MAX))
    const bytes = new Uint8Array(await Bun.file(entry.file).slice(start, end).arrayBuffer())
    const kept = end < size ? bytes.subarray(0, boundary(bytes) || bytes.length) : bytes
    return {
      output: new TextDecoder().decode(kept),
      cursor: start + kept.length,
      size,
    }
  }

  // Length of the bytes that end on a complete UTF-8 character. A trailing partial character is left for the next page.
  const boundary = (bytes: Uint8Array) => {
    for (let back = 1; back <= 4 && back <= bytes.length; back++) {
      const byte = bytes[bytes.length - back]
      if ((byte & 0xc0) === 0x80) continue
      const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
      return width > back ? bytes.length - back : bytes.length
    }
    return bytes.length
  }

  // Terminates the command's process tree if it is still running, then forgets it and its captured output.
  export async function remove(id: string) {
    const entries = await state()
    const entry = entries.get(id)
    if (!entry) return false
    entries.delete(id)
    await stop(entry)
    await rm(entry.file, { force: true })
    return true
  }
}
