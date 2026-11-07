import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useTheme, severityColor } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { formatEndpointHost } from "@tui/util/format"

type SectionID = "endpoints" | "roles" | "credentials" | "objects" | "functions" | "signals"

const SIGNAL_SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const SIGNAL_TRIAGE_RANK: Record<string, number> = { new: 0, reviewed: 1, confirmed: 2, dismissed: 3, escalated: 4 }
type WebSignal = {
  ruleId: string
  category: string
  severity: string
  title: string
  method?: string
  endpoint?: string
  owner?: string
  routed?: boolean
  status?: string
  triage?: string
}

export function DialogWebContext(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const listMaxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height / 2) - 8))
  let scroll: ScrollBoxRenderable | undefined

  const sections: { id: SectionID; label: string }[] = [
    { id: "endpoints", label: "Endpoints" },
    { id: "roles", label: "Roles" },
    { id: "credentials", label: "Credentials" },
    { id: "objects", label: "Objects" },
    { id: "functions", label: "Functions" },
    { id: "signals", label: "Signals" },
  ]

  const [section, setSection] = createSignal<SectionID>("endpoints")
  // Signals view: hide "dismissed" by default (checked and ruled out); 'f' toggles. Signals are
  // sorted by (category, severity) so same-category findings sit together — the terminal equivalent
  // of the app's category grouping.
  const [showDismissed, setShowDismissed] = createSignal(false)
  const [index, setIndex] = createSignal(0)
  const [mode, setMode] = createSignal<"list" | "detail">("list")

  const items = createMemo(() => {
    const current = section()
    if (current === "endpoints") return sync.data.request[props.sessionID] ?? []
    if (current === "roles") return sync.data.web_role[props.sessionID] ?? []
    if (current === "credentials") return sync.data.web_credential[props.sessionID] ?? []
    if (current === "objects") return sync.data.web_object[props.sessionID] ?? []
    if (current === "functions") return sync.data.web_function[props.sessionID] ?? []
    if (current === "signals") {
      const all = (sync.data.vortex_signals[props.sessionID]?.signals ?? []) as WebSignal[]
      return all
        .filter((s) => showDismissed() || (s.triage ?? "new") !== "dismissed")
        .slice()
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            (SIGNAL_SEV_RANK[a.severity] ?? 4) - (SIGNAL_SEV_RANK[b.severity] ?? 4),
        )
    }
    return []
  })

  const selectedItem = createMemo(() => {
    const list = items()
    const i = index()
    if (i < 0 || i >= list.length) return undefined
    return list[i]
  })

  const ensureVisible = (i: number) => {
    if (!scroll) return
    const children = scroll.getChildren()
    const child = children[i]
    if (!child) return
    const y = child.y
    const height = scroll.height
    if (y >= height) {
      scroll.scrollBy(y - height + 1)
    }
    if (y < 0) {
      scroll.scrollBy(y)
    }
  }

  const titleSuffix = createMemo(() => {
    const current = section()
    if (current === "endpoints") return "Endpoints"
    if (current === "roles") return "Roles"
    if (current === "credentials") return "Credentials"
    if (current === "objects") return "Objects"
    if (current === "functions") return "Functions"
    if (current === "signals") return showDismissed() ? "Signals (all)" : "Signals"
    return ""
  })

  const moveSection = (direction: number) => {
    const current = section()
    const pos = sections.findIndex((x) => x.id === current)
    if (pos === -1) return
    let next = pos + direction
    if (next >= sections.length) next = 0
    if (next < 0) next = sections.length - 1
    setSection(sections[next].id)
    setIndex(0)
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return

    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      moveSection(-1)
    }

    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      moveSection(1)
    }

    if (evt.name === "up" || evt.name === "k") {
      const list = items()
      if (list.length === 0) return
      evt.preventDefault()
      const next = index() - 1
      const value = next < 0 ? list.length - 1 : next
      setIndex(value)
      ensureVisible(value)
    }

    if (evt.name === "down" || evt.name === "j") {
      const list = items()
      if (list.length === 0) return
      evt.preventDefault()
      const next = index() + 1
      const value = next >= list.length ? 0 : next
      setIndex(value)
      ensureVisible(value)
    }

    if (evt.name === "return") {
      const list = items()
      if (list.length === 0) return
      evt.preventDefault()
      setMode((prev) => (prev === "list" ? "detail" : "list"))
    }

    if (evt.name === "f" && section() === "signals") {
      evt.preventDefault()
      setShowDismissed((v) => !v)
      setIndex(0)
    }

    if (evt.name === "escape") {
      evt.preventDefault()
      if (mode() === "detail") setMode("list")
      else dialog.clear()
    }
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Web context · {titleSuffix()} ({items().length})<Show when={mode() === "detail"}> · Detail</Show>
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <box flexDirection="row" gap={1} paddingTop={1}>
        <For each={sections}>
          {(s) => {
            const active = () => s.id === section()
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                paddingTop={0}
                paddingBottom={0}
                backgroundColor={active() ? theme.primary : undefined}
              >
                <text fg={active() ? theme.selectedListItemText : theme.textMuted}>{s.label}</text>
              </box>
            )
          }}
        </For>
      </box>

      <Show
        when={mode() === "detail" && selectedItem()}
        fallback={
          <Show
            when={items().length > 0}
            fallback={
              <box paddingTop={1}>
                <text fg={theme.textMuted}>No {titleSuffix().toLowerCase()} found for this session.</text>
              </box>
            }
          >
            <box paddingTop={1}>
              <scrollbox
                flexGrow={1}
                maxHeight={listMaxHeight()}
                ref={(r: ScrollBoxRenderable) => {
                  scroll = r
                }}
              >
                <For each={items()}>
                  {(item, i) => {
                    const value = () => item as any
                    const active = () => i() === index()
                    return (
                      <box
                        paddingTop={1}
                        paddingBottom={1}
                        paddingLeft={2}
                        paddingRight={2}
                        backgroundColor={active() ? theme.backgroundElement : undefined}
                        flexDirection="column"
                      >
                        <Show when={section() === "endpoints"}>
                          <EndpointRow item={value()} />
                        </Show>
                        <Show when={section() === "roles"}>
                          <RoleRow item={value()} />
                        </Show>
                        <Show when={section() === "credentials"}>
                          <CredentialRow item={value()} />
                        </Show>
                        <Show when={section() === "objects"}>
                          <ObjectRow item={value()} />
                        </Show>
                        <Show when={section() === "functions"}>
                          <FunctionRow item={value()} />
                        </Show>
                        <Show when={section() === "signals"}>
                          <SignalRow item={value()} />
                        </Show>
                      </box>
                    )
                  }}
                </For>
              </scrollbox>
            </box>
          </Show>
        }
      >
        {(item) => (
          <box paddingTop={1}>
            <scrollbox flexGrow={1} maxHeight={listMaxHeight()} gap={1}>
              <Show when={section() === "endpoints"}>
                <EndpointDetail item={item() as any} />
              </Show>
              <Show when={section() === "roles"}>
                <RoleDetail item={item() as any} />
              </Show>
              <Show when={section() === "credentials"}>
                <CredentialDetail item={item() as any} />
              </Show>
              <Show when={section() === "objects"}>
                <ObjectDetail item={item() as any} />
              </Show>
              <Show when={section() === "functions"}>
                <FunctionDetail item={item() as any} />
              </Show>
              <Show when={section() === "signals"}>
                <SignalDetail item={item() as WebSignal} />
              </Show>
            </scrollbox>
          </box>
        )}
      </Show>

      <box paddingTop={1}>
        <text fg={theme.textMuted}>
          <Show
            when={mode() === "detail"}
            fallback={
              section() === "signals"
                ? "←→ Section  ↑↓ Navigate  Enter Details  f Filter  Esc Close"
                : "←→ Section  ↑↓ Navigate  Enter Details  Esc Close"
            }
          >
            Enter Back Esc Close
          </Show>
        </text>
      </box>
    </box>
  )
}

