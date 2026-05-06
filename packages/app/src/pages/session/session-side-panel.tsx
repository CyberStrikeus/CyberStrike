import {
  createEffect,
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
  type ValidComponent,
} from "solid-js"
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
  const [boltGroups, setBoltGroups] = createSignal<
    Array<{
      boltServer: string
      name: string
      type: string
      version?: string
      tools: Array<{ name: string; description: string }>
    }>
  >([])

  // Fetch MCP status on mount — bootstrap may not have completed yet
  createEffect(() => {
    sdk.client.mcp
      .status()
      .then((x) => {
        if (x.data) sync.set("mcp", x.data)
      })
      .catch(() => {})
  })

  // Fetch Bolt tool groups (re-fetch when bolt status changes)
  createEffect(() => {
    const _ = sync.data.bolt
    sdk.client.mcp
      .boltTools()
      .then((x) => {
        if (x.data) setBoltGroups(x.data)
      })
      .catch(() => {})
  })

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
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">{language.t("dialog.mcp.title")}</span>
        <IconButton
          icon="plus-small"
          variant="ghost"
          size="small"
          onClick={() => dialog.show(() => <DialogSelectMcp />)}
        />
      </div>
      <Show when={items().length === 0 && boltGroups().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("dialog.mcp.empty")}</div>
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
      <Show when={boltGroups().length > 0}>
        <div class="px-2 py-1 mt-1 border-t border-border-weak-base">
          <span class="text-11-medium text-text-weaker uppercase tracking-wider">From Bolt</span>
        </div>
        <For each={boltGroups()}>
          {(g) => (
            <div
              class="flex items-center justify-between gap-2 px-2 py-1 rounded"
              classList={{ "opacity-40": g.tools.length === 0 }}
            >
              <div class="flex items-center gap-2 min-w-0">
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  classList={{
                    "bg-icon-success-base": g.tools.length > 0,
                    "bg-surface-inset-base": g.tools.length === 0,
                  }}
                />
                <span class="text-12-regular truncate">{g.name}</span>
                <span class="text-10-medium px-1.5 py-0.5 rounded bg-surface-base text-text-weaker shrink-0">
                  {g.boltServer}
                </span>
              </div>
              <span class="text-11-regular text-text-weaker shrink-0">
                {g.tools.length} {g.tools.length === 1 ? "tool" : "tools"}
              </span>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}

function BoltPanelList() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [loading, setLoading] = createSignal<string | null>(null)

  // Fetch Bolt status on mount — bootstrap may not have completed yet
  createEffect(() => {
    sdk.client.bolt
      .status()
      .then((x) => {
        if (x.data) sync.set("bolt", x.data)
      })
      .catch(() => {})
  })

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
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">{language.t("dialog.bolt.title")}</span>
        <IconButton
          icon="plus-small"
          variant="ghost"
          size="small"
          onClick={() => dialog.show(() => <DialogSelectBolt />)}
        />
      </div>
      <Show when={items().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("dialog.bolt.empty")}</div>
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

const severityLabel = (severity: Vulnerability["severity"]) => {
  if (severity === "critical") return "CRITICAL"
  if (severity === "high") return "HIGH"
  if (severity === "medium") return "MEDIUM"
  if (severity === "low") return "LOW"
  return "INFO"
}

const severityBadge = (severity: Vulnerability["severity"]) => {
  if (severity === "critical") return "bg-surface-critical-base text-text-critical-base"
  if (severity === "high") return "bg-surface-warning-base text-text-warning-base"
  if (severity === "medium") return "bg-surface-accent-base text-text-accent-base"
  return "bg-surface-base text-text-weaker"
}

const statusLabel = (status: string) => {
  if (status === "fixed") return "Fixed"
  if (status === "ignored") return "Ignored"
  return "Open"
}

function formatVulnForClipboard(v: {
  title: string
  severity: string
  status?: string
  cwe_id?: string
  endpoint?: string
  attack_vector?: string
  description?: string
  steps_to_reproduce?: string
  poc?: string
  business_impact?: string
  recommendation?: string
}): string {
  const lines: string[] = []
  lines.push(`# [${v.severity.toUpperCase()}] ${v.title}`)
  if (v.cwe_id) lines.push(`CWE: ${v.cwe_id}`)
  if (v.endpoint) lines.push(`Endpoint: ${v.endpoint}`)
  if (v.attack_vector) lines.push(`Attack Vector: ${v.attack_vector}`)
  lines.push(`Status: ${v.status ?? "open"}`)
  if (v.description) lines.push(`\n## Description\n${v.description}`)
  if (v.steps_to_reproduce) lines.push(`\n## Steps to Reproduce\n${v.steps_to_reproduce}`)
  if (v.poc) lines.push(`\n## Proof of Concept\n${v.poc}`)
  if (v.business_impact) lines.push(`\n## Business Impact\n${v.business_impact}`)
  if (v.recommendation) lines.push(`\n## Recommendation\n${v.recommendation}`)
  return lines.join("\n")
}

function CopyVulnButton(props: { vuln: Parameters<typeof formatVulnForClipboard>[0] }): JSX.Element {
  const [copied, setCopied] = createSignal(false)

  const copy = (e: MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(formatVulnForClipboard(props.vuln)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      onClick={copy}
      class="flex items-center gap-1 text-10-medium text-text-weaker hover:text-text-base transition-colors cursor-pointer select-none"
      title="Copy vulnerability details"
    >
      <Icon name={copied() ? "check" : "copy"} size="small" />
      <span>{copied() ? "Copied!" : "Copy"}</span>
    </button>
  )
}

function VulnDetailSection(props: { label: string; content: string | undefined }): JSX.Element {
  return (
    <Show when={props.content}>
      {(text) => (
        <div class="flex flex-col gap-0.5">
          <span class="text-11-medium text-text-weaker uppercase tracking-wider">{props.label}</span>
          <div class="text-12-regular text-text-base whitespace-pre-wrap break-words select-text">{text()}</div>
        </div>
      )}
    </Show>
  )
}

function VulnsPanelList() {
  const sync = useSync()
  const language = useLanguage()
  const params = useParams()

  const sessionID = () => params.id ?? ""
  const [expanded, setExpanded] = createSignal<string | undefined>(undefined)

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

  const toggle = (id: string) => {
    setExpanded((prev) => (prev === id ? undefined : id))
  }

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
        {(v) => {
          const id = () => v.id ?? v.title
          const isExpanded = () => expanded() === id()
          return (
            <div
              class="flex flex-col rounded transition-colors hover:bg-surface-raised-base-hover"
              classList={{ "opacity-50": v.status === "fixed" || v.status === "ignored" }}
            >
              <div class="flex items-start gap-2 px-2 py-1.5 cursor-pointer" on:click={() => toggle(id())}>
                <span class={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${severityDot(v.severity)}`} />
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="text-12-regular text-text-strong" classList={{ truncate: !isExpanded() }}>
                    {v.title}
                  </span>
                  <span class="text-11-regular text-text-weaker truncate">
                    {v.severity.toUpperCase()}
                    {v.cwe_id ? ` · CWE-${v.cwe_id}` : ""}
                    {v.file ? ` · ${v.file}${v.line_start ? `:${v.line_start}` : ""}` : ""}
                  </span>
                </div>
                <Show when={isExpanded()}>
                  <CopyVulnButton vuln={v} />
                </Show>
                <Icon
                  name={isExpanded() ? "chevron-down" : "chevron-right"}
                  size="small"
                  class="shrink-0 mt-0.5 text-icon-weak"
                />
              </div>
              <Show when={isExpanded()}>
                <div class="flex flex-col gap-2.5 px-2 pb-2.5 pt-0.5 ml-3.5 border-l border-border-weak-base select-text">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class={`text-10-medium px-1.5 py-0.5 rounded ${severityBadge(v.severity)}`}>
                      {severityLabel(v.severity)}
                    </span>
                    <span class="text-10-medium px-1.5 py-0.5 rounded bg-surface-base text-text-weaker">
                      {statusLabel(v.status ?? "open")}
                    </span>
                    <Show when={v.cwe_id}>
                      <span class="text-10-medium px-1.5 py-0.5 rounded bg-surface-base text-text-weaker">
                        CWE-{v.cwe_id}
                      </span>
                    </Show>
                  </div>
                  <Show when={v.file}>
                    <div class="flex flex-col gap-0.5">
                      <span class="text-11-medium text-text-weaker uppercase tracking-wider">Location</span>
                      <span class="text-12-regular text-text-base font-mono">
                        {v.file}
                        {v.line_start ? `:${v.line_start}` : ""}
                        {v.line_end && v.line_end !== v.line_start ? `-${v.line_end}` : ""}
                      </span>
                    </div>
                  </Show>
                  <VulnDetailSection label="Description" content={v.description} />
                  <VulnDetailSection label="Steps to Reproduce" content={v.steps_to_reproduce} />
                  <VulnDetailSection label="Proof of Concept" content={v.poc} />
                  <VulnDetailSection label="Business Impact" content={v.business_impact} />
                  <VulnDetailSection label="Recommendation" content={v.recommendation} />
                </div>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  )
}

function SkillsPanelList() {
  const sync = useSync()
  const sdk = useSDK()

  createEffect(() => {
    sdk.client.skill
      .list()
      .then((x) => {
        if (x.data) sync.set("skill", x.data)
      })
      .catch(() => {})
  })

  const [search, setSearch] = createSignal("")
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [detail, setDetail] = createSignal<string | null>(null)
  const [detailContent, setDetailContent] = createSignal<string | null>(null)
  const [detailLoading, setDetailLoading] = createSignal(false)

  const items = createMemo(() => {
    const raw = sync.data.skill ?? []
    const q = search().toLowerCase()
    const filtered = q
      ? raw.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            (s.category ?? "").toLowerCase().includes(q),
        )
      : raw
    return filtered
      .slice()
      .sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name))
  })

  const categories = createMemo(() => {
    const cats = new Map<string, typeof items extends () => (infer T)[] ? T[] : never>()
    for (const s of items()) {
      const cat = s.category ?? "other"
      const list = cats.get(cat)
      if (list) list.push(s)
      else cats.set(cat, [s])
    }
    return cats
  })

  const toggle = (cat: string) => {
    setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  const toggleDetail = (name: string) => {
    if (detail() === name) {
      setDetail(null)
      setDetailContent(null)
      return
    }
    setDetail(name)
    setDetailContent(null)
    setDetailLoading(true)
    sdk.client.skill
      .get({ name })
      .then((x) => {
        if (detail() !== name) return
        setDetailContent(x.data?.content ?? null)
      })
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }

  const verifiedDot = (v?: string) => {
    if (v === "official") return "bg-icon-success-base"
    if (v === "tampered") return "bg-icon-critical-base"
    return "bg-icon-warning-base"
  }

  const verifiedLabel = (v?: string) => {
    if (v === "official") return "Official"
    if (v === "community") return "Community"
    if (v === "tampered") return "Tampered"
    return "Unverified"
  }

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">Skills ({items().length})</span>
      </div>
      <div class="px-2 pb-1">
        <input
          type="text"
          placeholder="Search skills..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          class="w-full px-2 py-1 text-12-regular bg-surface-inset-base border border-border-base rounded outline-none focus:border-border-strong placeholder:text-text-weaker"
        />
      </div>
      <Show when={items().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">
          {search() ? "No matching skills" : "No skills loaded"}
        </div>
      </Show>
      <For each={Array.from(categories())}>
        {([cat, skills]) => {
          const open = () => !!expanded()[cat] || !!search()
          return (
            <>
              <button
                class="flex items-center gap-1 px-2 py-1 mt-0.5 w-full text-left hover:bg-surface-dimmer/50 rounded cursor-pointer"
                onClick={() => toggle(cat)}
              >
                <span
                  class="text-text-weaker transition-transform duration-150 text-[10px]"
                  style={{ transform: open() ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  {"\u25B6"}
                </span>
                <span class="text-11-medium text-text-weaker uppercase tracking-wider flex-1">
                  {cat} ({skills.length})
                </span>
              </button>
              <Show when={open()}>
                <For each={skills}>
                  {(s) => (
                    <div class="flex flex-col">
                      <button
                        class="flex items-center gap-2 px-2 pl-5 py-1 rounded w-full text-left hover:bg-surface-dimmer/50 cursor-pointer"
                        classList={{ "bg-surface-dimmer/30": detail() === s.name }}
                        onClick={() => toggleDetail(s.name)}
                      >
                        <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${verifiedDot(s.verified)}`} />
                        <div class="flex flex-col min-w-0 flex-1">
                          <span class="text-12-regular truncate">{s.name}</span>
                          <span class="text-11-regular text-text-weaker truncate">{s.description}</span>
                        </div>
                      </button>
                      <Show when={detail() === s.name}>
                        <div class="mx-2 ml-5 mb-1 p-2 rounded bg-surface-inset-base text-11-regular">
                          <div class="flex flex-wrap gap-x-3 gap-y-1 text-text-weak mb-2">
                            <span>{verifiedLabel(s.verified)}</span>
                            <Show when={s.owasp_id}>
                              <span>{s.owasp_id}</span>
                            </Show>
                            <Show when={s.category}>
                              <span>{s.category}</span>
                            </Show>
                          </div>
                          <Show when={s.tech_stack?.length}>
                            <div class="flex flex-wrap gap-1 mb-2">
                              <For each={s.tech_stack}>
                                {(t) => (
                                  <span class="px-1.5 py-0.5 rounded bg-surface-dimmer-base text-10-regular text-text-weak">
                                    {t}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                          <Show when={s.cwe_ids?.length}>
                            <div class="flex flex-wrap gap-1 mb-2">
                              <For each={s.cwe_ids}>
                                {(c) => (
                                  <span class="px-1.5 py-0.5 rounded bg-surface-dimmer-base text-10-regular text-text-weak">
                                    {c}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                          <Show when={detailLoading()}>
                            <div class="text-text-weaker">Loading...</div>
                          </Show>
                          <Show when={detailContent()}>
                            <div class="mt-1 text-text-base whitespace-pre-wrap break-words text-11-regular leading-relaxed">
                              {detailContent()}
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </>
          )
        }}
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

  const activeCount = createMemo(
    () => items().filter((t) => t.status !== "completed" && t.status !== "cancelled").length,
  )

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">
          {language.t("dialog.todo.title")} ({activeCount()})
        </span>
      </div>
      <Show when={!sessionID()}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("dialog.todo.noSession")}</div>
      </Show>
      <Show when={sessionID() && items().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("dialog.todo.empty")}</div>
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

type WebSection = "endpoints" | "roles" | "credentials" | "objects" | "functions"

const webSections: { id: WebSection; label: string }[] = [
  { id: "endpoints", label: "Endpoints" },
  { id: "roles", label: "Roles" },
  { id: "credentials", label: "Credentials" },
  { id: "objects", label: "Objects" },
  { id: "functions", label: "Functions" },
]

const endpointStatusColor = (status: string) => {
  if (status === "processed") return "bg-icon-success-base"
  if (status === "processing") return "bg-icon-warning-base"
  return "bg-surface-inset-base"
}

const functionActionColor = (action: string) => {
  if (action === "create") return "text-icon-success-base"
  if (action === "read") return "text-icon-accent-base"
  if (action === "update") return "text-icon-warning-base"
  if (action === "delete") return "text-icon-danger-base"
  return "text-text-weak"
}

function WebContextPanelList() {
  const sync = useSync()
  const language = useLanguage()
  const params = useParams()
  const [section, setSection] = createSignal<WebSection>("endpoints")

  const sessionID = () => params.id ?? ""

  // Fetch web context for active session
  createEffect(() => {
    const id = sessionID()
    if (!id) return
    void sync.session.request(id)
    void sync.session.webCredentials(id)
    void sync.session.webRoles(id)
    void sync.session.webObjects(id)
    void sync.session.webFunctions(id)
  })

  const items = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    const s = section()
    if (s === "endpoints") return sync.data.request[id] ?? []
    if (s === "roles") return sync.data.web_role[id] ?? []
    if (s === "credentials") return sync.data.web_credential[id] ?? []
    if (s === "objects") return sync.data.web_object[id] ?? []
    if (s === "functions") return sync.data.web_function[id] ?? []
    return []
  })

  const totalCount = createMemo(() => {
    const id = sessionID()
    if (!id) return 0
    return (
      (sync.data.request[id]?.length ?? 0) +
      (sync.data.web_role[id]?.length ?? 0) +
      (sync.data.web_credential[id]?.length ?? 0) +
      (sync.data.web_object[id]?.length ?? 0) +
      (sync.data.web_function[id]?.length ?? 0)
    )
  })

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">
          {language.t("dialog.web.title")} ({totalCount()})
        </span>
      </div>

      {/* Section pills */}
      <div class="flex items-center gap-1 px-2 py-1 flex-wrap">
        <For each={webSections}>
          {(s) => (
            <button
              class="px-2 py-0.5 rounded text-11-medium cursor-pointer border-none"
              classList={{
                "bg-surface-base text-text-strong": s.id === section(),
                "bg-transparent text-text-weak hover:text-text-base": s.id !== section(),
              }}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          )}
        </For>
      </div>

      <Show when={!sessionID()}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("dialog.web.noSession")}</div>
      </Show>
      <Show when={sessionID() && items().length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("dialog.web.empty")}</div>
      </Show>
      <For each={items()}>
        {(item) => {
          const v = item as Record<string, unknown>
          return (
            <div class="flex items-start gap-2 px-2 py-1 rounded">
              <Show when={section() === "endpoints"}>
                <span class={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${endpointStatusColor(v.status as string)}`} />
                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                  <span class="text-12-medium text-text-accent shrink-0">{v.method as string}</span>
                  <span class="text-12-regular truncate">{v.normalized_path as string}</span>
                </div>
              </Show>
              <Show when={section() === "roles"}>
                <span class="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 bg-icon-accent-base" />
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="text-12-regular truncate">
                    {v.name as string}
                    {v.level != null ? ` L${v.level}` : ""}
                  </span>
                </div>
              </Show>
              <Show when={section() === "credentials"}>
                <span class="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 bg-icon-success-base" />
                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                  <span class="text-12-medium text-text-accent shrink-0">{(v.type as string) ?? "auth"}</span>
                  <span class="text-12-regular truncate">{v.label as string}</span>
                </div>
              </Show>
              <Show when={section() === "objects"}>
                <span class="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 bg-surface-inset-base" />
                <span class="text-12-regular truncate">{v.name as string}</span>
              </Show>
              <Show when={section() === "functions"}>
                <Icon
                  name="dash"
                  size="small"
                  classList={{
                    "shrink-0 mt-0.5": true,
                    [functionActionColor(v.action_type as string)]: true,
                  }}
                />
                <div class="flex items-center gap-1.5 min-w-0 flex-1">
                  <span class="text-12-medium text-text-weaker shrink-0">
                    {String(v.action_type).charAt(0).toUpperCase()}
                  </span>
                  <span class="text-12-regular truncate">{v.name as string}</span>
                </div>
              </Show>
            </div>
          )
        }}
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
                    <Tabs.Trigger value="web-panel">
                      <div class="flex items-center gap-1.5">Web</div>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="todo-panel">
                      <div class="flex items-center gap-1.5">Todo</div>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="skills-panel">
                      <div class="flex items-center gap-1.5">Skills</div>
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
                            props.dialog.show(() => <DialogSelectFile mode="files" onOpenFile={props.showAllFiles} />)
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

                <Tabs.Content value="vulns-panel" class="flex flex-col h-full overflow-hidden">
                  <Show when={props.activeTab() === "vulns-panel"}>
                    <div class="relative pt-2 flex-1 min-h-0 overflow-y-auto px-2">
                      <VulnsPanelList />
                    </div>
                  </Show>
                </Tabs.Content>

                <Tabs.Content value="web-panel" class="flex flex-col h-full overflow-hidden contain-strict">
                  <Show when={props.activeTab() === "web-panel"}>
                    <div class="relative pt-2 flex-1 min-h-0 overflow-y-auto px-2">
                      <WebContextPanelList />
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

                <Tabs.Content value="skills-panel" class="flex flex-col h-full overflow-hidden contain-strict">
                  <Show when={props.activeTab() === "skills-panel"}>
                    <div class="relative pt-2 flex-1 min-h-0 overflow-y-auto px-2">
                      <SkillsPanelList />
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
