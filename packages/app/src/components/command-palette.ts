import { getFilename } from "@cyberstrike-io/util/path"
import type { Project, Session } from "@cyberstrike-io/sdk/v2/client"
import { onCleanup } from "solid-js"
import { type CommandOption } from "@/context/command"
import { ServerConnection } from "@/context/server"
import { type LocalProject } from "@/context/layout"
import { displayName, projectForSession } from "@/pages/layout/helpers"
import { normalizeSessionInfo } from "@/utils/session"

// Scope note: upstream's `command-palette.ts` also exports `createCommandPaletteModel`
// and `createCommandPaletteFileOpener`, which power the in-session (file+command)
// palette (`DialogCommandPaletteV2`). Those depend on `@/pages/session/session-layout`
// (`useSessionLayout`) and `createSessionTabs`, which this fork's restructured
// session layer does not provide, so they are not ported here. The home command
// palette (`DialogHomeCommandPaletteV2`) uses only the entry helpers below.

export type CommandPaletteEntry = {
  id: string
  type: "command" | "file" | "session"
  title: string
  description?: string
  keybind?: string
  category: string
  option?: CommandOption
  path?: string
  directory?: string
  sessionID?: string
  server?: ServerConnection.Key
  project?: LocalProject
  archived?: number
  updated?: number
}

export function uniqueCommandPaletteEntries(items: CommandPaletteEntry[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function createCommandPaletteFileEntry(path: string, category: string): CommandPaletteEntry {
  return {
    id: "file:" + path,
    type: "file",
    title: path,
    category,
    path,
  }
}

export function createCommandPaletteCommandEntry(option: CommandOption, category: string): CommandPaletteEntry {
  return {
    id: "command:" + option.id,
    type: "command",
    title: option.title,
    description: option.description,
    keybind: option.keybind,
    category,
    option,
  }
}

export function createServerSessionEntries(props: {
  server: ServerConnection.Key
  opened: () => LocalProject[]
  stored: () => Project[]
  load: (search: string, signal: AbortSignal) => Promise<{ data: Session[] }>
  untitled: () => string
  category: () => string
}) {
  let abort: AbortController | undefined

  onCleanup(() => abort?.abort())

  return async (text: string): Promise<CommandPaletteEntry[]> => {
    const search = text.trim()
    if (!search) {
      abort?.abort()
      return []
    }
    abort?.abort()
    const current = new AbortController()
    abort = current
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 100)
      current.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true },
      )
    })
    if (current.signal.aborted) return []
    const opened = props.opened()
    const openedByID = new Map(opened.flatMap((project) => (project.id ? [[project.id, project] as const] : [])))
    const stored = props.stored().map((project) => ({ ...project, expanded: false }))
    const storedByID = new Map(stored.map((project) => [project.id, project] as const))
    return props
      .load(search, current.signal)
      .then((result) =>
        result.data
          .map(normalizeSessionInfo)
          .filter((session) => !session.time.archived)
          .map((session) => {
            const project =
              projectForSession(session, opened, openedByID) ?? projectForSession(session, stored, storedByID)
            return {
              id: `session:${props.server}:${session.id}`,
              type: "session" as const,
              title: session.title || props.untitled(),
              description: project ? displayName(project) : getFilename(session.directory),
              category: props.category(),
              directory: session.directory,
              sessionID: session.id,
              server: props.server,
              project,
              updated: session.time.updated,
            }
          }),
      )
      .catch(() => [] as CommandPaletteEntry[])
  }
}