function EndpointRow(props: {
  item: { method: string; host?: string; port?: number; normalized_path: string; status: string }
}) {
  const { theme } = useTheme()
  const color =
    {
      queued: theme.textMuted,
      processing: theme.warning,
      processed: theme.success,
    }[props.item.status] ?? theme.text

  return (
    <box flexDirection="row" gap={1}>
      <text
        flexShrink={0}
        style={{
          fg: color,
        }}
      >
        •
      </text>
      <text fg={theme.accent} flexShrink={0}>
        {props.item.method}
      </text>
      <text fg={theme.textMuted} flexShrink={0}>
        {formatEndpointHost(props.item.host, props.item.port)}
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.item.normalized_path}
      </text>
    </box>
  )
}

function RoleRow(props: { item: { name: string; level?: number } }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} style={{ fg: theme.accent }}>
        •
      </text>
      <text fg={theme.text} wrapMode="word">
        {props.item.name}
        <Show when={props.item.level != null}>
          <span style={{ fg: theme.textMuted }}> L{props.item.level}</span>
        </Show>
      </text>
    </box>
  )
}

function SignalRow(props: { item: WebSignal }) {
  const { theme } = useTheme()
  const sevColor = () => severityColor(theme, props.item.severity)
  const triageColor = () => {
    const t = props.item.triage ?? "new"
    if (t === "confirmed" || t === "escalated") return theme.warning
    if (t === "reviewed") return theme.accent
    return theme.textMuted
  }
  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} style={{ fg: sevColor() }}>
        •
      </text>
      <text flexShrink={0} style={{ fg: triageColor() }}>
        [{props.item.triage ?? "new"}]
      </text>
      <text fg={theme.textMuted} flexShrink={0}>
        {props.item.category}
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.item.title}
      </text>
    </box>
  )
}

