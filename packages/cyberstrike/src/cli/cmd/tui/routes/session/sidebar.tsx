import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@cyberstrikeus/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const vulnerability = createMemo(() => sync.data.vulnerability[props.sessionID] ?? [])
  const requests = createMemo(() => sync.data.request[props.sessionID] ?? [])
  const credentials = createMemo(() => sync.data.web_credential[props.sessionID] ?? [])
  const roles = createMemo(() => sync.data.web_role[props.sessionID] ?? [])
  const objects = createMemo(() => sync.data.web_object[props.sessionID] ?? [])
  const functions = createMemo(() => sync.data.web_function[props.sessionID] ?? [])
  const retests = createMemo(() => sync.data.web_retest[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    vulnerability: true,
    lsp: true,
    requests: true,
    credentials: true,
    roles: true,
    objects: true,
    functions: true,
    retests: true,
  })

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

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
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
                <b>Context</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% used</text>
              <text fg={theme.textMuted}>{cost()} spent</text>
            </box>
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
                    <b>MCP</b>
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
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>LSP</b>
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>
                    {sync.data.config.lsp === false
                      ? "LSPs have been disabled in settings"
                      : "LSPs will activate as files are read"}
                  </text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
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
                  <For each={vulnerability()}>
                    {(v) => (
                      <box flexDirection="row" gap={1}>
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
            </Show>
            <Show when={requests().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => requests().length > 2 && setExpanded("requests", !expanded.requests)}
                >
                  <Show when={requests().length > 2}>
                    <text fg={theme.text}>{expanded.requests ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Endpoints</b>
                  </text>
                </box>
                <Show when={requests().length <= 2 || expanded.requests}>
                  <For each={requests()}>
                    {(r) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg:
                              {
                                queued: theme.textMuted,
                                processing: theme.warning,
                                processed: theme.success,
                              }[r.status] ?? theme.text,
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
                      </box>
                    )}
                  </For>
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
                    <b>Retest Queue</b>
                    <span style={{ fg: theme.textMuted }}> ({retests().length})</span>
                  </text>
                </box>
                <Show when={retests().length <= 2 || expanded.retests}>
                  <For each={retests()}>
                    {(r) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg:
                              {
                                pending: theme.textMuted,
                                processing: theme.warning,
                                completed: theme.success,
                              }[r.status] ?? theme.text,
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.accent} flexShrink={0}>
                          {r.priority}
                        </text>
                        <text fg={theme.textMuted} wrapMode="none">
                          {r.status}
                        </text>
                      </box>
                    )}
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
            <span style={{ fg: theme.success }}>•</span> <b>Open</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
