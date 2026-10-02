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
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { Icon } from "@cyberstrike-io/ui/icon"
import { Spinner } from "@cyberstrike-io/ui/spinner"
import { Button } from "@cyberstrike-io/ui/button"
import { Switch as Toggle } from "@cyberstrike-io/ui/switch"
import { showToast } from "@cyberstrike-io/ui/toast"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import type { AssistantMessage, Vulnerability as BaseVulnerability } from "@cyberstrike-io/sdk/v2"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useData } from "@cyberstrike-io/session-ui/context"
import { requireServerKey, sessionHref } from "@/utils/session-route"
import {
  normalizeStatus,
  groupOrder,
  STATUS_DISPLAY,
  isDimmed,
  type VulnStatusValue,
} from "@/utils/vulnerability-status"
import { SessionMetrics } from "@/utils/session-metrics"

type Vulnerability = BaseVulnerability & {
  endpoint?: string
  attack_vector?: string
  cvss?: string
  steps_to_reproduce?: string
  poc?: string
  business_impact?: string
  recommendation?: string
  affected_endpoints?: string[]
  references?: string[]
  source_agent?: string
}

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + "M" : n >= 1_000 ? Math.round(n / 1_000) + "K" : String(n)
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
const fmtHost = (host: string, port?: number) => {
  if (!port || port === 80 || port === 443) return host
  return `${host}:${port}`
}

const severityDot = (s: string) => {
  if (s === "critical") return "bg-icon-critical-base"
  if (s === "high") return "bg-icon-warning-base"
  if (s === "medium") return "bg-icon-accent-base"
  return "bg-border-weak-base"
}

const statusDot = (status: string) => {
  if (status === "connected") return "bg-icon-success-base"
  if (status === "failed") return "bg-icon-danger-base"
  if (status === "needs_auth" || status === "needs_client_registration") return "bg-icon-warning-base"
  return "bg-surface-inset-base"
}

const statusText = (status: string) => {
  if (status === "connected") return "Connected"
  if (status === "failed") return "Failed"
  if (status === "disabled") return "Disabled"
  if (status === "needs_auth") return "Needs auth"
  if (status === "needs_client_registration") return "Needs client ID"
  return status
}

const functionColor = (action: string) => {
  if (action === "create") return "text-icon-success-base"
  if (action === "read") return "text-icon-accent-base"
  if (action === "update") return "text-icon-warning-base"
  if (action === "delete") return "text-icon-danger-base"
  return "text-text-weaker"
}

type TabKey = "overview" | "hackbrowser" | "vortex" | "vulns" | "servers"

const TAB_DEFS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "hackbrowser", label: "HackBrowser" },
  { key: "vortex", label: "Vortex" },
  { key: "vulns", label: "Vulns" },
  { key: "servers", label: "Servers" },
]

function SectionHeader(props: { children: JSX.Element; count?: number; action?: JSX.Element }) {
  return (
    <div class="flex items-center justify-between px-1 mb-1">
      <div class="flex items-center gap-1.5">
        <span class="text-11-medium text-text-weaker uppercase tracking-wider">{props.children}</span>
        <Show when={props.count !== undefined}>
          <span class="text-11-regular text-text-weaker bg-surface-inset-base rounded-full px-1.5 min-w-[18px] text-center">
            {props.count}
          </span>
        </Show>
      </div>
      <Show when={props.action}>{props.action}</Show>
    </div>
  )
}

function SectionDivider() {
  return <div class="border-t border-border-weak-base" />
}

function CollapsibleSection(props: {
  title: string
  count?: number
  defaultOpen?: boolean
  action?: JSX.Element
  children: JSX.Element
}) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? true)
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between px-1">
        <div
          class="flex items-center gap-1 cursor-pointer select-none flex-1"
          onClick={() => setOpen(!open())}
        >
          <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-weak w-3.5 h-3.5" />
          <span class="text-11-medium text-text-weaker uppercase tracking-wider">{props.title}</span>
          <Show when={props.count !== undefined}>
            <span class="text-11-regular text-text-weaker bg-surface-inset-base rounded-full px-1.5 min-w-[18px] text-center">
              {props.count}
            </span>
          </Show>
        </div>
        <Show when={props.action}>{props.action}</Show>
      </div>
      <Show when={open()}>{props.children}</Show>
    </div>
  )
}

function StatRow(props: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div class="flex items-center justify-between px-1 py-0.5">
      <span class="text-12-regular text-text-weak">{props.label}</span>
      <span classList={{ "text-12-medium": true, "text-text-accent": props.accent, "text-text-base": !props.accent }}>
        {props.value}
      </span>
    </div>
  )
}

function Badge(props: { children: JSX.Element; variant?: "success" | "warning" | "danger" | "accent" | "muted" }) {
  const v = () => props.variant ?? "muted"
  return (
    <span
      classList={{
        "text-10-medium px-1.5 py-0.5 rounded inline-flex items-center gap-1": true,
        "bg-surface-success-base text-text-success-base": v() === "success",
        "bg-surface-warning-base text-text-warning-base": v() === "warning",
        "bg-surface-critical-base text-text-critical-base": v() === "danger",
        "bg-surface-accent-base text-text-accent-base": v() === "accent",
        "bg-surface-base text-text-weaker": v() === "muted",
      }}
    >
      {props.children}
    </span>
  )
}