function SignalDetail(props: { item: WebSignal }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} wrapMode="word">
        {props.item.title}
      </text>
      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>severity:</text>
        <text fg={theme.text}>{props.item.severity}</text>
        <text fg={theme.textMuted}>triage:</text>
        <text fg={theme.text}>{props.item.triage ?? "new"}</text>
        <text fg={theme.textMuted}>category:</text>
        <text fg={theme.text}>{props.item.category}</text>
      </box>
      <Show when={props.item.endpoint}>
        <text fg={theme.textMuted} wrapMode="none">
          {props.item.method ? `${props.item.method} ` : ""}
          {props.item.endpoint}
        </text>
      </Show>
      <text fg={theme.textMuted}>rule: {props.item.ruleId}</text>
      <Show when={props.item.routed}>
        <text fg={theme.textMuted}>
          → {props.item.owner ?? props.item.category}
          {props.item.status ? ` · ${props.item.status}` : ""}
        </text>
      </Show>
    </box>
  )
}

function CredentialRow(props: { item: { type: string; label: string } }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} style={{ fg: theme.success }}>
        •
      </text>
      <text fg={theme.accent} flexShrink={0}>
        {props.item.type}
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.item.label}
      </text>
    </box>
  )
}

function ObjectRow(props: { item: { name: string } }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} style={{ fg: theme.textMuted }}>
        •
      </text>
      <text fg={theme.text} wrapMode="word">
        {props.item.name}
      </text>
    </box>
  )
}

function FunctionRow(props: { item: { name: string; action_type: string } }) {
  const { theme } = useTheme()
  const color =
    {
      create: theme.success,
      read: theme.accent,
      update: theme.warning,
      delete: theme.error,
    }[props.item.action_type] ?? theme.text

  return (
    <box flexDirection="row" gap={1}>
      <text
        flexShrink={0}
        style={{
          fg: color,
        }}
      >
        •
      </text>
      <text fg={theme.accent} flexShrink={0}>
        {props.item.action_type.toUpperCase().charAt(0)}
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.item.name}
      </text>
    </box>
  )
}

function DetailLine(props: { label: string; value: string | number | undefined; wrap?: boolean }) {
  const { theme } = useTheme()
  if (props.value === undefined || props.value === "") return null
  return (
    <box flexDirection="row" gap={1}>
      <text fg={theme.textMuted} flexShrink={0}>
        {props.label}:
      </text>
      <text fg={theme.text} wrapMode={props.wrap ? "word" : "none"}>
        {String(props.value)}
      </text>
    </box>
  )
}

