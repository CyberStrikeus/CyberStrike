import { createEffect, For, Match, Show, Switch, createMemo, createSignal, onCleanup, type JSX, type ValidComponent } from "solid-js"
import { useParams } from "@solidjs/router"
import { Tabs } from "@cyberstrike-io/ui/tabs"
import { IconButton } from "@cyberstrike-io/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@cyberstrike-io/ui/tooltip"
import { ResizeHandle } from "@cyberstrike-io/ui/resize-handle"
import { Mark } from "@cyberstrike-io/ui/logo"
import { Switch as Toggle } from "@cyberstrike-io/ui/switch"
import FileTree from "@/components/file-tree"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { DialogSelectFile } from "@/components/dialog-select-file"
import { DialogSelectMcp } from "@/components/dialog-select-mcp"
import { DialogSelectBolt } from "@/components/dialog-select-bolt"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { StickyAddButton } from "@/pages/session/review-tab"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis } from "@/utils/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useComments } from "@/context/comments"
import { useCommand } from "@/context/command"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { Icon } from "@cyberstrike-io/ui/icon"
import type { Message, UserMessage, Vulnerability } from "@cyberstrike-io/sdk/v2/client"

const statusDot = (status: string) => {
  if (status === "connected") return "bg-icon-success-base"
  if (status === "failed") return "bg-icon-danger-base"
  if (status === "needs_auth") return "bg-icon-warning-base"
  return "bg-surface-inset-base"
}

