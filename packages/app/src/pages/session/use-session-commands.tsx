import { useNavigate } from "@solidjs/router"
import { useCommand, type CommandOption } from "@/context/command"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import { previewSelectedLines } from "@cyberstrike-io/session-ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { useSync } from "@/context/sync"
import { useTerminal } from "@/context/terminal"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { findLast } from "@cyberstrike-io/core/util/array"
import { createSessionTabs } from "@/pages/session/helpers"
import { extractPromptFromParts } from "@/utils/prompt"
import { Message, Part, UserMessage } from "@cyberstrike-io/sdk/v2"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSessionArchive } from "@/pages/session/session-archive"
import { createSessionOwnership } from "./session-ownership"
import { useLocal } from "@/context/local"

export type SessionCommandContext = {
  navigateMessageByOffset: (offset: number) => void
  setActiveMessage: (message: UserMessage | undefined) => void
  focusInput: () => void
  review?: () => boolean
  fileBrowser?: () => boolean
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const language = useLanguage()
  const permission = usePermission()
  const prompt = usePrompt()
  const sdk = useSDK()
  const settings = useSettings()
  const sync = useSync()
  const terminal = useTerminal()
  const layout = useLayout()
  const local = useLocal()
  const navigate = useNavigate()
  const { params, sessionKey, tabs, view } = useSessionLayout()
  const sessionOwnership = createSessionOwnership(sessionKey)
  const sessionArchive = useSessionArchive()
  const openDialog = async <T,>(load: () => Promise<T>, show: (value: T) => void) => {
    const owner = sessionOwnership.capture()
    const value = await load()
    owner.run(() => show(value))
  }
  const runCommand = async <T,>(input: {
    owner: ReturnType<ReturnType<typeof createSessionOwnership>["capture"]>
    prompt: T
    request: () => Promise<unknown>
    updatePrompt: (prompt: T) => void
    updateViewport: () => void
  }) => {
    await input.request()
    input.updatePrompt(input.prompt)
    input.owner.run(input.updateViewport)
  }

  const info = () => {
    const id = params.id
    if (!id) return
    return sync()?.session.get(id)
  }
  const hasReview = () => !!params.id
  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: actions.review,
    hasReview,
    fileBrowser: actions.fileBrowser,
  })
  const activeFileTab = tabState.activeFileTab
  const closableTab = tabState.closableTab
  const shown = settings.visibility.fileTree

  const messages = () => {
    const id = params.id
    if (!id) return []
    return sync()?.data.message[id] ?? []
  }
  const userMessages = () => messages().filter((m) => m.role === "user") as UserMessage[]
  const visibleUserMessages = () => {
    const revert = info()?.revert?.messageID
    if (!revert) return userMessages()
    const boundary = userMessages().findIndex((message) => message.id === revert)
    return boundary < 0 ? userMessages() : userMessages().slice(0, boundary)
  }

  const showAllFiles = () => {
    if (layout.fileTree.tab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content
    if (!content) return undefined
    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const canAddSelectionContext = () => {
    const tab = activeFileTab()
    if (!tab) return false
    const path = file.pathFromTab(tab)
    if (!path) return false
    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const setActiveMessage = actions.setActiveMessage
  const focusInput = actions.focusInput

  const sessionCommand = withCategory(language.t("command.category.session"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const terminalCommand = withCategory(language.t("command.category.terminal"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))
  const securityCommand = withCategory("Security")

  const isAutoAcceptActive = () => {
    const s = sdk()
    if (!s) return false
    const sessionID = params.id
    if (sessionID) return permission.isAutoAccepting(sessionID, s.directory)
    return permission.isAutoAcceptingDirectory(s.directory)
  }
  const write = async (value: string) => {
    const body = typeof document === "undefined" ? undefined : document.body
    if (body) {
      const textarea = document.createElement("textarea")
      textarea.value = value
      textarea.setAttribute("readonly", "")
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      textarea.style.pointerEvents = "none"
      body.appendChild(textarea)
      textarea.select()
      const copied = document.execCommand("copy")
      body.removeChild(textarea)
      if (copied) return true
    }

    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return false
    return clipboard.writeText(value).then(
      () => true,
      () => false,
    )
  }

  const copyShare = async (url: string, existing: boolean) => {
    if (!(await write(url))) {
      showToast({
        title: language.t("toast.session.share.copyFailed.title"),
        variant: "error",
      })
      return
    }

    showToast({
      title: existing ? language.t("session.share.copy.copied") : language.t("toast.session.share.success.title"),
      description: language.t("toast.session.share.success.description"),
      variant: "success",
    })
  }

  const share = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const existing = info()?.share?.url
    if (existing) {
      await copyShare(existing, true)
      return
    }

    const s = sdk()
    if (!s) return
    const url = await s.client.session
      .share({ sessionID })
      .then((res) => res.data?.share?.url)
      .catch(() => undefined)
    if (!url) {
      showToast({
        title: language.t("toast.session.share.failed.title"),
        description: language.t("toast.session.share.failed.description"),
        variant: "error",
      })
      return
    }

    await copyShare(url, false)
  }

  const unshare = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const s = sdk()
    if (!s) return

    await s.client.session
      .unshare({ sessionID })
      .then(() =>
        showToast({
          title: language.t("toast.session.unshare.success.title"),
          description: language.t("toast.session.unshare.success.description"),
          variant: "success",
        }),
      )
      .catch(() =>
        showToast({
          title: language.t("toast.session.unshare.failed.title"),
          description: language.t("toast.session.unshare.failed.description"),
          variant: "error",
        }),
      )
  }

  const exportSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const s = sdk()
    if (!s) return
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: s.client,
      })
      const filename = sessionExportFilename(data.info)
      downloadSessionExport(filename, data)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const openFile = () => {
    void openDialog(
      () => import("@/components/dialog-select-file"),
      (x) => dialog.show(() => <x.DialogSelectFile onOpenFile={showAllFiles} />),
    )
  }

  const closeTab = () => {
    const tab = closableTab()
    if (!tab) return
    tabs().close(tab)
  }

  const addSelection = () => {
    const tab = activeFileTab()
    if (!tab) return

    const path = file.pathFromTab(tab)
    if (!path) return

    const range = file.selectedLines(path) as SelectedLineRange | null | undefined
    if (!range) {
      showToast({
        title: language.t("toast.context.noLineSelection.title"),
        description: language.t("toast.context.noLineSelection.description"),
      })
      return
    }

    addSelectionToContext(path, selectionFromLines(range))
  }

  const openTerminal = () => {
    if (terminal.all().length > 0) terminal.new({ focus: true })
    if (terminal.all().length === 0) terminal.requestFocus()
    view().terminal.open()
  }

  const closeTerminal = () => {
    const id = terminal.active()
    if (!id) return
    const last = terminal.all().length === 1
    void terminal.close(id)
    if (last) view().terminal.close()
  }

  const chooseMcp = () => {
    void openDialog(
      () => import("@/components/dialog-select-mcp"),
      (x) => dialog.show(() => <x.DialogSelectMcp />),
    )
  }

  const renameSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const current = info()?.title ?? ""
    const title = window.prompt("Rename session", current)
    if (!title || title === current) return
    const s = sdk()
    if (!s) return
    try {
      await s.api.session.rename({ sessionID, title })
      showToast({ title: "Session renamed", variant: "success" })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      })
    }
  }

  const copyTranscript = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const s = sdk()
    if (!s) return
    try {
      const data = await fetchSessionExport({ sessionID, client: s.client })
      const text = data.messages
        .map((m) => {
          const role = m.info.role === "user" ? "User" : "Assistant"
          const parts = m.parts
            .filter((p) => p.type === "text")
            .map((p) => "text" in p ? (p as { text: string }).text : "")
            .join("\n")
          return `${role}:\n${parts}`
        })
        .join("\n\n")
      const copied = await write(text)
      showToast({
        title: copied ? "Copied to clipboard" : "Failed to copy",
        variant: copied ? "success" : "error",
      })
    } catch (err) {
      showToast({
        title: "Failed to copy transcript",
        description: err instanceof Error ? err.message : undefined,
        variant: "error",
      })
    }
  }

  const openSettingsAt = (tab: string) => {
    void import("@/components/settings-v2").then((module) => {
      const sessionID = params.id
      dialog.show(() => <module.DialogSettings sessionID={sessionID} defaultValue={tab} />)
    })
  }

  const toggleAutoAccept = () => {
    const s = sdk()
    if (!s) return
    const sessionID = params.id
    if (sessionID) permission.toggleAutoAccept(sessionID, s.directory)
    else permission.toggleAutoAcceptDirectory(s.directory)

    const active = sessionID
      ? permission.isAutoAccepting(sessionID, s.directory)
      : permission.isAutoAcceptingDirectory(s.directory)
    showToast({
      title: active
        ? language.t("toast.permissions.autoaccept.on.title")
        : language.t("toast.permissions.autoaccept.off.title"),
      description: active
        ? language.t("toast.permissions.autoaccept.on.description")
        : language.t("toast.permissions.autoaccept.off.description"),
    })
  }

  const undo = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const s = sdk()
    if (!s) return
    const owner = sessionOwnership.capture()
    const session = s.api.session
    const directory = s.directory
    const promptSession = prompt.capture()
    const revert = info()?.revert?.messageID
    const messages = userMessages()
    const boundary = revert ? messages.findIndex((message) => message.id === revert) : messages.length
    if (boundary < 0) return
    const message = messages[boundary - 1]
    if (!message) return
    const parts = sync()?.data.part[message.id]

    if (sync()?.data.session_working(sessionID)) {
      await session.interrupt({ sessionID }).catch(() => {})
    }

    await runCommand({
      owner,
      prompt: promptSession,
      request: () => session.revert.stage({ sessionID, messageID: message.id }),
      updatePrompt: (promptSession) => {
        if (parts) promptSession.set(extractPromptFromParts(parts, { directory }))
      },
      updateViewport: () => setActiveMessage(messages[boundary - 2]),
    })
  }

  const redo = async () => {
    const sessionID = params.id
    if (!sessionID) return
    const s = sdk()
    if (!s) return
    const owner = sessionOwnership.capture()
    const session = s.api.session
    const messages = userMessages()
    const promptSession = prompt.capture()

    const revertMessageID = info()?.revert?.messageID
    if (!revertMessageID) return

    const boundary = messages.findIndex((message) => message.id === revertMessageID)
    if (boundary < 0) return
    const next = messages[boundary + 1]
    if (!next) {
      await runCommand({
        owner,
        prompt: promptSession,
        request: () => session.revert.clear({ sessionID }),
        updatePrompt: (promptSession) => promptSession.reset(),
        updateViewport: () => setActiveMessage(messages.at(-1)),
      })
      return
    }

    await runCommand({
      owner,
      prompt: promptSession,
      request: () => session.revert.stage({ sessionID, messageID: next.id }),
      updatePrompt: () => undefined,
      updateViewport: () => setActiveMessage(messages[boundary]),
    })
  }

  const compact = async () => {
    const sessionID = params.id
    if (!sessionID) return

    const model = local.model.current()
    if (!model) {
      showToast({
        title: language.t("toast.model.none.title"),
        description: language.t("toast.model.none.description"),
      })
      return
    }

    const s = sdk()
    if (!s) return
    await s.api.session.compact({
      sessionID,
      model: { providerID: model.provider.id, modelID: model.id },
    })
  }

  const fork = () => {
    void openDialog(
      () => import("@/components/dialog-fork"),
      (x) => dialog.show(() => <x.DialogFork />),
    )
  }

  const shareCmds = () => {
    if (sync()?.data.config.share === "disabled") return []
    return [
      sessionCommand({
        id: "session.share",
        title: info()?.share?.url ? language.t("session.share.copy.copyLink") : language.t("command.session.share"),
        description: info()?.share?.url
          ? language.t("toast.session.share.success.description")
          : language.t("command.session.share.description"),
        slash: "share",
        disabled: !params.id,
        onSelect: share,
      }),
      sessionCommand({
        id: "session.unshare",
        title: language.t("command.session.unshare"),
        description: language.t("command.session.unshare.description"),
        slash: "unshare",
        disabled: !params.id || !info()?.share?.url,
        onSelect: unshare,
      }),
    ]
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.list",
      title: "Sessions",
      description: "Browse and switch between sessions",
      slash: { name: "sessions", aliases: ["resume", "continue"] },
      onSelect: () => {
        void openDialog(
          () => import("@/components/dialog-select-session"),
          (x) => dialog.show(() => <x.DialogSelectSession />),
        )
      },
    }),
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: { name: "new", aliases: ["clear"] },
      onSelect: (source) => {
        if (settings.general.newLayoutDesigns()) {
          command.trigger("tab.new", source)
          return
        }
        navigate(`/${params.dir}/session`)
      },
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: "undo",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: "redo",
      disabled: !params.id || !info()?.revert?.messageID,
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: { name: "compact", aliases: ["summarize"] },
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: compact,
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: "fork",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: fork,
    }),
    sessionCommand({
      id: "session.export",
      title: language.t("command.session.export"),
      description: language.t("command.session.export.description"),
      slash: "export",
      disabled: !params.id,
      onSelect: exportSession,
    }),
    sessionCommand({
      id: "session.archive",
      title: language.t("command.session.archive"),
      keybind: "mod+shift+backspace",
      disabled: !params.id,
      onSelect: () => {
        const id = params.id
        if (id) void sessionArchive.archive(id)
      },
    }),
  ]

  const fileCmds = () => {
    const tab = closableTab()
    return [
      fileCommand({
        id: "file.open",
        title: language.t("command.file.open"),
        description: language.t("palette.search.placeholder"),
        keybind: "mod+p",
        slash: "open",
        onSelect: openFile,
      }),
      tab &&
        fileCommand({
          id: "tab.close",
          title: language.t("command.tab.close"),
          keybind: "mod+w",
          onSelect: closeTab,
        }),
    ].filter((v) => !!v)
  }

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext(),
      onSelect: addSelection,
    }),
  ]

  const viewCmds = () => [
    viewCommand({
      id: "terminal.toggle",
      title: language.t("command.terminal.toggle"),
      keybind: "ctrl+`",
      slash: "terminal",
      onSelect: () => {
        if (view().terminal.opened()) {
          terminal.cancelFocus()
          view().terminal.close()
          return
        }
        terminal.requestFocus(terminal.active())
        view().terminal.open()
      },
    }),
    viewCommand({
      id: "review.toggle",
      title: language.t("command.review.toggle"),
      keybind: "mod+shift+r",
      onSelect: () => view().reviewPanel.toggle(),
    }),
    ...(shown()
      ? [
          viewCommand({
            id: "fileTree.toggle",
            title: language.t("command.fileTree.toggle"),
            keybind: "mod+\\",
            onSelect: () => layout.fileTree.toggle(),
          }),
        ]
      : []),
    viewCommand({
      id: "input.focus",
      title: language.t("command.input.focus"),
      keybind: "ctrl+l",
      onSelect: focusInput,
    }),
  ]

  const terminalCmds = () => [
    terminalCommand({
      id: "terminal.close",
      title: language.t("terminal.close"),
      keybind: "mod+w",
      hidden: true,
      when: (event) => event.target instanceof Element && !!event.target.closest('[data-component="terminal"]'),
      onSelect: closeTerminal,
    }),
    terminalCommand({
      id: "terminal.new",
      title: language.t("command.terminal.new"),
      description: language.t("command.terminal.new.description"),
      keybind: "ctrl+alt+t",
      onSelect: openTerminal,
    }),
  ]

  const messageCmds = () => [
    sessionCommand({
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      keybind: "mod+alt+[",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      keybind: "mod+alt+]",
      disabled: !params.id,
      onSelect: () => navigateMessageByOffset(1),
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: { name: "mcp", aliases: ["mcps"] },
      onSelect: chooseMcp,
    }),
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: isAutoAcceptActive()
        ? language.t("command.permissions.autoaccept.disable")
        : language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
  ]

  const extraSessionCmds = () => [
    sessionCommand({
      id: "session.rename",
      title: language.t("common.rename"),
      description: "Rename current session",
      slash: "rename",
      disabled: !params.id,
      onSelect: renameSession,
    }),
    sessionCommand({
      id: "session.copy",
      title: "Copy Transcript",
      description: "Copy session transcript to clipboard",
      slash: "copy",
      disabled: !params.id,
      onSelect: copyTranscript,
    }),
    sessionCommand({
      id: "session.timeline",
      title: "Jump to Message",
      description: "Navigate to a specific message in the session",
      slash: "timeline",
      disabled: !params.id || visibleUserMessages().length === 0,
      onSelect: () => {
        const msgs = visibleUserMessages()
        if (msgs.length === 0) return
        setActiveMessage(msgs[msgs.length - 1])
      },
    }),
  ]

  const extraViewCmds = () => [
    viewCommand({
      id: "view.thinking",
      title: settings.general.showReasoningSummaries()
        ? "Hide Thinking"
        : "Show Thinking",
      description: "Toggle AI reasoning/thinking display",
      slash: { name: "thinking", aliases: ["toggle-thinking"] },
      onSelect: () => {
        const current = settings.general.showReasoningSummaries()
        settings.general.setShowReasoningSummaries(!current)
        showToast({
          title: current ? "Thinking hidden" : "Thinking shown",
          variant: "success",
        })
      },
    }),
    viewCommand({
      id: "view.status",
      title: "View Status",
      description: "Show server and MCP connection status",
      slash: "status",
      onSelect: () => openSettingsAt("servers"),
    }),
    viewCommand({
      id: "view.help",
      title: "Help",
      description: "Show keyboard shortcuts and help",
      slash: "help",
      onSelect: () => openSettingsAt("shortcuts"),
    }),
  ]

  const hackbrowserCmds = () => [
    securityCommand({
      id: "session.hackbrowser.launch",
      title: "Launch HackBrowser",
      description: "Start a HackBrowser crawl against a target",
      slash: "hackbrowser",
      disabled: !params.id,
      onSelect: () => {
        const sessionID = params.id
        if (!sessionID) return
        void openDialog(
          () => import("@/components/dialog-hackbrowser-launch"),
          (x) => dialog.show(() => <x.DialogHackbrowserLaunch sessionID={sessionID} />),
        )
      },
    }),
    securityCommand({
      id: "session.hackbrowser.stop",
      title: "Stop HackBrowser",
      description: "Stop the active HackBrowser crawl",
      slash: "hackbrowser-stop",
      disabled: !params.id,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const s = sdk()
        if (!s) return
        try {
          await (s.client.session as any).hackbrowserStop({ sessionID })
          showToast({ title: "HackBrowser stopped", variant: "success" })
        } catch {
          showToast({ title: "No active HackBrowser crawl", variant: "error" })
        }
      },
    }),
    securityCommand({
      id: "session.bolt.select",
      title: "Bolt Templates",
      description: "Browse and select Bolt security templates",
      slash: "bolt",
      disabled: !params.id,
      onSelect: () => {
        void openDialog(
          () => import("@/components/dialog-select-bolt"),
          (x) => dialog.show(() => <x.DialogSelectBolt />),
        )
      },
    }),
    securityCommand({
      id: "session.vulnerabilities",
      title: "Vulnerabilities",
      description: "Browse discovered vulnerabilities",
      slash: { name: "vulnerabilities", aliases: ["vuln", "vulns"] },
      disabled: !params.id,
      onSelect: () => {
        void openDialog(
          () => import("@/components/dialog-select-vulnerability"),
          (x) => dialog.show(() => <x.DialogSelectVulnerability />),
        )
      },
    }),
    securityCommand({
      id: "session.queue.pause",
      title: "Pause Queue",
      description: "Pause the ingest queue for this session",
      slash: "qpause",
      disabled: !params.id,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const s = sdk()
        if (!s) return
        try {
          await (s.client.session as any).queuePause({ sessionID })
          showToast({ title: "Queue paused", variant: "success" })
        } catch {
          showToast({ title: "Failed to pause queue", variant: "error" })
        }
      },
    }),
    securityCommand({
      id: "session.queue.resume",
      title: "Resume Queue",
      description: "Resume the ingest queue for this session",
      slash: "qresume",
      disabled: !params.id,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const s = sdk()
        if (!s) return
        try {
          await (s.client.session as any).queueResume({ sessionID })
          showToast({ title: "Queue resumed", variant: "success" })
        } catch {
          showToast({ title: "Failed to resume queue", variant: "error" })
        }
      },
    }),
    securityCommand({
      id: "session.methodology",
      title: "Methodology",
      description: "View methodology coverage and state",
      slash: { name: "methodology", aliases: ["intel", "vrt", "chains"] },
      disabled: !params.id,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const s = sdk()
        if (!s) return
        try {
          const res = await (s.client as any).methodology.state({ sessionID })
          const state = res?.data
          if (!state) {
            showToast({ title: "No methodology data", variant: "error" })
            return
          }
          const covered = state.covered ?? 0
          const total = state.total ?? 0
          showToast({
            title: `Methodology: ${covered}/${total} covered`,
            description: state.phase ?? "Unknown phase",
          })
        } catch {
          showToast({ title: "Failed to load methodology", variant: "error" })
        }
      },
    }),
    securityCommand({
      id: "session.report",
      title: "Generate Report",
      description: "Compile and download the assessment report",
      slash: "report",
      disabled: !params.id,
      onSelect: async () => {
        const sessionID = params.id
        if (!sessionID) return
        const s = sdk()
        if (!s) return
        try {
          showToast({ title: "Compiling report..." })
          const res = await (s.client as any).methodology.reportCompile({ sessionID })
          if (res?.data) {
            showToast({ title: "Report compiled", variant: "success" })
          }
        } catch {
          showToast({ title: "Failed to compile report", variant: "error" })
        }
      },
    }),
  ]

  const skillCmds = () => [
    sessionCommand({
      id: "session.skills",
      title: "Skills",
      description: "Browse and use available skills",
      slash: "skills",
      onSelect: () => {
        void openDialog(
          () => import("@/components/dialog-skill-browser"),
          (x) => dialog.show(() => <x.DialogSkillBrowser />),
        )
      },
    }),
  ]

  command.register("session", () => [
    ...sessionCmds(),
    ...extraSessionCmds(),
    ...shareCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...extraViewCmds(),
    ...terminalCmds(),
    ...messageCmds(),
    ...mcpCmds(),
    ...permissionsCmds(),
    ...hackbrowserCmds(),
    ...skillCmds(),
  ])
}
