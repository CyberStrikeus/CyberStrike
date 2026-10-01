import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  type JSX,
} from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@cyberstrike-io/ui/button"
import { IconButton } from "@cyberstrike-io/ui/icon-button"
import { Icon } from "@cyberstrike-io/ui/icon"
import { Spinner } from "@cyberstrike-io/ui/spinner"
import { showToast } from "@cyberstrike-io/ui/toast"
import { Switch as Toggle } from "@cyberstrike-io/ui/switch"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { copyVulnToClipboard } from "@/utils/vulnerability"
import {
  normalizeStatus,
  groupOrder,
  STATUS_DISPLAY,
  isDimmed,
  isActive,
  defaultCollapsed,
  statusLabel,
} from "@/utils/vulnerability-status"
import type { Vulnerability as BaseVulnerability } from "@cyberstrike-io/sdk/v2/client"

type Vulnerability = BaseVulnerability & {
  steps_to_reproduce?: string
  poc?: string
  business_impact?: string
  recommendation?: string
}

const statusDot = (status: string) => {
  if (status === "connected") return "bg-icon-success-base"
  if (status === "failed") return "bg-icon-danger-base"
  if (status === "needs_auth") return "bg-icon-warning-base"
  return "bg-surface-inset-base"
}

// ---------------------------------------------------------------------------
// MCP Panel
// ---------------------------------------------------------------------------

