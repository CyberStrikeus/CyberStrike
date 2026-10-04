import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, For, onCleanup, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@cyberstrike-io/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { formatEndpointHost } from "@tui/util/format"
import { normalizeStatus, groupOrder, STATUS_DISPLAY, compareBySeverity } from "@/session/vulnerability-status"

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + "M" : n >= 1_000 ? Math.round(n / 1_000) + "K" : String(n)
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const vulnerability = createMemo(() => sync.data.vulnerability[props.sessionID] ?? [])
  const vulnGroups = createMemo(() => {
    const all = vulnerability()
    const bySev = (a: (typeof all)[number], b: (typeof all)[number]) =>
      compareBySeverity(a.severity, b.severity)
    const pick = (pred: (v: (typeof all)[number]) => boolean) => all.filter(pred).sort(bySev)
    const order = groupOrder()
    return order
      .map((key) => {
        const display = STATUS_DISPLAY[key]
        const matched = pick((v) => normalizeStatus(v.status ?? "draft") === key)
        return { key, label: display.label, symbol: display.symbol, items: matched }
      })
      .filter((g) => g.items.length > 0)
  })
  // Captures endpoints — sourced from Vortex (the single source agents work on), not the session-web
  // request copy. Repointed via sync.data.vortex_captures (GET /vortex/captures, polled below).
  const requests = createMemo(() => sync.data.vortex_captures[props.sessionID]?.requests ?? [])
  // Group endpoints by host for sidebar — narrow column can't fit
  // method+host+path on one line, so we render the host once per group
  // and let each row use the full width for its path.
  const requestsByHost = createMemo(() => {
    const groups = new Map<string, ReturnType<typeof requests>>()
    for (const r of requests()) {
      const key = formatEndpointHost(r.host, r.port) || "(unknown host)"
      const existing = groups.get(key)
      if (existing) existing.push(r)
      else groups.set(key, [r])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  })
  // Distinct pages the captured requests came from (Captures > Pages).
  const pages = createMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of requests()) {
      const p = r.page_url
      if (p && !seen.has(p)) {
        seen.add(p)
        out.push(p)
      }
    }
    return out.sort((a, b) => a.localeCompare(b))
  })
  // JS files seen during capture (Captures > JS Files) — from Vortex's discovered inventory (single
  // source), via the same /vortex/captures poll as the endpoints above.
  const jsFiles = createMemo(() => sync.data.vortex_captures[props.sessionID]?.jsFiles ?? [])
  // Vortex Signals (issue #14) — what Vortex found on its own + each one's retest-pipeline status,
  // via GET /vortex/signals (polled alongside captures below).
  const vortexSignalList = createMemo(() => sync.data.vortex_signals[props.sessionID]?.signals ?? [])
  const credentials = createMemo(() => sync.data.web_credential[props.sessionID] ?? [])
  const roles = createMemo(() => sync.data.web_role[props.sessionID] ?? [])
  const objects = createMemo(() => sync.data.web_object[props.sessionID] ?? [])
  const functions = createMemo(() => sync.data.web_function[props.sessionID] ?? [])
  const retests = createMemo(() => sync.data.web_retest[props.sessionID] ?? [])
  const lifecycle = createMemo(() => sync.data.inspection_lifecycle[props.sessionID])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const queueStatus = createMemo(() => sync.data.session_queue_status?.[props.sessionID])
  const hackbrowserStatus = createMemo(() => sync.data.session_hackbrowser_status?.[props.sessionID])
  const methodology = createMemo(() => sync.data.methodology?.[props.sessionID])
  // Load the methodology digest when a session is opened (the SSE "intel.updated"
  // path only fires on new activity). Guarded on absence so it fetches once per
  // session and never loops: once the store is populated the effect re-runs, sees
  // the value present, and skips.
  createEffect(() => {
    const sid = props.sessionID
    if (sid && !sync.data.methodology?.[sid]) void sync.refreshMethodology(sid)
  })

  // Cumulative usage across the session tree (main + subagents). Debounced on
  // message activity so a burst of subagent turns triggers at most one refetch.
  const treeUsage = createMemo(() => sync.data.session_usage?.[props.sessionID])
  let usageTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const sid = props.sessionID
    messages().length // track new activity
    clearTimeout(usageTimer)
    usageTimer = setTimeout(() => sid && void sync.refreshUsage(sid), 1200)
  })
  onCleanup(() => clearTimeout(usageTimer))

  // Keep the Vortex-sourced views (Captures + Signals) live while the sidebar is mounted: fetch
  // immediately on open, then a light 2s poll. Both refreshers are best-effort (keep the last
  // snapshot on failure), so a transient error never blanks the sidebar.
  let capturesTimer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    const sid = props.sessionID
    clearInterval(capturesTimer)
    if (!sid) return
    void sync.refreshCaptures(sid)
    void sync.refreshSignals(sid)
    capturesTimer = setInterval(() => {
      void sync.refreshCaptures(sid)
      void sync.refreshSignals(sid)
    }, 2000)
  })
  onCleanup(() => clearInterval(capturesTimer))

  const [expanded, setExpanded] = createStore({
    mcp: true,
    bolt: true,
    diff: true,
    todo: true,
    vulnerability: true,
    lsp: true,
    signals: true,
    captures: true,
    requests: true,
    pages: true,
    jsfiles: true,
    credentials: true,
    roles: true,
    objects: true,
    functions: true,
    retests: true,
  })

  const [expandedVulnGroup, setExpandedVulnGroup] = createStore<Record<string, boolean>>({})
  createEffect(() => {
    for (const g of vulnGroups()) {
      if (expandedVulnGroup[g.key] === undefined) {
        const display = STATUS_DISPLAY[g.key as keyof typeof STATUS_DISPLAY]
        setExpandedVulnGroup(g.key, !display?.collapsedByDefault)
      }
    }
  })

  // Per-endpoint expand state (by request id). Clicking an endpoint fetches its
  // observed values on demand and reveals the param→credential→values tree.
  const [expandedEp, setExpandedEp] = createStore<Record<string, boolean>>({})
  const credLabel = (id: string | null) =>
    id == null ? "anon" : (credentials().find((c) => c.id === id)?.label ?? id.slice(0, 6))
  const toggleEndpoint = (r: { id: string; key_hash?: string }) => {
    const open = !expandedEp[r.id]
    setExpandedEp(r.id, open)
    if (open && r.key_hash) void sync.fetchObservations(props.sessionID, r.key_hash)
  }

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  // Sort Bolt servers alphabetically
  const boltEntries = createMemo(() => Object.entries(sync.data.bolt).sort(([a], [b]) => a.localeCompare(b)))
  const connectedBoltCount = createMemo(() => boltEntries().filter(([_, item]) => item.status === "connected").length)
  const errorBoltCount = createMemo(
    () => boltEntries().filter(([_, item]) => item.status === "failed" || item.status === "needs_auth").length,
  )

  const cost = createMemo(() => {
    const messageCost = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    const hackCost = hackbrowserStatus()?.cost ?? 0
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(messageCost + hackCost)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "cyberstrike" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>
            <box>
              <text fg={theme.text}>
                <b>Context & LLM</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
              <text fg={theme.textMuted}>{cost()} spent</text>
              {/* cumulative across the whole session tree (main + subagents) */}
              <Show when={treeUsage()}>
                <text fg={theme.textMuted}>
                  Σ {fmtTokens(treeUsage()!.totalTokens)} · {usd(treeUsage()!.totalCost)} tree total
                </text>
              </Show>
            </box>
            <Show when={(queueStatus()?.pending ?? 0) > 0 || queueStatus()?.paused}>
              <box>
                <text fg={theme.text}>
                  <b>Ingest Queue</b>
                </text>
                <text fg={queueStatus()?.paused ? theme.warning : theme.success}>
                  {queueStatus()?.paused ? "⏸ Paused" : "● Running"}
                </text>
                <Show when={(queueStatus()?.pending ?? 0) > 0}>
                  <text fg={theme.textMuted}>{queueStatus()!.pending} pending</text>
                </Show>
                <text fg={theme.info}>{queueStatus()?.paused ? "/qresume" : "/qpause"}</text>
              </box>
            </Show>
            <Show when={hackbrowserStatus()}>
              <box>
                <text fg={theme.text}>
                  <b>Hackbrowser</b>
                </text>
                <Switch>
                  <Match when={hackbrowserStatus()!.phase === "starting"}>
                    <text fg={theme.warning}>◌ Starting</text>
                  </Match>
                  <Match when={hackbrowserStatus()!.phase === "crawling"}>
                    <text fg={theme.success}>● Crawling</text>
                  </Match>
                  <Match when={hackbrowserStatus()!.phase === "completed"}>
                    <text fg={theme.success}>✓ Completed</text>
                  </Match>
                  <Match when={hackbrowserStatus()!.phase === "failed"}>
                    <text fg={theme.error}>✗ Failed</text>
                  </Match>
                </Switch>
                <text fg={theme.textMuted} wrapMode="word">
                  {(() => {
                    const url = hackbrowserStatus()!.targetUrl
                    return url.length > 40 ? url.slice(0, 37) + "..." : url
                  })()}
                </text>
                <Show when={hackbrowserStatus()!.phase === "crawling" || hackbrowserStatus()!.phase === "starting"}>
                  <text fg={theme.textMuted}>
                    {pages().length} page
                    {pages().length === 1 ? "" : "s"}
                    {" · "}
                    {requests().length} endpoint
                    {requests().length === 1 ? "" : "s"}
                  </text>
                </Show>
                <Show when={hackbrowserStatus()!.phase === "completed"}>
                  <text fg={theme.textMuted}>
                    {pages().length} page
                    {pages().length === 1 ? "" : "s"}
                    {" · "}
                    {requests().length} endpoint
                    {requests().length === 1 ? "" : "s"}
                  </text>
                </Show>
                <Show when={hackbrowserStatus()!.phase === "crawling" && hackbrowserStatus()!.currentPage}>
                  <text fg={theme.textMuted} wrapMode="word">
                    {(() => {
                      const cur = hackbrowserStatus()!.currentPage!
                      return cur.length > 40 ? cur.slice(0, 37) + "..." : cur
                    })()}
                  </text>
                </Show>
                <Show when={hackbrowserStatus()!.phase === "failed" && hackbrowserStatus()!.errors.length > 0}>
                  <text fg={theme.textMuted} wrapMode="word">
                    {(() => {
                      const err = hackbrowserStatus()!.errors[0] ?? ""
                      return err.length > 60 ? err.slice(0, 57) + "..." : err
                    })()}
                  </text>
                </Show>
                <Show when={hackbrowserStatus()!.phase === "starting" || hackbrowserStatus()!.phase === "crawling"}>
                  <text fg={theme.info}>/hackbrowser-stop</text>
                </Show>
              </box>
            </Show>
            <Show when={methodology()}>
              <box>
                <text fg={theme.text}>
                  <b>Methodology</b>
                </text>
                <Show when={methodology()!.currentPhase}>
                  <text fg={theme.textMuted}>
                    Phase {methodology()!.currentPhase} ({methodology()!.completedCount}/{methodology()!.totalCount})
                  </text>
                </Show>
                <text fg={theme.textMuted}>
                  Intel {methodology()!.totalEntries} {methodology()!.totalEntries === 1 ? "entry" : "entries"}
                </text>
                <Show when={methodology()!.totalChecks > 0}>
                  <text fg={theme.textMuted}>
                    VRT {methodology()!.completedChecks}/{methodology()!.totalChecks} (
                    {Math.round(methodology()!.coveragePercent)}
                    %)
                  </text>
                </Show>
                <Show when={methodology()!.chains > 0}>
                  <text fg={theme.warning}>Chains {methodology()!.chains} ⚠</text>
                </Show>
                <Show when={methodology()!.violations > 0}>
                  <text fg={theme.warning}>
                    Gates {methodology()!.violations} {methodology()!.violations === 1 ? "violation" : "violations"}
                  </text>
                </Show>
                <text fg={theme.info}>/methodology</text>
              </box>
            </Show>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>MCP Servers</b>
                    <Show when={!expanded.mcp}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({connectedMcpCount()} active
                        {errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""})
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.info,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                                needs_client_registration: theme.error,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>Connected</Match>
                              <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                              <Match when={item.status === "disabled"}>Disabled</Match>
                              <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                Needs client ID
                              </Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={boltEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => boltEntries().length > 2 && setExpanded("bolt", !expanded.bolt)}
                >
                  <Show when={boltEntries().length > 2}>
                    <text fg={theme.text}>{expanded.bolt ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Bolt</b>
                    <Show when={!expanded.bolt}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({connectedBoltCount()} active
                        {errorBoltCount() > 0 ? `, ${errorBoltCount()} error${errorBoltCount() > 1 ? "s" : ""}` : ""})
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={boltEntries().length <= 2 || expanded.bolt}>
                  <For each={boltEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.info,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>Connected</Match>
                              <Match when={item.status === "failed"}>Failed</Match>
                              <Match when={item.status === "disabled"}>Disabled</Match>
                              <Match when={(item.status as string) === "needs_auth"}>Needs pairing</Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            {/* LSP section hidden — will enable for source code review */}
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Todo</b>
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </box>
            </Show>
            <Show when={vulnerability().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() =>
                    vulnerability().length > 2 && setExpanded("vulnerability", !expanded.vulnerability)
                  }
                >
                  <Show when={vulnerability().length > 2}>
                    <text fg={theme.text}>{expanded.vulnerability ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Vulnerabilities</b>
                  </text>
                </box>
                <Show when={vulnerability().length <= 2 || expanded.vulnerability}>
                  <For each={vulnGroups()}>
                    {(g) => (
                      <box flexDirection="column">
                        <box
                          flexDirection="row"
                          gap={1}
                          onMouseDown={() => setExpandedVulnGroup(g.key, !expandedVulnGroup[g.key])}
                        >
                          <text fg={theme.textMuted}>
                            {expandedVulnGroup[g.key] ? "▾" : "▸"} {g.symbol} {g.label} ({g.items.length})
                          </text>
                        </box>
                        <Show when={expandedVulnGroup[g.key]}>
                          <For each={g.items}>
                            {(v) => (
                              <box flexDirection="row" gap={1} paddingLeft={1}>
                                <text
                                  flexShrink={0}
                                  style={{
                                    fg:
                                      {
                                        critical: theme.error,
                                        high: theme.warning,
                                        medium: theme.text,
                                        low: theme.textMuted,
                                        info: theme.textMuted,
                                      }[v.severity] ?? theme.text,
                                  }}
                                >
                                  •
                                </text>
                                <text fg={theme.text} wrapMode="word">
                                  {v.title}
                                  {v.file ? ` (${v.line_start != null ? `${v.file}:${v.line_start}` : v.file})` : ""}
                                </text>
                              </box>
                            )}
                          </For>
                        </Show>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={vortexSignalList().length > 0}>
              <box>
                {/* Vortex Signals (issue #14) — what Vortex found on its own, and where each one is in
                    the retest pipeline: routed → owning specialist, then queued / examined (picked up). */}
                <box flexDirection="row" gap={1} onMouseDown={() => setExpanded("signals", !expanded.signals)}>
                  <text fg={theme.text}>{expanded.signals ? "▼" : "▶"}</text>
                  <text fg={theme.text}>
                    <b>Vortex Signals</b> ({vortexSignalList().length})
                  </text>
                </box>
                <Show when={expanded.signals}>
                  <For each={vortexSignalList()}>
                    {(s) => (
                      <box flexDirection="row" gap={1} paddingLeft={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg:
                              {
                                critical: theme.error,
                                high: theme.warning,
                                medium: theme.text,
                                low: theme.textMuted,
                                info: theme.textMuted,
                              }[s.severity] ?? theme.text,
                          }}
                        >
                          •
                        </text>
                        <box flexDirection="column">
                          <text fg={theme.text} wrapMode="word">
                            [{s.category}] {s.title}
                          </text>
                          <text fg={theme.textMuted} wrapMode="word">
                            {s.routed
                              ? `→ ${s.owner ?? s.category}${s.status === "examined" ? " · examined" : s.status === "pending" ? " · queued" : " · routing…"}`
                              : "· surfaced (not auto-routed)"}
                            {s.endpoint ? ` · ${s.method ? `${s.method} ` : ""}${s.endpoint}` : ""}
                          </text>
                        </box>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={requests().length > 0 || jsFiles().length > 0}>
              <box>
                {/* Captures — everything ingested from the browsers, with Pages / Endpoints / JS sub-views */}
                <box flexDirection="row" gap={1} onMouseDown={() => setExpanded("captures", !expanded.captures)}>
                  <text fg={theme.text}>{expanded.captures ? "▼" : "▶"}</text>
                  <text fg={theme.text}>
                    <b>Captures</b>
                  </text>
                  {/* Total captured surface = real endpoints + JS files (the two artifact buckets).
                      Pages is a derived grouping of these, not an additive bucket, so it's excluded. */}
                  <text fg={theme.textMuted}>({requests().length + jsFiles().length})</text>
                </box>
                <Show when={expanded.captures}>
                  {/* Pages — distinct page_url the captures came from */}
                  <Show when={pages().length > 0}>
                    <box paddingLeft={1}>
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseDown={() => pages().length > 2 && setExpanded("pages", !expanded.pages)}
                      >
                        <Show when={pages().length > 2}>
                          <text fg={theme.text}>{expanded.pages ? "▼" : "▶"}</text>
                        </Show>
                        <text fg={theme.text}>Pages</text>
                        <text fg={theme.textMuted}>({pages().length})</text>
                      </box>
                      <Show when={pages().length <= 2 || expanded.pages}>
                        <For each={pages()}>
                          {(p) => (
                            <text fg={theme.textMuted} wrapMode="none" style={{ paddingLeft: 2 }}>
                              {p}
                            </text>
                          )}
                        </For>
                      </Show>
                    </box>
                  </Show>
                  {/* Endpoints — distinct captured requests, grouped by host */}
                  <box paddingLeft={1}>
                    <box
                      flexDirection="row"
                      gap={1}
                      onMouseDown={() => requests().length > 2 && setExpanded("requests", !expanded.requests)}
                    >
                      <Show when={requests().length > 2}>
                        <text fg={theme.text}>{expanded.requests ? "▼" : "▶"}</text>
                      </Show>
                      <text fg={theme.text}>Endpoints</text>
                      <text fg={theme.textMuted}>({requests().length})</text>
                    </box>
                    <Show when={requests().length <= 2 || expanded.requests}>
                      <For each={requestsByHost()}>
                    {([host, rows]) => (
                      <box>
                        <text fg={theme.textMuted} wrapMode="none">
                          {host} ({rows.length})
                        </text>
                        <For each={rows}>
                          {(r) => (
                            <box flexDirection="column">
                              <box flexDirection="row" gap={1} paddingLeft={1} onMouseDown={() => toggleEndpoint(r)}>
                                <text fg={theme.textMuted} flexShrink={0}>
                                  {expandedEp[r.id] ? "▼" : "▶"}
                                </text>
                                <text
                                  flexShrink={0}
                                  style={{
                                    // Color by HTTP status class (Vortex-sourced rows carry the response
                                    // status, not the session-web processing lifecycle): 2xx ok, 4xx warn,
                                    // 5xx danger, else neutral.
                                    fg:
                                      r.status && r.status >= 500
                                        ? theme.error
                                        : r.status && r.status >= 400
                                          ? theme.warning
                                          : r.status && r.status >= 200 && r.status < 300
                                            ? theme.success
                                            : theme.textMuted,
                                  }}
                                >
                                  •
                                </text>
                                <text fg={theme.accent} flexShrink={0}>
                                  {r.method}
                                </text>
                                <text fg={theme.text} wrapMode="none">
                                  {r.normalized_path}
                                </text>
                                <Show when={r.operation}>
                                  <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
                                    · {r.operation}
                                  </text>
                                </Show>
                              </box>
                              {/* Observed values tree — fetched on expand */}
                              <Show when={expandedEp[r.id] && r.key_hash}>
                                <For each={sync.data.request_observation[r.key_hash!]?.params ?? []}>
                                  {(p) => (
                                    <box flexDirection="column" paddingLeft={3}>
                                      <text fg={theme.textMuted} wrapMode="none">
                                        {p.name}
                                      </text>
                                      <For each={p.byCredential}>
                                        {(bc) => (
                                          <box flexDirection="row" gap={1} paddingLeft={2}>
                                            <text fg={theme.accent} flexShrink={0} wrapMode="none">
                                              {credLabel(bc.credentialID)}
                                            </text>
                                            <text fg={theme.text} wrapMode="none">
                                              → {bc.redacted ? "[redacted]" : bc.values.join(", ")}
                                            </text>
                                          </box>
                                        )}
                                      </For>
                                    </box>
                                  )}
                                </For>
                                <Show when={(sync.data.request_observation[r.key_hash!]?.params ?? []).length === 0}>
                                  <text fg={theme.textMuted} wrapMode="none" style={{ paddingLeft: 3 }}>
                                    (no observed values)
                                  </text>
                                </Show>
                              </Show>
                            </box>
                          )}
                        </For>
                      </box>
                    )}
                  </For>
                    </Show>
                  </box>
                  {/* JS Files — durable script URLs (a later agent pulls + reviews each body) */}
                  <Show when={jsFiles().length > 0}>
                    <box paddingLeft={1}>
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseDown={() => jsFiles().length > 2 && setExpanded("jsfiles", !expanded.jsfiles)}
                      >
                        <Show when={jsFiles().length > 2}>
                          <text fg={theme.text}>{expanded.jsfiles ? "▼" : "▶"}</text>
                        </Show>
                        <text fg={theme.text}>JS Files</text>
                        <text fg={theme.textMuted}>({jsFiles().length})</text>
                      </box>
                      <Show when={jsFiles().length <= 2 || expanded.jsfiles}>
                        <For each={jsFiles()}>
                          {(j) => (
                            <text fg={theme.textMuted} wrapMode="none" style={{ paddingLeft: 2 }}>
                              {j.url}
                            </text>
                          )}
                        </For>
                      </Show>
                    </box>
                  </Show>
                </Show>
              </box>
            </Show>
            <Show when={roles().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => roles().length > 2 && setExpanded("roles", !expanded.roles)}
                >
                  <Show when={roles().length > 2}>
                    <text fg={theme.text}>{expanded.roles ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Roles</b>
                  </text>
                </box>
                <Show when={roles().length <= 2 || expanded.roles}>
                  <For each={roles()}>
                    {(r) => (
                      <box flexDirection="row" gap={1}>
                        <text flexShrink={0} style={{ fg: theme.accent }}>
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {r.name}
                          <Show when={r.level != null}>
                            <span style={{ fg: theme.textMuted }}> L{r.level}</span>
                          </Show>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={credentials().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => credentials().length > 2 && setExpanded("credentials", !expanded.credentials)}
                >
                  <Show when={credentials().length > 2}>
                    <text fg={theme.text}>{expanded.credentials ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Credentials</b>
                  </text>
                </box>
                <Show when={credentials().length <= 2 || expanded.credentials}>
                  <For each={credentials()}>
                    {(c) => (
                      <box flexDirection="row" gap={1}>
                        <text flexShrink={0} style={{ fg: theme.success }}>
                          •
                        </text>
                        <text fg={theme.accent} flexShrink={0}>
                          {c.type}
                        </text>
                        <text fg={theme.text} wrapMode="none">
                          {c.label}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={objects().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => objects().length > 2 && setExpanded("objects", !expanded.objects)}
                >
                  <Show when={objects().length > 2}>
                    <text fg={theme.text}>{expanded.objects ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Objects</b>
                  </text>
                </box>
                <Show when={objects().length <= 2 || expanded.objects}>
                  <For each={objects()}>
                    {(o) => (
                      <box flexDirection="row" gap={1}>
                        <text flexShrink={0} style={{ fg: theme.textMuted }}>
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {o.name}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={functions().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => functions().length > 2 && setExpanded("functions", !expanded.functions)}
                >
                  <Show when={functions().length > 2}>
                    <text fg={theme.text}>{expanded.functions ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Functions</b>
                  </text>
                </box>
                <Show when={functions().length <= 2 || expanded.functions}>
                  <For each={functions()}>
                    {(f) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg:
                              {
                                create: theme.success,
                                read: theme.accent,
                                update: theme.warning,
                                delete: theme.error,
                              }[f.action_type] ?? theme.text,
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.accent} flexShrink={0}>
                          {f.action_type.toUpperCase().charAt(0)}
                        </text>
                        <text fg={theme.text} wrapMode="none">
                          {f.name}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
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
                const phaseColor = () => {
                  const p = lc().phase
                  if (p === "idle") return theme.textMuted
                  if (p === "complete") return theme.success
                  return theme.accent
                }
                return (
                  <box flexDirection="row" gap={1} paddingBottom={1}>
                    <text fg={theme.text}>
                      <b>Phase</b>
                    </text>
                    <text fg={phaseColor()}>{phaseLabel()}</text>
                    <Show when={lc().counts.total > 0}>
                      <text fg={theme.textMuted}>
                        ({lc().counts.examined}/{lc().counts.total})
                      </text>
                    </Show>
                  </box>
                )
              }}
            </Show>
            <Show when={retests().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => retests().length > 2 && setExpanded("retests", !expanded.retests)}
                >
                  <Show when={retests().length > 2}>
                    <text fg={theme.text}>{expanded.retests ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Inspection Queue</b>
                    <span style={{ fg: theme.textMuted }}> ({retests().length})</span>
                  </text>
                </box>
                <Show when={retests().length <= 2 || expanded.retests}>
                  <For each={retests().filter((r) => r.status === "pending")}>
                    {(r) => {
                      // One line per pending ENDPOINT scenario: dot + priority + endpoint +
                      // a compact flag summary (how many roles/creds/object-values/signals
                      // accumulated for it) so the reason it's queued is visible at a glance.
                      const f = r.flags ?? {}
                      const parts: string[] = []
                      if (f.credential?.length) parts.push(`${f.credential.length}c`)
                      if (f.role?.length) parts.push(`${f.role.length}r`)
                      if (f.object_value?.length) parts.push(`${f.object_value.length}o`)
                      if (f.signal?.length) parts.push(`${f.signal.length}s`)
                      const flagSummary = parts.join(" ")
                      return (
                        <box flexDirection="row" gap={1} paddingLeft={1}>
                          <text flexShrink={0} style={{ fg: theme.textMuted }}>
                            •
                          </text>
                          <text fg={theme.accent} flexShrink={0}>
                            {{ high: "H", medium: "M", low: "L" }[r.priority] ?? r.priority}
                          </text>
                          <text fg={theme.text} wrapMode="none">
                            {r.endpoint ? `${r.method ?? ""} ${r.endpoint}`.trim() : r.key_hash}
                          </text>
                          <Show when={flagSummary}>
                            <text fg={theme.textMuted} flexShrink={0}>
                              [{flagSummary}]
                            </text>
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Modified Files</b>
                  </text>
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <text fg={theme.textMuted} wrapMode="none">
                            {item.file}
                          </text>
                          <box flexDirection="row" gap={1} flexShrink={0}>
                            <Show when={item.additions}>
                              <text fg={theme.diffAdded}>+{item.additions}</text>
                            </Show>
                            <Show when={item.deletions}>
                              <text fg={theme.diffRemoved}>-{item.deletions}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>Getting started</b>
                  </text>
                  <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                    ✕
                  </text>
                </box>
                <text fg={theme.textMuted}>CyberStrike includes free models so you can start immediately.</text>
                <text fg={theme.textMuted}>
                  Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>Connect provider</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Cyber</b>
            <span style={{ fg: theme.text }}>
              <b>Strike</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
