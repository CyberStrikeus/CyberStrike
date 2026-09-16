import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSettings } from "@/components/dialog-settings"
import { type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { closeHomeProject, errorMessage, homeProjectDirectories } from "@/pages/layout/helpers"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import { createResource } from "solid-js"
import { createStore } from "solid-js/store"
import type { HomeController } from "./home-controller"

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  return host === "localhost" || host === "127.0.0.1"
}

export function createHomeProjectsController(home: HomeController) {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const notification = useNotification()
  const [_state, setState, _, ready] = persisted(
    Persist.global("home.servers", ["home.servers.v1"]),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )
  const [state] = createResource(
    () => ready.promise ?? Promise.resolve(),
    (promise) => promise.then(() => _state),
    { initialValue: _state },
  )
  function directories(project: LocalProject) {
    return [project.worktree, ...(project.sandboxes ?? [])]
  }

  function canRevealProject(conn: ServerConnection.Any) {
    return platform.platform === "desktop" && !!platform.openPath && isLocalHost(conn.http.url)
  }

  // Single-server mapping: the "add project" picker maps onto this fork's
  // existing directory-select dialog (upstream routed through a platform-aware
  // useDirectoryPicker with a v2 dialog variant).
  function pickDirectory(input: {
    title?: string
    multiple?: boolean
    onSelect: (result: string | string[] | null) => void
  }) {
    let selected = false
    const onSelect = (result: string | string[] | null) => {
      selected = result !== null
      input.onSelect(result)
    }
    const cancel = () => {
      if (!selected) input.onSelect(null)
    }
    dialog.show(() => <DialogSelectDirectory title={input.title} multiple={input.multiple} onSelect={onSelect} />, cancel)
  }

  // Single-server fork: multi-server management (default server / remove / edit)
  // is never surfaced because the home tree only renders the server row branch
  // when there is more than one connection. These are inert stubs kept for the
  // view's typed contract.
  const serverManagement = {
    canDefault: () => false,
    defaultKey: () => undefined as ServerConnection.Key | null | undefined,
    setDefault: (_key: ServerConnection.Key | null) => {},
    handleRemove: (_key: ServerConnection.Key) => {},
  }

  return {
    copy: {
      language,
    },
    selection: {
      value: home.selection.value,
    },
    server: {
      list: home.server.list,
      health: home.server.health,
      projects: home.project.forServer,
      collapsed: (conn: ServerConnection.Any) => state().collapsed[ServerConnection.key(conn)] ?? false,
      toggleCollapsed: (conn: ServerConnection.Any) => {
        const key = ServerConnection.key(conn)
        setState("collapsed", key, !state().collapsed[key])
      },
      canDefault: serverManagement.canDefault,
      defaultKey: serverManagement.defaultKey,
      setDefault: (conn: ServerConnection.Any | undefined) =>
        serverManagement.setDefault(conn ? ServerConnection.key(conn) : null),
      remove: (conn: ServerConnection.Any) => serverManagement.handleRemove(ServerConnection.key(conn)),
      edit: (_conn: ServerConnection.Http) => {},
      focus: home.selection.focusServer,
    },
    project: {
      list: home.project.list,
      recentlyClosed: home.project.recentlyClosed,
      homedir: home.project.homedir,
      select: home.project.select,
      add: home.project.add,
      openNewSession: home.project.openProjectNewSession,
      edit: (_conn: ServerConnection.Any, project: LocalProject) => {
        void import("@/components/dialog-edit-project").then(({ DialogEditProject }) => {
          void dialog.show(() => <DialogEditProject project={project} />)
        })
      },
      unseenCount: (_conn: ServerConnection.Any, project: LocalProject) => {
        return directories(project).reduce((total, directory) => total + notification.project.unseenCount(directory), 0)
      },
      clearNotifications: (_conn: ServerConnection.Any, project: LocalProject) => {
        directories(project)
          .filter((directory) => notification.project.unseenCount(directory) > 0)
          .forEach((directory) => notification.project.markViewed(directory))
      },
      choose: (conn: ServerConnection.Any) => {
        if (home.server.health(conn)?.healthy === false) return
        pickDirectory({
          title: language.t("command.project.open"),
          multiple: true,
          onSelect: (result) => home.project.add(conn, homeProjectDirectories(result)),
        })
      },
      close: (conn: ServerConnection.Any, directory: string) => {
        const next = closeHomeProject(
          home.selection.value(),
          ServerConnection.key(conn),
          home.server.context(conn).projects,
          directory,
        )
        if (next) home.selection.set(next)
      },
      move: (conn: ServerConnection.Any, worktree: string, index: number) => {
        home.server.context(conn).projects.move(worktree, index)
      },
      canReveal: canRevealProject,
      reveal: (conn: ServerConnection.Any, project: LocalProject) => {
        if (!platform.openPath || !canRevealProject(conn)) return
        platform.openPath(project.worktree).catch((cause: unknown) =>
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          }),
        )
      },
    },
    utility: {
      settings: () => dialog.show(() => <DialogSettings />),
      help: () => platform.openExternal?.("https://cyberstrike.io"),
    },
  }
}

export type HomeProjectsController = ReturnType<typeof createHomeProjectsController>