export function CyberStrikeSidebar() {
  const sync = useSync()
  const sdk = useSDK()
  const data = useData()
  const dialog = useDialog()
  const navigate = useNavigate()
  const params = useParams()
  const sessionID = () => params.id ?? ""

  const [activeTab, setActiveTab] = createSignal<TabKey>("overview")

  // -- Child sessions (sub-agents) --
  const childSessions = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return (sync()?.data.session ?? [])
      .filter((s) => s.parentID === id)
      .toSorted((a, b) => (a.time.created ?? 0) - (b.time.created ?? 0))
  })

  const navigateToChild = (childId: string) => {
    if (data.navigateToSession) {
      data.navigateToSession(childId)
      return
    }
    const serverKey = params.serverKey
    if (serverKey) {
      navigate(sessionHref(requireServerKey(serverKey), childId))
    }
  }

  // -- Data accessors --
  const messages = createMemo(() => sync()?.data.message[sessionID()] ?? [])
  const queueStatus = createMemo(() => sync()?.data.session_queue_status?.[sessionID()])
  const hackbrowserStatus = createMemo(() => sync()?.data.session_hackbrowser_status?.[sessionID()])
  const methodology = createMemo(() => sync()?.data.methodology?.[sessionID()])
  const treeUsage = createMemo(() => sync()?.data.session_usage?.[sessionID()])
  const vulnerability = createMemo(() => (sync()?.data.vulnerability?.[sessionID()] ?? []) as Vulnerability[])
  const vortexSignalList = createMemo(() => sync()?.data.vortex_signals?.[sessionID()]?.signals ?? [])
  const requests = createMemo(() => sync()?.data.vortex_captures?.[sessionID()]?.requests ?? [])
  const jsFiles = createMemo(() => sync()?.data.vortex_captures?.[sessionID()]?.jsFiles ?? [])
  const pages = createMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of requests()) {
      const p = r.page_url
      if (p && !seen.has(p)) { seen.add(p); out.push(p) }
    }
    return out.sort((a, b) => a.localeCompare(b))
  })
  const requestsByHost = createMemo(() => {
    const groups = new Map<string, typeof requests extends () => infer T ? T : never>()
    for (const r of requests()) {
      const key = fmtHost(r.host, r.port) || "(unknown)"
      const existing = groups.get(key)
      if (existing) existing.push(r)
      else groups.set(key, [r])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  })
  const credentials = createMemo(() => sync()?.data.web_credential?.[sessionID()] ?? [])
  const roles = createMemo(() => sync()?.data.web_role?.[sessionID()] ?? [])
  const objects = createMemo(() => sync()?.data.web_object?.[sessionID()] ?? [])
  const functions = createMemo(() => sync()?.data.web_function?.[sessionID()] ?? [])
  const retests = createMemo(() => sync()?.data.web_retest?.[sessionID()] ?? [])
  const lifecycle = createMemo(() => sync()?.data.inspection_lifecycle?.[sessionID()])
  const mcpEntries = createMemo(() =>
    Object.entries(sync()?.data.mcp ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  )
  const boltEntries = createMemo(() =>
    Object.entries(sync()?.data.bolt ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  )
  const todo = createMemo(() => sync()?.data.todo?.[sessionID()] ?? [])
  const diff = createMemo(() => sync()?.data.session_diff?.[sessionID()] ?? [])

  const vulnGroups = createMemo(() => {
    const all = vulnerability()
    const order = groupOrder()
    return order
      .map((key) => {
        const display = STATUS_DISPLAY[key]
        const matched = all
          .filter((v) => normalizeStatus(v.status ?? "draft") === key)
          .sort((a, b) => {
            const sa = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[a.severity] ?? 4
            const sb = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[b.severity] ?? 4
            return sa - sb
          })
        return { key, label: display.label, symbol: display.symbol, items: matched }
      })
      .filter((g) => g.items.length > 0)
  })

  const metrics = createMemo(() => {
    const msgs = messages()
    const last = msgs.findLast(
      (x) => x.role === "assistant" && !(x as AssistantMessage).summary && ((x as AssistantMessage).tokens?.total ?? 0) > 0,
    ) as AssistantMessage | undefined
    const provider = last ? sync()?.data.provider.all.get(last.providerID) : undefined
    const model = provider ? provider.models[last!.modelID] : undefined
    return new SessionMetrics({
      messages: msgs,
      model,
      treeUsage: treeUsage(),
      hackbrowserCost: hackbrowserStatus()?.cost ?? 0,
    })
  })

  // -- Polling --
  createEffect(() => {
    const sid = sessionID()
    const ctx = sync()
    if (sid && ctx && !ctx.data.methodology?.[sid]) void ctx.cyberstrike.refreshMethodology(sid)
  })

  let usageTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const sid = sessionID()
    const ctx = sync()
    messages().length
    clearTimeout(usageTimer)
    usageTimer = setTimeout(() => sid && ctx && void ctx.cyberstrike.refreshUsage(sid), 1200)
  })
  onCleanup(() => clearTimeout(usageTimer))

  let capturesTimer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    const sid = sessionID()
    const ctx = sync()
    clearInterval(capturesTimer)
    if (!sid || !ctx) return
    void ctx.cyberstrike.refreshCaptures(sid)
    void ctx.cyberstrike.refreshSignals(sid)
    capturesTimer = setInterval(() => {
      void ctx.cyberstrike.refreshCaptures(sid)
      void ctx.cyberstrike.refreshSignals(sid)
    }, 2000)
  })
  onCleanup(() => clearInterval(capturesTimer))

  // -- Expand/collapse --
  const [expandedVulnGroup, setExpandedVulnGroup] = createStore<Record<string, boolean>>({})
  createEffect(() => {
    for (const g of vulnGroups()) {
      if (expandedVulnGroup[g.key] === undefined) {
        const display = STATUS_DISPLAY[g.key as VulnStatusValue]
        setExpandedVulnGroup(g.key, !display?.collapsedByDefault)
      }
    }
  })
  const [expandedEp, setExpandedEp] = createStore<Record<string, boolean>>({})
  const credLabel = (id: string | null) =>
    id == null ? "anon" : (credentials().find((c) => c.id === id)?.label ?? id.slice(0, 6))
  const toggleEndpoint = (r: { id: string; key_hash?: string }) => {
    const open = !expandedEp[r.id]
    setExpandedEp(r.id, open)
    if (open && r.key_hash) {
      const ctx = sync()
      if (ctx) void ctx.cyberstrike.fetchObservations(sessionID(), r.key_hash)
    }
  }

  // -- Actions --
  const [stopping, setStopping] = createSignal(false)
  const stopHackbrowser = async () => {
    const id = sessionID()
    const s = sdk()
    if (!id || !s || stopping()) return
    setStopping(true)
    try {
      await s.client.session.hackbrowserStop({ sessionID: id })
      showToast({ title: "HackBrowser", description: "Stop requested", variant: "success" })
    } catch {
      showToast({ title: "HackBrowser", description: "Failed to stop", variant: "error" })
    } finally {
      setStopping(false)
    }
  }

  const [mcpLoading, setMcpLoading] = createSignal<string | null>(null)
  const toggleMcp = async (name: string) => {
    if (mcpLoading()) return
    const s = sdk()
    const ctx = sync()
    if (!s || !ctx) return
    setMcpLoading(name)
    try {
      const entry = ctx.data.mcp[name]
      if (entry && (entry as { status: string }).status === "connected") await s.client.mcp.disconnect({ name })
      else await s.client.mcp.connect({ name })
      const result = await s.client.mcp.status()
      if (result.data) ctx.set("mcp" as never, result.data as never)
    } finally {
      setMcpLoading(null)
    }
  }

  const [boltLoading, setBoltLoading] = createSignal<string | null>(null)
  const toggleBolt = async (name: string) => {
    if (boltLoading()) return
    const s = sdk()
    const ctx = sync()
    if (!s || !ctx) return
    setBoltLoading(name)
    try {
      const entry = ctx.data.bolt[name]
      if (entry && entry.status === "connected") await s.client.bolt.disconnect({ name })
      else await s.client.bolt.connect({ name })
      const result = await s.client.bolt.status()
      if (result.data) ctx.set("bolt" as never, result.data as never)
    } finally {
      setBoltLoading(null)
    }
  }

  const connectedMcpCount = createMemo(() =>
    mcpEntries().filter(([, item]) => (item as { status: string }).status === "connected").length,
  )
  const connectedBoltCount = createMemo(() =>
    boltEntries().filter(([, item]) => item.status === "connected").length,
  )

  // -- Tab badge counts --
  const hackbrowserBadge = createMemo(() => {
    const hb = hackbrowserStatus()
    const webCount = roles().length + credentials().length + objects().length + functions().length
    const endpointCount = requests().length
    const total = endpointCount + webCount
    if (!hb) return total > 0 ? total : undefined
    if (hb.phase === "crawling" || hb.phase === "starting") return undefined
    return total || undefined
  })
  const vortexBadge = createMemo(() => vortexSignalList().length || undefined)
  const vulnBadge = createMemo(() => vulnerability().length || undefined)
  const serverBadge = createMemo(() => {
    const total = connectedMcpCount() + connectedBoltCount()
    return total || undefined
  })

  const tabBadge = (key: TabKey) => {
    if (key === "hackbrowser") return hackbrowserBadge()
    if (key === "vortex") return vortexBadge()
    if (key === "vulns") return vulnBadge()
    if (key === "servers") return serverBadge()
    return undefined
  }

  const tabHasActivity = (key: TabKey) => {
    if (key === "hackbrowser") {
      const hb = hackbrowserStatus()
      return hb?.phase === "crawling" || hb?.phase === "starting"
    }
    return false
  }

  return (
    <div class="flex flex-col h-full overflow-hidden">
      {/* ─── Sub-Tab Bar ─── */}
      <div class="flex items-center gap-0 border-b border-border-base px-1 shrink-0 overflow-x-auto bg-surface-base">
        <For each={TAB_DEFS}>
          {(tab) => (
            <button
              class="relative flex items-center gap-1 px-2 py-2 text-12-medium transition-colors cursor-pointer whitespace-nowrap"
              classList={{
                "text-text-base": activeTab() === tab.key,
                "text-text-weak hover:text-text-base": activeTab() !== tab.key,
              }}
              onClick={() => setActiveTab(tab.key)}
            >
              <Show when={tabHasActivity(tab.key)}>
                <Spinner class="w-3 h-3 text-icon-accent-base" />
              </Show>
              {tab.label}
              <Show when={tabBadge(tab.key)}>
                <span classList={{
                  "text-10-medium rounded-full px-1.5 min-w-[16px] text-center": true,
                  "bg-surface-accent-base text-text-accent-base": activeTab() === tab.key,
                  "bg-surface-inset-base text-text-weak": activeTab() !== tab.key,
                }}>
                  {tabBadge(tab.key)}
                </span>
              </Show>
              <Show when={activeTab() === tab.key}>
                <div class="absolute bottom-0 left-1 right-1 h-0.5 bg-icon-accent-base rounded-full" />
              </Show>
            </button>
          )}
        </For>
      </div>

      {/* ─── Tab Content ─── */}
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-3 px-3 py-3">

          {/* ═══ OVERVIEW TAB ═══ */}
          <Show when={activeTab() === "overview"}>
            {/* Context Window */}
            <div class="flex flex-col gap-1.5 bg-surface-raised-base rounded-lg p-2.5">
              <SectionHeader>Context</SectionHeader>
              <div class="px-1">
                <div class="w-full h-1.5 bg-surface-inset-base rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    classList={{
                      "bg-icon-accent-base": (metrics().contextUsedPercent ?? 0) < 70,
                      "bg-icon-warning-base": (metrics().contextUsedPercent ?? 0) >= 70 && (metrics().contextUsedPercent ?? 0) < 90,
                      "bg-icon-danger-base": (metrics().contextUsedPercent ?? 0) >= 90,
                    }}
                    style={{ width: `${Math.min(metrics().contextUsedPercent ?? 0, 100)}%` }}
                  />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <StatRow label="Tokens" value={metrics().contextTokens > 0 ? metrics().contextTokens.toLocaleString() : "0"} />
                <StatRow label="Limit" value={metrics().contextLimit ? SessionMetrics.formatTokens(metrics().contextLimit!) : "—"} />
                <StatRow label="Used" value={SessionMetrics.formatPercent(metrics().contextUsedPercent)} />
                <StatRow label="Compactions" value={String(metrics().compactionCount)} />
                <Show when={metrics().contextOverflowCount > 0}>
                  <StatRow label="Overflows" value={String(metrics().contextOverflowCount)} accent />
                </Show>
              </div>
              <Show when={metrics().activeModel}>
                <div class="flex items-center gap-1.5 px-1 py-0.5 mt-0.5">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-icon-success-base" />
                  <span class="text-11-medium text-text-base truncate">{metrics().activeModel!.name}</span>
                  <span class="text-10-regular text-text-weaker shrink-0">via {metrics().activeModel!.providerID}</span>
                </div>
              </Show>
            </div>

            {/* Cost & Usage */}
            <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
              <SectionHeader>Cost & Usage</SectionHeader>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <StatRow label="Session" value={SessionMetrics.formatCost(metrics().totalCost)} accent />
                <StatRow label="Avg/msg" value={SessionMetrics.formatCost(metrics().avgCostPerMessage)} />
                <Show when={metrics().treeCost}>
                  <StatRow label="Tree" value={`${SessionMetrics.formatTokens(metrics().treeCost!.tokens)} · ${SessionMetrics.formatCost(metrics().treeCost!.cost)}`} />
                </Show>
              </div>
            </div>

            {/* Messages */}
            <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
              <SectionHeader>Messages</SectionHeader>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <StatRow label="User" value={String(metrics().messageCount.user)} />
                <StatRow label="Assistant" value={String(metrics().messageCount.assistant)} />
                <Show when={metrics().cacheHitRate !== null}>
                  <StatRow label="Cache hit" value={`${metrics().cacheHitRate}%`} />
                </Show>
                <Show when={metrics().sessionDuration !== null}>
                  <StatRow label="Duration" value={SessionMetrics.formatDuration(metrics().sessionDuration!)} />
                </Show>
              </div>
            </div>

            {/* Token Breakdown */}
            <Show when={metrics().hasData}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Token Breakdown" defaultOpen={false}>
                  <div class="flex flex-col gap-0.5">
                    <div class="px-1 py-0.5">
                      <span class="text-10-medium text-text-weaker uppercase tracking-wider">Current Context</span>
                    </div>
                    <StatRow label="Input" value={metrics().currentTokens.input.toLocaleString()} />
                    <StatRow label="Output" value={metrics().currentTokens.output.toLocaleString()} />
                    <StatRow label="Reasoning" value={metrics().currentTokens.reasoning.toLocaleString()} />
                    <StatRow label="Cache Read" value={metrics().currentTokens.cacheRead.toLocaleString()} />
                    <StatRow label="Cache Write" value={metrics().currentTokens.cacheWrite.toLocaleString()} />
                    <div class="border-t border-border-weak-base my-1" />
                    <div class="px-1 py-0.5">
                      <span class="text-10-medium text-text-weaker uppercase tracking-wider">Session Total</span>
                    </div>
                    <StatRow label="Input" value={metrics().cumulativeTokens.input.toLocaleString()} />
                    <StatRow label="Output" value={metrics().cumulativeTokens.output.toLocaleString()} />
                    <StatRow label="Reasoning" value={metrics().cumulativeTokens.reasoning.toLocaleString()} />
                    <StatRow label="Cache Read" value={metrics().cumulativeTokens.cacheRead.toLocaleString()} />
                    <StatRow label="Cache Write" value={metrics().cumulativeTokens.cacheWrite.toLocaleString()} />
                    <div class="border-t border-border-weak-base my-1" />
                    <StatRow label="Total" value={metrics().cumulativeTokens.total.toLocaleString()} accent />
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Agent Activity */}
            <Show when={metrics().agentDistribution.length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Agents" count={metrics().agentDistribution.length} defaultOpen={false}>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={metrics().agentDistribution}>
                      {(a) => (
                        <div class="flex items-center justify-between px-1 py-0.5">
                          <div class="flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-icon-accent-base" />
                            <span class="text-12-regular text-text-base">{a.name}</span>
                          </div>
                          <span class="text-11-regular text-text-weaker">{a.count} msg{a.count !== 1 ? "s" : ""} · {SessionMetrics.formatCost(a.cost)}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Sub-agents */}
            <Show when={childSessions().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Sub-agents" count={childSessions().length} defaultOpen>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={childSessions()}>
                      {(child) => {
                        const status = createMemo(() => sync()?.data.session_status?.[child.id])
                        const busy = createMemo(() => status()?.type === "busy")
                        const label = createMemo(() => {
                          const t = child.title
                          return t.replace(/^Inspect\s+/, "").replace(/\s+\(@\w[\w-]*\)$/, "") || t
                        })
                        return (
                          <button
                            type="button"
                            class="flex items-center gap-1.5 px-1 py-1 rounded-md w-full text-left transition-colors hover:bg-surface-inset-base cursor-pointer"
                            onClick={() => navigateToChild(child.id)}
                          >
                            <span classList={{
                              "w-1.5 h-1.5 rounded-full shrink-0": true,
                              "bg-icon-success-base": !busy(),
                              "bg-icon-accent-base animate-pulse": busy(),
                            }} />
                            <span class="text-12-regular text-text-base truncate flex-1">{label()}</span>
                            <Show when={child.agent}>
                              <span class="text-11-regular text-text-weaker shrink-0">{child.agent}</span>
                            </Show>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Finish Reasons */}
            <Show when={metrics().hasData && Object.keys(metrics().finishReasons).length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Finish Reasons" defaultOpen={false}>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={Object.entries(metrics().finishReasons)}>
                      {([reason, count]) => (
                        <div class="flex items-center justify-between px-1 py-0.5">
                          <div class="flex items-center gap-1.5">
                            <span classList={{
                              "w-1.5 h-1.5 rounded-full shrink-0": true,
                              "bg-icon-success-base": reason === "stop",
                              "bg-icon-danger-base": reason === "length",
                              "bg-icon-warning-base": reason === "cancelled",
                              "bg-surface-inset-base": reason !== "stop" && reason !== "length" && reason !== "cancelled",
                            }} />
                            <span class="text-12-regular text-text-base">{reason}</span>
                          </div>
                          <span class="text-11-regular text-text-weaker">{count}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Ingest Queue */}
            <Show when={(queueStatus()?.pending ?? 0) > 0 || queueStatus()?.paused}>
              <div class="flex flex-col gap-1.5 bg-surface-raised-base rounded-lg p-2.5">
                <SectionHeader>Ingest Queue</SectionHeader>
                <div class="flex items-center gap-2 px-1">
                  <span classList={{
                    "w-2 h-2 rounded-full shrink-0": true,
                    "bg-icon-warning-base animate-pulse": queueStatus()?.paused,
                    "bg-icon-success-base": !queueStatus()?.paused,
                  }} />
                  <span class="text-12-medium text-text-base">
                    {queueStatus()?.paused ? "Paused" : "Running"}
                  </span>
                  <Show when={(queueStatus()?.pending ?? 0) > 0}>
                    <Badge variant="muted">{queueStatus()!.pending} pending</Badge>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Methodology */}
            <Show when={methodology()}>
              {(m) => (
                <div class="flex flex-col gap-1.5 bg-surface-raised-base rounded-lg p-2.5">
                  <SectionHeader>Methodology</SectionHeader>
                  <Show when={m().currentPhase}>
                    <div class="flex items-center gap-2 px-1">
                      <span class="text-12-regular text-text-weak">Phase</span>
                      <Badge variant="accent">{m().currentPhase}</Badge>
                      <span class="text-11-regular text-text-weaker">
                        {m().completedCount}/{m().totalCount}
                      </span>
                    </div>
                  </Show>
                  <StatRow label="Intel entries" value={m().totalEntries} />
                  <Show when={m().totalChecks > 0}>
                    <div class="px-1 py-0.5">
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-12-regular text-text-weak">VRT Coverage</span>
                        <span class="text-12-medium text-text-base">{Math.round(m().coveragePercent)}%</span>
                      </div>
                      <div class="w-full h-1.5 bg-surface-inset-base rounded-full overflow-hidden">
                        <div
                          class="h-full bg-icon-accent-base rounded-full transition-all"
                          style={{ width: `${Math.round(m().coveragePercent)}%` }}
                        />
                      </div>
                      <span class="text-10-regular text-text-weaker mt-0.5">
                        {m().completedChecks}/{m().totalChecks} checks
                      </span>
                    </div>
                  </Show>
                  <Show when={m().chains > 0}>
                    <div class="px-1"><Badge variant="warning">Chains: {m().chains}</Badge></div>
                  </Show>
                  <Show when={m().violations > 0}>
                    <div class="px-1">
                      <Badge variant="danger">
                        {m().violations} gate {m().violations === 1 ? "violation" : "violations"}
                      </Badge>
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            {/* Phase & Inspection */}
            <Show when={lifecycle()}>
              {(lc) => {
                const phaseLabel = () => {
                  const p = lc().phase
                  if (p === "idle") return "Idle"
                  if (p === "discovering") return "Discovering"
                  if (p === "inspecting") return "Inspecting"
                  if (p === "draining") return "Draining"
                  if (p === "complete") return "Complete"
                  return p
                }
                const phaseVariant = (): "muted" | "success" | "accent" => {
                  if (lc().phase === "idle") return "muted"
                  if (lc().phase === "complete") return "success"
                  return "accent"
                }
                return (
                  <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                    <SectionHeader>Inspection Phase</SectionHeader>
                    <div class="flex items-center gap-2 px-1">
                      <Badge variant={phaseVariant()}>{phaseLabel()}</Badge>
                      <Show when={lc().counts.total > 0}>
                        <span class="text-11-regular text-text-weaker">
                          {lc().counts.examined}/{lc().counts.total} examined
                        </span>
                      </Show>
                    </div>
                  </div>
                )
              }}
            </Show>

            {/* Todo */}
            <Show when={todo().some((t: { status: string }) => t.status !== "completed" && t.status !== "cancelled")}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <SectionHeader>Todo</SectionHeader>
                <div class="flex flex-col gap-0.5">
                  <For each={todo() as { status: string; content: string }[]}>
                    {(t) => (
                      <Show when={t.status !== "completed" && t.status !== "cancelled"}>
                        <div class="flex items-start gap-1.5 py-0.5 px-1">
                          <Icon
                            name={t.status === "in_progress" ? "dash" : "circle-check"}
                            size="small"
                            classList={{
                              "shrink-0 mt-0.5 w-3.5 h-3.5": true,
                              "text-icon-warning-base": t.status === "in_progress",
                              "text-icon-weak": t.status !== "in_progress",
                            }}
                          />
                          <span class="text-12-regular text-text-base">{t.content}</span>
                        </div>
                      </Show>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Modified Files */}
            <Show when={diff().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Modified Files" count={diff().length}>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={diff()}>
                      {(item) => (
                        <div class="flex items-center justify-between gap-1 px-1 py-0.5">
                          <span class="text-11-regular text-text-base truncate min-w-0">{item.file}</span>
                          <div class="flex items-center gap-1.5 shrink-0">
                            <Show when={item.additions}>
                              <span class="text-10-medium text-text-success-base">+{item.additions}</span>
                            </Show>
                            <Show when={item.deletions}>
                              <span class="text-10-medium text-text-critical-base">-{item.deletions}</span>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Empty overview */}
            <Show when={
              !queueStatus()?.paused && (queueStatus()?.pending ?? 0) === 0 &&
              !methodology() && !lifecycle() && !metrics().hasData && diff().length === 0
            }>
              <div class="flex flex-col items-center justify-center py-8 text-center gap-2">
                <div class="w-8 h-8 rounded-full bg-surface-inset-base flex items-center justify-center">
                  <Icon name="magnifying-glass" size="small" class="text-icon-weak" />
                </div>
                <span class="text-12-regular text-text-weaker">Start a session to see overview data</span>
              </div>
            </Show>
          </Show>

          {/* ═══ HACKBROWSER TAB ═══ */}
          <Show when={activeTab() === "hackbrowser"}>
            <Show when={hackbrowserStatus()}>
              {(hb) => (
                <div class="flex flex-col gap-2 bg-surface-raised-base rounded-lg p-2.5">
                  <SectionHeader>Status</SectionHeader>
                  <div class="flex items-center gap-2 px-1">
                    <Show
                      when={hb().phase === "starting" || hb().phase === "crawling"}
                      fallback={
                        <span classList={{
                          "w-2 h-2 rounded-full shrink-0": true,
                          "bg-icon-success-base": hb().phase === "completed",
                          "bg-icon-danger-base": hb().phase === "failed",
                        }} />
                      }
                    >
                      <Spinner class="w-3.5 h-3.5 text-icon-accent-base" />
                    </Show>
                    <Switch>
                      <Match when={hb().phase === "starting"}><Badge variant="warning">Starting</Badge></Match>
                      <Match when={hb().phase === "crawling"}><Badge variant="accent">Crawling</Badge></Match>
                      <Match when={hb().phase === "completed"}><Badge variant="success">Completed</Badge></Match>
                      <Match when={hb().phase === "failed"}><Badge variant="danger">Failed</Badge></Match>
                    </Switch>
                  </div>
                  <span class="text-12-regular text-text-weak break-all px-1">{hb().targetUrl}</span>
                  <div class="flex items-center gap-3 px-1">
                    <div class="flex items-center gap-1">
                      <span class="text-14-medium text-text-base">{pages().length}</span>
                      <span class="text-11-regular text-text-weaker">pages</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="text-14-medium text-text-base">{requests().length}</span>
                      <span class="text-11-regular text-text-weaker">endpoints</span>
                    </div>
                    <Show when={jsFiles().length > 0}>
                      <div class="flex items-center gap-1">
                        <span class="text-14-medium text-text-base">{jsFiles().length}</span>
                        <span class="text-11-regular text-text-weaker">JS</span>
                      </div>
                    </Show>
                  </div>
                  <Show when={hb().phase === "crawling" && hb().currentPage}>
                    <div class="flex flex-col gap-0.5 px-1">
                      <span class="text-10-medium text-text-weaker uppercase tracking-wider">Current</span>
                      <span class="text-11-regular text-text-weak break-all">{hb().currentPage}</span>
                    </div>
                  </Show>
                  <Show when={hb().phase === "failed" && hb().errors.length > 0}>
                    <div class="px-1">
                      <span class="text-11-regular text-text-critical-base break-words">{hb().errors[0]}</span>
                    </div>
                  </Show>
                  <Show when={hb().phase === "starting" || hb().phase === "crawling"}>
                    <div class="px-1">
                      <Button variant="secondary" size="small" disabled={stopping()} onClick={stopHackbrowser}>
                        Stop Crawl
                      </Button>
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            {/* Pages */}
            <Show when={pages().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Pages" count={pages().length} defaultOpen={pages().length <= 12}>
                  <div class="flex flex-col gap-0.5 pl-2">
                    <For each={pages()}>
                      {(p) => <span class="text-11-regular text-text-weak truncate py-0.5">{p}</span>}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Endpoints */}
            <Show when={requests().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Endpoints" count={requests().length}>
                  <div class="flex flex-col gap-1 pl-1">
                    <For each={requestsByHost()}>
                      {([host, rows]) => (
                        <div class="flex flex-col">
                          <span class="text-11-medium text-text-weaker px-1 py-0.5 bg-surface-inset-base rounded">
                            {host} ({rows.length})
                          </span>
                          <For each={rows}>
                            {(r) => (
                              <div class="flex flex-col">
                                <div
                                  class="flex items-center gap-1 px-1 py-0.5 cursor-pointer hover:bg-surface-raised-base-hover rounded"
                                  onClick={() => toggleEndpoint(r)}
                                >
                                  <Icon
                                    name={expandedEp[r.id] ? "chevron-down" : "chevron-right"}
                                    size="small" class="shrink-0 text-icon-weak w-3 h-3"
                                  />
                                  <span classList={{
                                    "w-1.5 h-1.5 rounded-full shrink-0": true,
                                    "bg-icon-danger-base": !!r.status && r.status >= 500,
                                    "bg-icon-warning-base": !!r.status && r.status >= 400 && r.status < 500,
                                    "bg-icon-success-base": !!r.status && r.status >= 200 && r.status < 300,
                                    "bg-surface-inset-base": !r.status || r.status < 200 || r.status >= 600,
                                  }} />
                                  <span class="text-11-medium text-text-accent shrink-0">{r.method}</span>
                                  <span class="text-11-regular text-text-base truncate">{r.normalized_path}</span>
                                  <Show when={r.operation}>
                                    <span class="text-10-regular text-text-weaker shrink-0">{"·"} {r.operation}</span>
                                  </Show>
                                </div>
                                <Show when={expandedEp[r.id] && r.key_hash}>
                                  <div class="pl-6 py-0.5">
                                    <For each={sync()?.data.request_observation[r.key_hash!]?.params ?? []}>
                                      {(p) => (
                                        <div class="flex flex-col gap-0.5 py-0.5">
                                          <span class="text-10-medium text-text-weaker">{p.name}</span>
                                          <For each={p.byCredential}>
                                            {(bc) => (
                                              <div class="flex gap-1.5 pl-2">
                                                <span class="text-10-medium text-text-accent shrink-0">{credLabel(bc.credentialID)}</span>
                                                <span class="text-10-regular text-text-base truncate">
                                                  {"→"} {bc.redacted ? "[redacted]" : bc.values.join(", ")}
                                                </span>
                                              </div>
                                            )}
                                          </For>
                                        </div>
                                      )}
                                    </For>
                                    <Show when={(sync()?.data.request_observation[r.key_hash!]?.params ?? []).length === 0}>
                                      <span class="text-10-regular text-text-weaker">(no observed values)</span>
                                    </Show>
                                  </div>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* JS Files */}
            <Show when={jsFiles().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="JS Files" count={jsFiles().length} defaultOpen={jsFiles().length <= 12}>
                  <div class="flex flex-col gap-0.5 pl-2">
                    <For each={jsFiles()}>
                      {(j) => <span class="text-11-regular text-text-weak truncate py-0.5">{j.url}</span>}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Roles */}
            <Show when={roles().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Roles" count={roles().length}>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={roles()}>
                      {(r) => (
                        <div class="flex items-center gap-1.5 py-0.5 px-1">
                          <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-icon-accent-base" />
                          <span class="text-12-regular text-text-base">{r.name}</span>
                          <Show when={r.level != null}>
                            <Badge variant="muted">L{r.level}</Badge>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Credentials */}
            <Show when={credentials().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Credentials" count={credentials().length}>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={credentials()}>
                      {(c) => (
                        <div class="flex items-center gap-1.5 py-0.5 px-1">
                          <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-icon-success-base" />
                          <Badge variant="accent">{c.type}</Badge>
                          <span class="text-12-regular text-text-base truncate">{c.label}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Objects */}
            <Show when={objects().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Objects" count={objects().length}>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={objects()}>
                      {(o) => (
                        <div class="flex items-center gap-1.5 py-0.5 px-1">
                          <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-surface-inset-base" />
                          <span class="text-12-regular text-text-base">{o.name}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Functions */}
            <Show when={functions().length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Functions" count={functions().length}>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={functions()}>
                      {(f) => (
                        <div class="flex items-center gap-1.5 py-0.5 px-1">
                          <span classList={{ "text-11-medium shrink-0": true, [functionColor(f.action_type)]: true }}>
                            {f.action_type.toUpperCase().charAt(0)}
                          </span>
                          <span class="text-12-regular text-text-base truncate">{f.name}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            {/* Empty hackbrowser */}
            <Show when={!hackbrowserStatus() && requests().length === 0 && roles().length === 0 && credentials().length === 0 && objects().length === 0 && functions().length === 0}>
              <div class="flex flex-col items-center justify-center py-8 text-center gap-2">
                <span class="text-12-regular text-text-weaker">No HackBrowser data yet</span>
                <span class="text-11-regular text-text-weaker">Use /hackbrowser to start a crawl</span>
              </div>
            </Show>
          </Show>

          {/* ═══ VORTEX TAB ═══ */}
          <Show when={activeTab() === "vortex"}>
            <Show when={vortexSignalList().length > 0}>
              <div class="flex flex-col gap-1.5 bg-surface-raised-base rounded-lg p-2.5">
                <SectionHeader count={vortexSignalList().length}>Signals</SectionHeader>
                <div class="flex flex-col gap-1">
                  <For each={vortexSignalList()}>
                    {(s) => (
                      <div class="flex items-start gap-2 px-1 py-1 rounded hover:bg-surface-raised-base-hover">
                        <span class={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${severityDot(s.severity)}`} />
                        <div class="flex flex-col min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <Badge variant="muted">{s.category}</Badge>
                            <span class="text-12-regular text-text-base truncate">{s.title}</span>
                          </div>
                          <span class="text-10-regular text-text-weaker mt-0.5">
                            {s.routed
                              ? `→ ${s.owner ?? s.category}${s.status === "examined" ? " · examined" : s.status === "pending" ? " · queued" : ""}`
                              : "surfaced (not routed)"}
                            {s.endpoint ? ` · ${s.method ? `${s.method} ` : ""}${s.endpoint}` : ""}
                          </span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <Show when={vortexSignalList().length === 0}>
              <div class="flex flex-col items-center justify-center py-8 text-center gap-2">
                <span class="text-12-regular text-text-weaker">No Vortex signals yet</span>
                <span class="text-11-regular text-text-weaker">Signals appear as traffic is analyzed</span>
              </div>
            </Show>
          </Show>

          {/* ═══ VULNS TAB ═══ */}
          <Show when={activeTab() === "vulns"}>
            <Show when={vulnerability().length > 0}>
              <div class="flex flex-col gap-1.5 bg-surface-raised-base rounded-lg p-2.5">
                <SectionHeader count={vulnerability().length}>Vulnerabilities</SectionHeader>
                <For each={vulnGroups()}>
                  {(g) => (
                    <div class="flex flex-col">
                      <div
                        class="flex items-center gap-1.5 cursor-pointer py-0.5 px-1 rounded hover:bg-surface-raised-base-hover"
                        onClick={() => setExpandedVulnGroup(g.key, !expandedVulnGroup[g.key])}
                      >
                        <Icon name={expandedVulnGroup[g.key] ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-weak w-3 h-3" />
                        <span class="text-11-medium text-text-weaker">
                          {g.symbol} {g.label}
                        </span>
                        <span class="text-10-regular text-text-weaker bg-surface-inset-base rounded-full px-1.5">{g.items.length}</span>
                      </div>
                      <Show when={expandedVulnGroup[g.key]}>
                        <For each={g.items}>
                          {(v) => (
                            <div
                              class="flex items-start gap-1.5 py-0.5 pl-5 pr-1"
                              classList={{ "opacity-40": isDimmed(v.status ?? "draft") }}
                            >
                              <span class={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${severityDot(v.severity)}`} />
                              <div class="flex flex-col min-w-0">
                                <span class="text-12-regular text-text-base">{v.title}</span>
                                <Show when={v.file}>
                                  <span class="text-10-regular text-text-weaker font-mono">
                                    {v.file}{v.line_start != null ? `:${v.line_start}` : ""}
                                  </span>
                                </Show>
                              </div>
                            </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Inspection Queue */}
            <Show when={retests().filter((r) => r.status === "pending").length > 0}>
              <div class="flex flex-col gap-1 bg-surface-raised-base rounded-lg p-2.5">
                <CollapsibleSection title="Inspection Queue" count={retests().filter((r) => r.status === "pending").length}>
                  <div class="flex flex-col gap-0.5 pl-1">
                    <For each={retests().filter((r) => r.status === "pending")}>
                      {(r) => {
                        const f = r.flags ?? {}
                        const parts: string[] = []
                        if (f.credential?.length) parts.push(`${f.credential.length}c`)
                        if (f.role?.length) parts.push(`${f.role.length}r`)
                        if (f.object_value?.length) parts.push(`${f.object_value.length}o`)
                        if (f.signal?.length) parts.push(`${f.signal.length}s`)
                        const flagSummary = parts.join(" ")
                        return (
                          <div class="flex items-center gap-1.5 py-0.5 px-1">
                            <Badge variant="accent">
                              {{ high: "H", medium: "M", low: "L" }[r.priority] ?? r.priority}
                            </Badge>
                            <span class="text-11-regular text-text-base truncate">
                              {r.endpoint ? `${r.method ?? ""} ${r.endpoint}`.trim() : r.key_hash}
                            </span>
                            <Show when={flagSummary}>
                              <span class="text-10-regular text-text-weaker shrink-0">[{flagSummary}]</span>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </CollapsibleSection>
              </div>
            </Show>

            <Show when={vulnerability().length === 0}>
              <div class="flex flex-col items-center justify-center py-8 text-center gap-2">
                <span class="text-12-regular text-text-weaker">No vulnerabilities found yet</span>
              </div>
            </Show>
          </Show>

          {/* ═══ SERVERS TAB ═══ */}
          <Show when={activeTab() === "servers"}>
            {/* MCP Servers */}
            <div class="flex flex-col gap-1.5 bg-surface-raised-base rounded-lg p-2.5">
              <SectionHeader count={connectedMcpCount()}
                action={
                  <button
                    class="text-text-weaker hover:text-text-base transition-colors cursor-pointer p-0.5"
                    onClick={() => {
                      void import("@/components/dialog-select-mcp").then((x) => {
                        dialog.show(() => <x.DialogSelectMcp />)
                      })
                    }}
                  >
                    <Icon name="plus-small" size="small" />
                  </button>
                }
              >MCP Servers</SectionHeader>
              <Show when={mcpEntries().length > 0} fallback={
                <span class="text-11-regular text-text-weaker px-1">No MCP servers configured</span>
              }>
                <div class="flex flex-col gap-0.5">
                  <For each={mcpEntries()}>
                    {([name, item]) => {
                      const s = () => (item as { status: string }).status
                      return (
                        <div class="flex items-center justify-between gap-2 px-1 py-0.5 rounded hover:bg-surface-raised-base-hover">
                          <div class="flex items-center gap-2 min-w-0 flex-1">
                            <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(s())}`} />
                            <span class="text-12-regular text-text-base truncate">{name}</span>
                            <span class="text-10-regular text-text-weaker shrink-0">{statusText(s())}</span>
                          </div>
                          <div onClick={(e: MouseEvent) => e.stopPropagation()} class="shrink-0">
                            <Toggle
                              checked={s() === "connected"}
                              disabled={mcpLoading() === name}
                              onChange={() => toggleMcp(name)}
                            />
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>

            <SectionDivider />

            {/* Bolt */}
            <div class="flex flex-col gap-1.5 bg-surface-raised-base rounded-lg p-2.5">
              <SectionHeader count={connectedBoltCount()}
                action={
                  <button
                    class="text-text-weaker hover:text-text-base transition-colors cursor-pointer p-0.5"
                    onClick={() => {
                      void import("@/components/dialog-select-bolt").then((x) => {
                        dialog.show(() => <x.DialogSelectBolt />)
                      })
                    }}
                  >
                    <Icon name="plus-small" size="small" />
                  </button>
                }
              >Bolt</SectionHeader>
              <Show when={boltEntries().length > 0} fallback={
                <span class="text-11-regular text-text-weaker px-1">No Bolt servers configured</span>
              }>
                <div class="flex flex-col gap-0.5">
                  <For each={boltEntries()}>
                    {([name, item]) => (
                      <div class="flex items-center justify-between gap-2 px-1 py-0.5 rounded hover:bg-surface-raised-base-hover">
                        <div class="flex items-center gap-2 min-w-0 flex-1">
                          <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(item.status)}`} />
                          <span class="text-12-regular text-text-base truncate">{name}</span>
                          <span class="text-10-regular text-text-weaker shrink-0">{statusText(item.status)}</span>
                        </div>
                        <div onClick={(e: MouseEvent) => e.stopPropagation()} class="shrink-0">
                          <Toggle
                            checked={item.status === "connected"}
                            disabled={boltLoading() === name}
                            onChange={() => toggleBolt(name)}
                          />
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>


        </div>
      </div>
    </div>
  )
}