export function McpPanelList() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [loading, setLoading] = createSignal<string | null>(null)

  createEffect(() => {
    const s = sdk()
    if (!s) return
    s.client.mcp
      .status()
      .then((x) => {
        const ctx = sync()
        if (x.data && ctx) ctx.set("mcp" as never, x.data as never)
      })
      .catch(() => {})
  })

  const items = createMemo(() =>
    Object.entries(sync()?.data.mcp ?? {})
      .map(([name, s]) => ({ name, status: (s as { status: string }).status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = async (name: string) => {
    if (loading()) return
    const s = sdk()
    const ctx = sync()
    if (!s || !ctx) return
    setLoading(name)
    try {
      const entry = ctx.data.mcp[name]
      if (entry && (entry as { status: string }).status === "connected") await s.client.mcp.disconnect({ name })
      else await s.client.mcp.connect({ name })
      const result = await s.client.mcp.status()
      if (result.data) ctx.set("mcp" as never, result.data as never)
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
          onClick={() => {
            void import("@/components/dialog-select-mcp").then((x) => {
              dialog.show(() => <x.DialogSelectMcp />)
            })
          }}
        />
      </div>
      <Show when={items().length === 0}>
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
              <Toggle checked={i.status === "connected"} disabled={loading() === i.name} onChange={() => toggle(i.name)} />
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bolt Panel
// ---------------------------------------------------------------------------

export function BoltPanelList() {
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [loading, setLoading] = createSignal<string | null>(null)

  createEffect(() => {
    const s = sdk()
    if (!s) return
    s.client.bolt
      .status()
      .then((x) => {
        const ctx = sync()
        if (x.data && ctx) ctx.set("bolt" as never, x.data as never)
      })
      .catch(() => {})
  })

  const items = createMemo(() =>
    Object.entries(sync()?.data.bolt ?? {})
      .map(([name, s]) => ({ name, status: (s as { status: string }).status }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = async (name: string) => {
    if (loading()) return
    const s = sdk()
    const ctx = sync()
    if (!s || !ctx) return
    setLoading(name)
    try {
      const entry = ctx.data.bolt[name]
      if (entry && (entry as { status: string }).status === "connected") await s.client.bolt.disconnect({ name })
      else await s.client.bolt.connect({ name })
      const result = await s.client.bolt.status()
      if (result.data) ctx.set("bolt" as never, result.data as never)
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
          onClick={() => {
            void import("@/components/dialog-select-bolt").then((x) => {
              dialog.show(() => <x.DialogSelectBolt />)
            })
          }}
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
              <Toggle checked={i.status === "connected"} disabled={loading() === i.name} onChange={() => toggle(i.name)} />
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Vulnerabilities Panel
// ---------------------------------------------------------------------------

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

function CopyVulnButton(props: { vuln: Parameters<typeof copyVulnToClipboard>[0]; iconOnly?: boolean }): JSX.Element {
  const [copied, setCopied] = createSignal(false)

  const copy = (e: MouseEvent) => {
    e.stopPropagation()
    copyVulnToClipboard(props.vuln).then((ok) => {
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    })
  }

  return (
    <button
      onClick={copy}
      class="flex items-center gap-1 text-10-medium text-text-weaker hover:text-text-base transition-colors cursor-pointer select-none"
      title="Copy vulnerability details"
    >
      <Icon name={copied() ? "check" : "copy"} size="small" />
      <Show when={!props.iconOnly}>
        <span>{copied() ? "Copied!" : "Copy"}</span>
      </Show>
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

export function VulnsPanelList() {
  const sync = useSync()
  const language = useLanguage()
  const params = useParams()

  const sessionID = () => params.id ?? ""
  const [expanded, setExpanded] = createSignal<string | undefined>(undefined)

  const items = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    const list = sync()?.data.vulnerability?.[id] ?? []
    return (list as Vulnerability[]).slice().sort((a, b) => {
      const sa = severityOrder[a.severity] ?? 4
      const sb = severityOrder[b.severity] ?? 4
      if (sa !== sb) return sa - sb
      return (a.title ?? "").localeCompare(b.title ?? "")
    })
  })

  const openCount = createMemo(() => items().filter((v) => isActive(v.status ?? "draft")).length)

  const vulnGroups = createMemo(() => {
    const all = items()
    const order = groupOrder()
    return order
      .map((key) => {
        const display = STATUS_DISPLAY[key]
        const matched = all.filter((v) => normalizeStatus(v.status ?? "draft") === key)
        return { key, label: display.label, symbol: display.symbol, items: matched }
      })
      .filter((g) => g.items.length > 0)
  })
  const [collapsedGroups, setCollapsedGroups] = createSignal<Record<string, boolean>>(defaultCollapsed())
  const toggleGroup = (key: string) => setCollapsedGroups((p) => ({ ...p, [key]: !p[key] }))
  const canonicalTitle = (v: Vulnerability) =>
    v.duplicate_of ? items().find((x) => x.id === v.duplicate_of)?.title : undefined

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
      <For each={vulnGroups()}>
        {(g) => (
          <div class="flex flex-col">
            <div
              class="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-text-weaker"
              on:click={() => toggleGroup(g.key)}
            >
              <Icon
                name={collapsedGroups()[g.key] ? "chevron-right" : "chevron-down"}
                size="small"
                class="shrink-0 text-icon-weak"
              />
              <span class="text-11-medium uppercase tracking-wider">
                {g.symbol} {g.label} ({g.items.length})
              </span>
            </div>
            <Show when={!collapsedGroups()[g.key]}>
              <For each={g.items}>
                {(v) => {
                  const id = () => v.id ?? v.title
                  const isExpanded = () => expanded() === id()
                  return (
                    <div
                      class="group flex flex-col rounded transition-colors hover:bg-surface-raised-base-hover"
                      classList={{ "opacity-50": isDimmed(v.status ?? "draft") }}
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
                            {v.status === "duplicate" && canonicalTitle(v) ? ` · → ${canonicalTitle(v)}` : ""}
                          </span>
                        </div>
                        <Show
                          when={isExpanded()}
                          fallback={
                            <span class="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <CopyVulnButton vuln={v} iconOnly />
                            </span>
                          }
                        >
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
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HackBrowser Panel
// ---------------------------------------------------------------------------

type HackbrowserPhase = "starting" | "crawling" | "completed" | "failed"
type HackbrowserStatus = {
  phase: HackbrowserPhase
  targetUrl: string
  pagesExplored: number
  capturedEndpoints: number
  currentPage?: string
  errors: string[]
}

const hackbrowserPhaseDot = (phase: HackbrowserPhase) => {
  if (phase === "crawling") return "bg-icon-success-base"
  if (phase === "starting") return "bg-icon-warning-base"
  if (phase === "completed") return "bg-icon-success-base"
  return "bg-icon-danger-base"
}

const hackbrowserPhaseBadge = (phase: HackbrowserPhase) => {
  if (phase === "crawling") return "bg-surface-accent-base text-text-accent-base"
  if (phase === "starting") return "bg-surface-warning-base text-text-warning-base"
  if (phase === "completed") return "bg-surface-success-base text-text-success-base"
  return "bg-surface-critical-base text-text-critical-base"
}

export function HackbrowserPanelList() {
  const sdk = useSDK()
  const language = useLanguage()
  const params = useParams()

  const sessionID = () => params.id ?? ""
  const [status, setStatus] = createSignal<HackbrowserStatus | undefined>(undefined)
  const [stopping, setStopping] = createSignal(false)

  createEffect(() => {
    const id = sessionID()
    const s = sdk()
    setStatus(undefined)
    if (!id || !s) return
    s.client.session
      .hackbrowserStatus()
      .then((x) => {
        if (sessionID() !== id) return
        const map = x.data as Record<string, HackbrowserStatus> | undefined
        if (map) setStatus(map[id])
      })
      .catch(() => {})
  })

  createEffect(() => {
    const s = sdk()
    if (!s) return
    const unsub = (s.event as { on: (type: string, cb: (event: { properties: Record<string, unknown> }) => void) => () => void }).on("session.hackbrowser.status", (event) => {
      if (event.properties.sessionID !== sessionID()) return
      setStatus(event.properties.status as HackbrowserStatus)
    })
    onCleanup(unsub)
  })

  const phase = () => status()?.phase
  const isActivePhase = () => phase() === "starting" || phase() === "crawling"

  const phaseLabel = (p: HackbrowserPhase) => {
    if (p === "starting") return language.t("hackbrowser.phase.starting")
    if (p === "crawling") return language.t("hackbrowser.phase.crawling")
    if (p === "completed") return language.t("hackbrowser.phase.completed")
    return language.t("hackbrowser.phase.failed")
  }

  const stop = async () => {
    const id = sessionID()
    const s = sdk()
    if (!id || !s || stopping()) return
    setStopping(true)
    try {
      const result = await s.client.session.hackbrowserStop({ sessionID: id })
      showToast({
        title: language.t("hackbrowser.title"),
        description: result.data ? language.t("hackbrowser.stop.requested") : language.t("hackbrowser.stop.none"),
        variant: result.data ? "success" : "default",
      })
    } catch {
      showToast({ title: language.t("hackbrowser.stop.failed"), variant: "error" })
    } finally {
      setStopping(false)
    }
  }

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">{language.t("hackbrowser.title")}</span>
      </div>

      <Show when={!sessionID()}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("hackbrowser.noSession")}</div>
      </Show>

      <Show when={sessionID() && !status()}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("hackbrowser.empty")}</div>
      </Show>

      <Show when={status()}>
        {(s) => (
          <div class="flex flex-col gap-2 px-2 py-1">
            <div class="flex items-center gap-2">
              <Show
                when={isActivePhase()}
                fallback={<span class={`w-1.5 h-1.5 rounded-full shrink-0 ${hackbrowserPhaseDot(s().phase)}`} />}
              >
                <Spinner class="w-3.5 h-3.5 text-icon-accent-base" />
              </Show>
              <span class={`text-10-medium px-1.5 py-0.5 rounded ${hackbrowserPhaseBadge(s().phase)}`}>
                {phaseLabel(s().phase)}
              </span>
            </div>

            <div class="text-12-regular text-text-base break-all">{s().targetUrl}</div>

            <div class="flex items-center gap-1.5 text-11-regular text-text-weaker">
              <span>
                {s().pagesExplored} {language.t("hackbrowser.counter.pages")}
              </span>
              <span>·</span>
              <span>
                {s().capturedEndpoints} {language.t("hackbrowser.counter.endpoints")}
              </span>
            </div>

            <Show when={s().currentPage}>
              <div class="flex flex-col gap-0.5">
                <span class="text-11-medium text-text-weaker uppercase tracking-wider">
                  {language.t("hackbrowser.currentPage")}
                </span>
                <span class="text-11-regular text-text-base break-all">{s().currentPage}</span>
              </div>
            </Show>

            <Show when={s().errors.length > 0}>
              <div class="flex flex-col gap-0.5">
                <span class="text-11-medium text-text-weaker uppercase tracking-wider">
                  {language.t("hackbrowser.errors")}
                </span>
                <For each={s().errors}>
                  {(err) => <span class="text-11-regular text-text-critical-base break-words">{err}</span>}
                </For>
              </div>
            </Show>

            <Show when={isActivePhase()}>
              <Button variant="primary" size="small" disabled={stopping()} onClick={stop}>
                {language.t("hackbrowser.stop")}
              </Button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Web Context Panel
// ---------------------------------------------------------------------------

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

type ObsTree = {
  params: { name: string; byCredential: { credentialID: string | null; values: string[]; redacted: boolean }[] }[]
}

export function WebContextPanelList() {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const params = useParams()
  const [section, setSection] = createSignal<WebSection>("endpoints")
  const [expandedEp, setExpandedEp] = createSignal<Record<string, boolean>>({})
  const [obsTree, setObsTree] = createSignal<Record<string, ObsTree>>({})

  const sessionID = () => params.id ?? ""
  const credLabel = (id: string | null) =>
    id == null
      ? "anon"
      : (((sync()?.data.web_credential[sessionID()] ?? []) as { id: string; label: string }[]).find((c) => c.id === id)
          ?.label ?? id.slice(0, 6))

  const toggleEndpoint = async (v: Record<string, unknown>) => {
    const id = v.id as string
    const open = !expandedEp()[id]
    setExpandedEp({ ...expandedEp(), [id]: open })
    if (open && !obsTree()[id]) {
      try {
        const s = sdk()
        if (!s) return
        const r = await s.client.session.observations({ sessionID: sessionID(), keyHash: v.key_hash as string })
        const tree = r.data as ObsTree | undefined
        if (tree && Array.isArray(tree.params)) setObsTree({ ...obsTree(), [id]: tree })
      } catch {
        /* expanded row simply shows nothing */
      }
    }
  }

  const items = createMemo(() => {
    const id = sessionID()
    const ctx = sync()
    if (!id || !ctx) return []
    const s = section()
    if (s === "endpoints") return ctx.data.vortex_captures[id]?.requests ?? []
    if (s === "roles") return ctx.data.web_role[id] ?? []
    if (s === "credentials") return ctx.data.web_credential[id] ?? []
    if (s === "objects") return ctx.data.web_object[id] ?? []
    if (s === "functions") return ctx.data.web_function[id] ?? []
    return []
  })

  const totalCount = createMemo(() => {
    const id = sessionID()
    const ctx = sync()
    if (!id || !ctx) return 0
    return (
      ((ctx.data.vortex_captures[id]?.requests as unknown[])?.length ?? 0) +
      ((ctx.data.web_role[id] as unknown[])?.length ?? 0) +
      ((ctx.data.web_credential[id] as unknown[])?.length ?? 0) +
      ((ctx.data.web_object[id] as unknown[])?.length ?? 0) +
      ((ctx.data.web_function[id] as unknown[])?.length ?? 0)
    )
  })

  return (
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center justify-between px-2 py-1">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">
          Web ({totalCount()})
        </span>
      </div>

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
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">No session</div>
      </Show>
      <Show when={sessionID() && (items() as unknown[]).length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">No data yet</div>
      </Show>
      <For each={items() as Record<string, unknown>[]}>
        {(v) => (
          <div class="flex items-start gap-2 px-2 py-1 rounded">
            <Show when={section() === "endpoints"}>
              <div class="flex flex-col w-full gap-0.5">
                <div class="flex items-center gap-1.5 cursor-pointer" onClick={() => toggleEndpoint(v)}>
                  <span class="text-11-regular text-text-muted shrink-0">
                    {expandedEp()[v.id as string] ? "▾" : "▸"}
                  </span>
                  <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${endpointStatusColor(v.status as string)}`} />
                  <span class="text-12-medium text-text-accent shrink-0">{v.method as string}</span>
                  <span class="text-12-regular truncate">{v.normalized_path as string}</span>
                  <Show when={v.operation as string | undefined}>
                    <span class="text-12-regular text-text-muted shrink-0">· {v.operation as string}</span>
                  </Show>
                </div>
                <Show when={expandedEp()[v.id as string]}>
                  <div class="flex flex-col gap-0.5 pl-5">
                    <For each={obsTree()[v.id as string]?.params ?? []}>
                      {(p) => (
                        <div class="flex flex-col">
                          <span class="text-11-regular text-text-muted">{p.name}</span>
                          <For each={p.byCredential}>
                            {(bc) => (
                              <div class="flex gap-1.5 pl-3">
                                <span class="text-11-medium text-text-accent shrink-0">
                                  {credLabel(bc.credentialID)}
                                </span>
                                <span class="text-11-regular truncate">
                                  → {bc.redacted ? "[redacted]" : bc.values.join(", ")}
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      )}
                    </For>
                    <Show when={obsTree()[v.id as string] && (obsTree()[v.id as string]?.params ?? []).length === 0}>
                      <span class="text-11-regular text-text-weak pl-3">(no observed values)</span>
                    </Show>
                  </div>
                </Show>
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
        )}
      </For>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Todo Panel
// ---------------------------------------------------------------------------

export function TodoPanelList() {
  const sync = useSync()
  const language = useLanguage()
  const params = useParams()

  const sessionID = () => params.id ?? ""

  createEffect(() => {
    const id = sessionID()
    const ctx = sync()
    if (!id || !ctx) return
    void ctx.session.todo(id)
  })

  const items = createMemo(() => {
    const id = sessionID()
    const ctx = sync()
    if (!id || !ctx) return []
    return ctx.data.todo[id] ?? []
  })

  const activeCount = createMemo(
    () =>
      (items() as { status: string }[]).filter(
        (t) => t.status !== "completed" && t.status !== "cancelled",
      ).length,
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
      <Show when={sessionID() && (items() as unknown[]).length === 0}>
        <div class="px-2 py-3 text-center text-12-regular text-text-weak">{language.t("dialog.todo.empty")}</div>
      </Show>
      <For each={items() as { status: string; content: string }[]}>
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