function EndpointDetail(props: { item: Record<string, unknown> }) {
  const { theme } = useTheme()
  const item = props.item
  const statusColor =
    { queued: theme.textMuted, processing: theme.warning, processed: theme.success }[item.status as string] ??
    theme.text
  return (
    <box gap={1}>
      <box flexDirection="row" gap={1}>
        <text fg={statusColor}>{item.method as string}</text>
        <text fg={theme.text} wrapMode="word">
          {item.normalized_path as string}
        </text>
      </box>
      <DetailLine label="Status" value={item.status as string} />
      <DetailLine label="ID" value={item.id as string} />
      <DetailLine label="Credential ID" value={item.credential_id as string} />
      <DetailLine label="Body hash" value={item.body_hash as string} />
      <DetailLine label="Query hash" value={item.query_hash as string} />
      <DetailLine label="Response status" value={item.response_status as number} />
      <DetailLine label="Response content-type" value={item.response_content_type as string} />
      <DetailLine label="Response size" value={item.response_size as number} />
      <Show when={item.raw_request}>
        <box gap={0}>
          <text fg={theme.textMuted}>Raw request:</text>
          <text fg={theme.text} wrapMode="word">
            {String(item.raw_request).slice(0, 500)}
            {(item.raw_request as string)?.length > 500 ? "…" : ""}
          </text>
        </box>
      </Show>
      <Show when={item.response_headers && Object.keys(item.response_headers as object).length > 0}>
        <box gap={0}>
          <text fg={theme.textMuted}>Response headers:</text>
          <For each={Object.entries(item.response_headers as Record<string, string>)}>
            {([k, v]) => (
              <text fg={theme.text} wrapMode="word">
                {k}: {v}
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={item.processed_response}>
        <box gap={0}>
          <text fg={theme.textMuted}>Processed response:</text>
          <text fg={theme.text} wrapMode="word">
            {String(item.processed_response).slice(0, 400)}
            {(item.processed_response as string)?.length > 400 ? "…" : ""}
          </text>
        </box>
      </Show>
      <Show when={item.time}>
        <DetailLine
          label="Updated"
          value={
            item.time && (item.time as { updated?: number }).updated
              ? new Date((item.time as { updated: number }).updated).toISOString()
              : undefined
          }
        />
      </Show>
    </box>
  )
}

function RoleDetail(props: { item: Record<string, unknown> }) {
  const { theme } = useTheme()
  const item = props.item
  return (
    <box gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {item.name as string}
        <Show when={item.level != null}>
          <span style={{ fg: theme.textMuted }}> (Level {item.level})</span>
        </Show>
      </text>
      <DetailLine label="ID" value={item.id as string} />
      <DetailLine label="Discovered from" value={item.discovered_from as string} />
      <Show when={item.time}>
        <DetailLine
          label="Updated"
          value={
            item.time && (item.time as { updated?: number }).updated
              ? new Date((item.time as { updated: number }).updated).toISOString()
              : undefined
          }
        />
      </Show>
    </box>
  )
}

function CredentialDetail(props: { item: Record<string, unknown> }) {
  const { theme } = useTheme()
  const item = props.item
  const headers = item.headers as Record<string, string> | undefined
  return (
    <box gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {item.label as string}
      </text>
      <DetailLine label="ID" value={item.id as string} />
      <DetailLine label="Type" value={item.type as string} />
      <DetailLine label="Container ID" value={item.container_id as string} />
      <DetailLine label="Role ID" value={item.role_id as string} />
      <Show when={headers && Object.keys(headers).length > 0}>
        <box gap={0}>
          <text fg={theme.textMuted}>Headers:</text>
          <For each={Object.entries(headers ?? {})}>
            {([k, v]) => (
              <text fg={theme.text} wrapMode="word">
                {k}: {v}
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={item.time}>
        <DetailLine
          label="Updated"
          value={
            item.time && (item.time as { updated?: number }).updated
              ? new Date((item.time as { updated: number }).updated).toISOString()
              : undefined
          }
        />
      </Show>
    </box>
  )
}

function ObjectDetail(props: { item: Record<string, unknown> }) {
  const { theme } = useTheme()
  const item = props.item
  const fields = item.fields as string[] | undefined
  const sensitive = item.sensitive_fields as string[] | undefined
  const idFields = item.id_fields as string[] | undefined
  return (
    <box gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        {item.name as string}
      </text>
      <DetailLine label="ID" value={item.id as string} />
      <DetailLine label="Discovered from" value={item.discovered_from as string} />
      <Show when={fields?.length}>
        <box gap={0}>
          <text fg={theme.textMuted}>Fields:</text>
          <text fg={theme.text} wrapMode="word">
            {fields!.join(", ")}
          </text>
        </box>
      </Show>
      <Show when={sensitive?.length}>
        <box gap={0}>
          <text fg={theme.textMuted}>Sensitive fields:</text>
          <text fg={theme.text} wrapMode="word">
            {sensitive!.join(", ")}
          </text>
        </box>
      </Show>
      <Show when={idFields?.length}>
        <box gap={0}>
          <text fg={theme.textMuted}>ID fields:</text>
          <text fg={theme.text} wrapMode="word">
            {idFields!.join(", ")}
          </text>
        </box>
      </Show>
      <Show when={item.time}>
        <DetailLine
          label="Updated"
          value={
            item.time && (item.time as { updated?: number }).updated
              ? new Date((item.time as { updated: number }).updated).toISOString()
              : undefined
          }
        />
      </Show>
    </box>
  )
}

function FunctionDetail(props: { item: Record<string, unknown> }) {
  const { theme } = useTheme()
  const item = props.item
  const color =
    { create: theme.success, read: theme.accent, update: theme.warning, delete: theme.error }[
      item.action_type as string
    ] ?? theme.text
  const objects = item.objects as string[] | undefined
  return (
    <box gap={1}>
      <box flexDirection="row" gap={1}>
        <text fg={color}>{String(item.action_type).toUpperCase()}</text>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {item.name as string}
        </text>
      </box>
      <DetailLine label="ID" value={item.id as string} />
      <DetailLine label="Request ID" value={item.request_id as string} />
      <DetailLine label="Role ID" value={item.role_id as string} />
      <Show when={objects?.length}>
        <box gap={0}>
          <text fg={theme.textMuted}>Objects:</text>
          <text fg={theme.text} wrapMode="word">
            {objects!.join(", ")}
          </text>
        </box>
      </Show>
      <Show when={item.time}>
        <DetailLine
          label="Updated"
          value={
            item.time && (item.time as { updated?: number }).updated
              ? new Date((item.time as { updated: number }).updated).toISOString()
              : undefined
          }
        />
      </Show>
    </box>
  )
}
