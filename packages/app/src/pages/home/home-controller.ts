import { useGlobal } from "@/context/global"
import { type HomeProjectSelection, useLayout } from "@/context/layout"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { toggleHomeProjectSelection } from "@/pages/layout/helpers"
import { createEffect, createMemo } from "solid-js"

export function createHomeController() {
  const sync = useServerSync()
  const layout = useLayout()
  const server = useServer()
  const global = useGlobal()
  const tabs = useTabs()
  const selection = layout.home.selection
  const focusedServer = createMemo(
    () => global.servers.list().find((conn) => ServerConnection.key(conn) === selection().server) ?? server.current,
  )
  const focusedServerCtx = createMemo(() => {
    const conn = focusedServer()
    if (!conn) return undefined
    return global.ensureServerCtx(conn)
  })
  // This fork's useServerSync() returns the sync surface object directly (the
  // single-server adapter), not an accessor like upstream's multi-server hook.
  const focusedSync = () => focusedServerCtx()?.sync ?? sync
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? layout.projects.list())
  const recentlyClosed = createMemo(() => focusedServerCtx()?.projects.recentlyClosed() ?? [])
  const homedir = createMemo(() => focusedSync().data.path.home ?? "")
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))
  const newSessionProject = createMemo(
    () =>
      selectedProject() ??
      projects().find((project) => project.worktree === focusedServerCtx()?.projects.last()) ??
      projects()[0],
  )

  createEffect(() => {
    const list = global.servers.list()
    if (list.some((conn) => ServerConnection.key(conn) === selection().server)) return
    const conn = list.find((conn) => ServerConnection.key(conn) === server.key) ?? list[0]
    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })

  function setSelection(next: HomeProjectSelection) {
    layout.home.setSelection(next)
  }

  function openProjectNewSession(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory })
  }

  return {
    selection: {
      value: selection,
      set: setSelection,
      focusServer: (conn: ServerConnection.Any) => setSelection({ server: ServerConnection.key(conn) }),
    },
    server: {
      list: global.servers.list,
      health: (conn: ServerConnection.Any) => global.servers.health[ServerConnection.key(conn)],
      context: (conn: ServerConnection.Any) => global.ensureServerCtx(conn),
      focused: focusedServer,
      focusedContext: focusedServerCtx,
      focusedSync,
    },
    project: {
      list: projects,
      recentlyClosed,
      homedir,
      selected: selectedProject,
      newSession: newSessionProject,
      forServer: (conn: ServerConnection.Any) => global.ensureServerCtx(conn).projects.list(),
      select: (conn: ServerConnection.Any, directory: string) => {
        const key = ServerConnection.key(conn)
        if (global.servers.health[key]?.healthy === false) return
        if (
          !global
            .ensureServerCtx(conn)
            .projects.list()
            .some((project) => project.worktree === directory)
        )
          return
        setSelection(toggleHomeProjectSelection(selection(), key, directory))
      },
      // Single-server mapping: upstream inspects the target directory via the
      // per-server SDK (file.list / project.current / project.initGit) before
      // opening. This fork opens the directory through the shared project store
      // (which loads its sessions); the empty-directory git-init nicety is
      // omitted — an added directory is simply opened and selected.
      add: (conn: ServerConnection.Any, directories: string[]) => {
        const directory = directories[0]
        if (!directory) return
        const ctx = global.ensureServerCtx(conn)
        directories.forEach((item) => {
          if (ctx.projects.list().some((project) => project.worktree === item)) return
          ctx.projects.open(item)
        })
        ctx.projects.touch(directory)
        setSelection({ server: ServerConnection.key(conn), directory })
      },
      openNewSession: () => {
        const conn = focusedServer()
        const project = newSessionProject()
        if (!conn || !project) return
        openProjectNewSession(conn, project.worktree)
      },
      openProjectNewSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>