function McpPanelList() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [loading, setLoading] = createSignal<string | null>(null)

  const items = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, s]) => ({ name, status: s.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const s = sync.data.mcp[name]
      if (s?.status === "connected") await sdk.client.mcp.disconnect({ name })
      else await sdk.client.mcp.connect({ name })
      const result = await sdk.client.mcp.status()
      if (result.data) sync.set("mcp", result.data)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">
          {language.t("dialog.mcp.title")}
        </span>
        <IconButton
          icon="plus-small"
          variant="ghost"
          size="small"
          onClick={() => dialog.show(() => <DialogSelectMcp />)}
        />
      </div>
      <Show when={items().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">
          {language.t("dialog.mcp.empty")}
        </div>
      </Show>
      <For each={items()}>
        {(i) => (
          <div
            class="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-surface-raised-base cursor-pointer"
            onClick={() => toggle(i.name)}
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(i.status)}`} />
              <span class="text-12-regular truncate">{i.name}</span>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <Toggle
                checked={i.status === "connected"}
                disabled={loading() === i.name}
                onChange={() => toggle(i.name)}
              />
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

function BoltPanelList() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [loading, setLoading] = createSignal<string | null>(null)

  const items = createMemo(() =>
    Object.entries(sync.data.bolt ?? {})
      .map(([name, s]) => ({ name, status: s.status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = async (name: string) => {
    if (loading()) return
    setLoading(name)
    try {
      const s = sync.data.bolt[name]
      if (s?.status === "connected") await sdk.client.bolt.disconnect({ name })
      else await sdk.client.bolt.connect({ name })
      const result = await sdk.client.bolt.status()
      if (result.data) sync.set("bolt", result.data)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">
          {language.t("dialog.bolt.title")}
        </span>
        <IconButton
          icon="plus-small"
          variant="ghost"
          size="small"
          onClick={() => dialog.show(() => <DialogSelectBolt />)}
        />
      </div>
      <Show when={items().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">
          {language.t("dialog.bolt.empty")}
        </div>
      </Show>
      <For each={items()}>
        {(i) => (
          <div
            class="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-surface-raised-base cursor-pointer"
            onClick={() => toggle(i.name)}
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(i.status)}`} />
              <span class="text-12-regular truncate">{i.name}</span>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <Toggle
                checked={i.status === "connected"}
                disabled={loading() === i.name}
                onChange={() => toggle(i.name)}
              />
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

const severityDot = (severity: Vulnerability["severity"]) => {
  if (severity === "critical") return "bg-icon-critical-base"
  if (severity === "high") return "bg-icon-warning-base"
  if (severity === "medium") return "bg-icon-accent-base"
  return "bg-border-weak-base"
}

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const

function VulnsPanelList() {
  const sync = useSync()
  const language = useLanguage()
  const params = useParams()

  const sessionID = () => params.id ?? ""

  createEffect(() => {
    const id = sessionID()
    if (!id) return
    void sync.session.vulnerability(id)
  })

  const items = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    const list = sync.data.vulnerability?.[id] ?? []
    return list.slice().sort((a, b) => {
      const sa = severityOrder[a.severity] ?? 4
      const sb = severityOrder[b.severity] ?? 4
      if (sa !== sb) return sa - sb
      return (a.title ?? "").localeCompare(b.title ?? "")
    })
  })

  const openCount = createMemo(() => items().filter((v) => v.status !== "fixed" && v.status !== "ignored").length)

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">
          {language.t("dialog.vulnerability.title")} ({openCount()})
        </span>
      </div>
      <Show when={!sessionID()}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">
          {language.t("dialog.vulnerability.noSession")}
        </div>
      </Show>
      <Show when={sessionID() && items().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">
          {language.t("dialog.vulnerability.empty")}
        </div>
      </Show>
      <For each={items()}>
        {(v) => (
          <div
            class="flex items-start gap-2 px-2 py-1 rounded"
            classList={{ "opacity-50": v.status === "fixed" || v.status === "ignored" }}
          >
            <span class={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${severityDot(v.severity)}`} />
            <div class="flex flex-col min-w-0 flex-1">
              <span class="text-12-regular truncate">{v.title}</span>
              <span class="text-11-regular text-text-weaker truncate">
                {v.severity.toUpperCase()}
                {v.cwe_id ? ` · ${v.cwe_id}` : ""}
                {v.file ? ` · ${v.file}${v.line_start ? `:${v.line_start}` : ""}` : ""}
              </span>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

function TodoPanelList() {
  const sync = useSync()
  const language = useLanguage()
  const params = useParams()

  const sessionID = () => params.id ?? ""

  createEffect(() => {
    const id = sessionID()
    if (!id) return
    void sync.session.todo(id)
  })

  const items = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return sync.data.todo[id] ?? []
  })

  const activeCount = createMemo(() => items().filter((t) => t.status !== "completed" && t.status !== "cancelled").length)

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">
          {language.t("dialog.todo.title")} ({activeCount()})
        </span>
      </div>
      <Show when={!sessionID()}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">
          {language.t("dialog.todo.noSession")}
        </div>
      </Show>
      <Show when={sessionID() && items().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">
          {language.t("dialog.todo.empty")}
        </div>
      </Show>
      <For each={items()}>
        {(t) => (
          <div
            class="flex items-start gap-2 px-2 py-1 rounded"
            classList={{ "opacity-50": t.status === "completed" || t.status === "cancelled" }}
          >
            <Icon
              name={t.status === "completed" ? "check" : t.status === "in_progress" ? "dash" : "circle-check"}
              size="small"
              classList={{
                "shrink-0 mt-0.5": true,
                "text-icon-success-base": t.status === "completed",
                "text-icon-warning-base": t.status === "in_progress",
                "text-icon-weak": t.status === "pending" || t.status === "cancelled",
              }}
            />
            <span class="text-12-regular">{t.content}</span>
          </div>
        )}
      </For>
    </div>
  )
}

type SessionSidePanelViewModel = {
  messages: () => Message[]
  visibleUserMessages: () => UserMessage[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  info: () => ReturnType<ReturnType<typeof useSync>["session"]["get"]>
}

export function SessionSidePanel(props: {
  open: boolean
  reviewOpen: boolean
  language: ReturnType<typeof useLanguage>
  layout: ReturnType<typeof useLayout>
  command: ReturnType<typeof useCommand>
  dialog: ReturnType<typeof useDialog>
  file: ReturnType<typeof useFile>
  comments: ReturnType<typeof useComments>
  hasReview: boolean
  reviewCount: number
  reviewTab: boolean
  contextOpen: () => boolean
  openedTabs: () => string[]
  activeTab: () => string
  activeFileTab: () => string | undefined
  tabs: () => ReturnType<ReturnType<typeof useLayout>["tabs"]>
  openTab: (value: string) => void
  showAllFiles: () => void
  reviewPanel: () => JSX.Element
  vm: SessionSidePanelViewModel
  handoffFiles: () => Record<string, SelectedLineRange | null> | undefined
  codeComponent: NonNullable<ValidComponent>
  addCommentToContext: (input: {
    file: string
    selection: SelectedLineRange
    comment: string
    preview?: string
    origin?: "review" | "file"
  }) => void
  activeDraggable: () => string | undefined
  onDragStart: (event: unknown) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent) => void
  fileTreeTab: () => "changes" | "all"
  setFileTreeTabValue: (value: string) => void
  diffsReady: boolean
  diffFiles: string[]
  kinds: Map<string, "add" | "del" | "mix">
  activeDiff?: string
  focusReviewDiff: (path: string) => void
}) {
  const openedTabs = createMemo(() => props.openedTabs())

  return (
    <Show when={props.open}>
      <aside
        id="review-panel"
        aria-label={props.language.t("session.panel.reviewAndFiles")}
        class="relative min-w-0 h-full border-l border-border-weak-base flex"
        classList={{
          "flex-1": props.reviewOpen,
          "shrink-0": !props.reviewOpen,
        }}
        style={{ width: props.reviewOpen ? undefined : `${props.layout.fileTree.width()}px` }}
      >
        <Show when={props.reviewOpen}>
          <div class="flex-1 min-w-0 h-full">
            <DragDropProvider
                  onDragStart={props.onDragStart}
                  onDragEnd={props.onDragEnd}
                  onDragOver={props.onDragOver}
                  collisionDetector={closestCenter}
                >
                  <DragDropSensors />
                  <ConstrainDragYAxis />
                  <Tabs value={props.activeTab()} onChange={props.openTab}>
                    <div class="sticky top-0 shrink-0 flex">
                      <Tabs.List
                        ref={(el: HTMLDivElement) => {
                          const stop = createFileTabListSync({ el, contextOpen: props.contextOpen })
                          onCleanup(stop)
                        }}
                      >
                        <Show when={props.reviewTab}>
                          <Tabs.Trigger value="review" classes={{ button: "!pl-6" }}>
                            <div class="flex items-center gap-1.5">
                              <div>{props.language.t("session.tab.review")}</div>
                              <Show when={props.hasReview}>
                                <div class="text-12-medium text-text-strong h-4 px-2 flex flex-col items-center justify-center rounded-full bg-surface-base">
                                  {props.reviewCount}
                                </div>
                              </Show>
                            </div>
                          </Tabs.Trigger>
                        </Show>
                        <Show when={props.contextOpen()}>
                          <Tabs.Trigger
                            value="context"
                            closeButton={
                              <Tooltip value={props.language.t("common.closeTab")} placement="bottom">
                                <IconButton
                                  icon="close-small"
                                  variant="ghost"
                                  class="h-5 w-5"
                                  onClick={() => props.tabs().close("context")}
                                  aria-label={props.language.t("common.closeTab")}
                                />
                              </Tooltip>
                            }
                            hideCloseButton
                            onMiddleClick={() => props.tabs().close("context")}
                          >
                            <div class="flex items-center gap-2">
                              <SessionContextUsage variant="indicator" />
                              <div>{props.language.t("session.tab.context")}</div>
                            </div>
                          </Tabs.Trigger>
                        </Show>
                        <Tabs.Trigger value="mcp-panel">
                          <div class="flex items-center gap-1.5">MCP</div>
                        </Tabs.Trigger>
                        <Tabs.Trigger value="bolt-panel">
                          <div class="flex items-center gap-1.5">Bolt</div>
                        </Tabs.Trigger>
                        <Tabs.Trigger value="vulns-panel">
                          <div class="flex items-center gap-1.5">Vulns</div>
                        </Tabs.Trigger>
                        <Tabs.Trigger value="todo-panel">
                          <div class="flex items-center gap-1.5">Todo</div>
                        </Tabs.Trigger>
                        <SortableProvider ids={openedTabs()}>
                          <For each={openedTabs()}>
                            {(tab) => <SortableTab tab={tab} onTabClose={props.tabs().close} />}
                          </For>
                        </SortableProvider>
                        <StickyAddButton>
                          <TooltipKeybind
                            title={props.language.t("command.file.open")}
                            keybind={props.command.keybind("file.open")}
                            class="flex items-center"
                          >
                            <IconButton
                              icon="plus-small"
                              variant="ghost"
                              iconSize="large"
                              onClick={() =>
                                props.dialog.show(() => (
                                  <DialogSelectFile mode="files" onOpenFile={props.showAllFiles} />
                                ))
                              }
                              aria-label={props.language.t("command.file.open")}
                            />
                          </TooltipKeybind>
                        </StickyAddButton>
                      </Tabs.List>
                    </div>

                    <Show when={props.reviewTab}>
                      <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                        <Show when={props.activeTab() === "review"}>{props.reviewPanel()}</Show>
                      </Tabs.Content>
                    </Show>

                    <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={props.activeTab() === "empty"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                          <div class="h-full px-6 pb-42 flex flex-col items-center justify-center text-center gap-6">
                            <Mark class="w-14 opacity-10" />
                            <div class="text-14-regular text-text-weak max-w-56">
                              {props.language.t("session.files.selectToOpen")}
                            </div>
                          </div>
                        </div>
                      </Show>
                    </Tabs.Content>

                    <Show when={props.contextOpen()}>
                      <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                        <Show when={props.activeTab() === "context"}>
                          <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                            <SessionContextTab
                              messages={props.vm.messages}
                              visibleUserMessages={props.vm.visibleUserMessages}
                              view={props.vm.view}
                              info={props.vm.info}
                            />
                          </div>
                        </Show>
                      </Tabs.Content>
                    </Show>

                    <Tabs.Content value="mcp-panel" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={props.activeTab() === "mcp-panel"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-y-auto px-2">
                          <McpPanelList />
                        </div>
                      </Show>
                    </Tabs.Content>

                    <Tabs.Content value="bolt-panel" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={props.activeTab() === "bolt-panel"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-y-auto px-2">
                          <BoltPanelList />
                        </div>
                      </Show>
                    </Tabs.Content>

                    <Tabs.Content value="vulns-panel" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={props.activeTab() === "vulns-panel"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-y-auto px-2">
                          <VulnsPanelList />
                        </div>
                      </Show>
                    </Tabs.Content>

                    <Tabs.Content value="todo-panel" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={props.activeTab() === "todo-panel"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-y-auto px-2">
                          <TodoPanelList />
                        </div>
                      </Show>
                    </Tabs.Content>

                    <Show when={props.activeFileTab()} keyed>
                      {(tab) => (
                        <FileTabContent
                          tab={tab}
                          activeTab={props.activeTab}
                          tabs={props.tabs}
                          view={props.vm.view}
                          handoffFiles={props.handoffFiles}
                          file={props.file}
                          comments={props.comments}
                          language={props.language}
                          codeComponent={props.codeComponent}
                          addCommentToContext={props.addCommentToContext}
                        />
                      )}
                    </Show>
                  </Tabs>
                  <DragOverlay>
                    <Show when={props.activeDraggable()}>
                      {(tab) => {
                        const path = createMemo(() => props.file.pathFromTab(tab()))
                        return (
                          <div class="relative px-6 h-12 flex items-center bg-background-stronger border-x border-border-weak-base border-b border-b-transparent">
                            <Show when={path()}>{(p) => <FileVisual active path={p()} />}</Show>
                          </div>
                        )
                      }}
                    </Show>
                  </DragOverlay>
                </DragDropProvider>
          </div>
        </Show>

        <Show when={props.layout.fileTree.opened()}>
          <div
            id="file-tree-panel"
            class="relative shrink-0 h-full"
            style={{ width: `${props.layout.fileTree.width()}px` }}
          >
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
              classList={{ "border-l border-border-weak-base": props.reviewOpen }}
            >
              <Tabs
                variant="pill"
                value={props.fileTreeTab()}
                onChange={props.setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
              >
                <Tabs.List>
                  <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                    {props.reviewCount}{" "}
                    {props.language.t(
                      props.reviewCount === 1 ? "session.review.change.one" : "session.review.change.other",
                    )}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                    {props.language.t("session.files.all")}
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="changes" class="bg-background-base px-3 py-0">
                  <Switch>
                    <Match when={props.hasReview}>
                      <Show
                        when={props.diffsReady}
                        fallback={
                          <div class="px-2 py-2 text-12-regular text-text-weak">
                            {props.language.t("common.loading")}
                            {props.language.t("common.loading.ellipsis")}
                          </div>
                        }
                      >
                        <FileTree
                          path=""
                          allowed={props.diffFiles}
                          kinds={props.kinds}
                          draggable={false}
                          active={props.activeDiff}
                          onFileClick={(node) => props.focusReviewDiff(node.path)}
                        />
                      </Show>
                    </Match>
                    <Match when={true}>
                      <div class="mt-8 text-center text-12-regular text-text-weak">
                        {props.language.t("session.review.noChanges")}
                      </div>
                    </Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content value="all" class="bg-background-base px-3 py-0">
                  <FileTree
                    path=""
                    modified={props.diffFiles}
                    kinds={props.kinds}
                    onFileClick={(node) => props.openTab(props.file.tab(node.path))}
                  />
                </Tabs.Content>
              </Tabs>
            </div>
            <ResizeHandle
              direction="horizontal"
              edge="start"
              size={props.layout.fileTree.width()}
              min={200}
              max={480}
              collapseThreshold={160}
              onResize={props.layout.fileTree.resize}
              onCollapse={props.layout.fileTree.close}
            />
          </div>
        </Show>
      </aside>
    </Show>
  )
}
