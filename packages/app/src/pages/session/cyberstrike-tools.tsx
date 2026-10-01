import { createMemo, createSignal, For, Show } from "solid-js"
import { ToolRegistry } from "@cyberstrike-io/session-ui/message-part"
import { BasicTool } from "@cyberstrike-io/session-ui/basic-tool"
import { TextShimmer } from "@cyberstrike-io/ui/text-shimmer"
import { Icon } from "@cyberstrike-io/ui/icon"

const UPSTREAM_TOOLS = new Set([
  "read", "list", "glob", "grep", "webfetch", "websearch",
  "task", "shell", "bash", "edit", "write", "patch", "apply_patch",
  "todowrite", "question", "skill",
])

function statusColor(code: number) {
  if (code >= 500) return "text-text-critical-base"
  if (code >= 400) return "text-icon-warning-base"
  if (code >= 300) return "text-text-accent-base"
  if (code >= 200) return "text-icon-success-base"
  return "text-text-weaker"
}

function tryParseJSON(s: string | undefined): Record<string, unknown> | undefined {
  if (!s) return undefined
  try { return JSON.parse(s) }
  catch { return undefined }
}

function smartLabel(input: Record<string, unknown>): string {
  for (const key of ["url", "target_url", "path", "filePath", "name", "description", "query", "request_id", "sessionID"]) {
    const v = input[key]
    if (typeof v === "string" && v) return v.length > 80 ? v.slice(0, 80) + "…" : v
  }
  const target = input.target as Record<string, unknown> | undefined
  if (target) {
    const method = target.method as string | undefined
    const url = target.url as string | undefined
    if (method && url) return `${method} ${url}`
    if (url) return url
  }
  return ""
}

function smartArgs(input: Record<string, unknown>): string[] {
  const skip = new Set(["url", "target_url", "path", "filePath", "name", "description", "query", "request_id", "sessionID", "target"])
  const out: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (skip.has(key)) continue
    if (typeof value === "string") out.push(`${key}=${value.length > 40 ? value.slice(0, 40) + "…" : value}`)
    else if (typeof value === "number" || typeof value === "boolean") out.push(`${key}=${value}`)
    else if (Array.isArray(value)) out.push(`${key}=[${value.length}]`)
    if (out.length >= 3) break
  }
  return out
}

function formatToolName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function CyberStrikeToolRenderer(props: {
  tool: string
  input: Record<string, unknown>
  output?: string
  status?: string
  metadata?: Record<string, unknown>
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const pending = () => props.status === "pending" || props.status === "running"
  const label = createMemo(() => smartLabel(props.input))
  const args = createMemo(() => smartArgs(props.input))
  const parsed = createMemo(() => tryParseJSON(props.output))
  const statusCode = createMemo(() => {
    const p = parsed()
    const s = p?.status
    return typeof s === "number" ? s : undefined
  })

  const [copied, setCopied] = createSignal(false)
  const copyOutput = async () => {
    if (!props.output) return
    try {
      await navigator.clipboard.writeText(props.output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* */ }
  }

  return (
    <BasicTool
      {...props}
      icon="mcp"
      allowOpenWhilePending
      trigger={(open) => (
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={formatToolName(props.tool)} active={pending()} />
            </span>
            <Show when={!open() && label()}>
              <span data-slot="basic-tool-tool-subtitle">{label()}</span>
            </Show>
            <Show when={!open() && statusCode()}>
              {(code) => (
                <span class={`text-12-medium ${statusColor(code())}`}>{code()}</span>
              )}
            </Show>
            <Show when={!open() && args().length > 0}>
              <For each={args()}>
                {(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}
              </For>
            </Show>
          </div>
        </div>
      )}
    >
      <div class="flex flex-col gap-1 p-3 font-mono text-12-regular" dir="ltr">
        {/* Input summary */}
        <Show when={Object.keys(props.input).length > 0}>
          <div class="flex flex-col gap-0.5">
            <span class="text-10-medium text-text-weaker uppercase tracking-wider">Input</span>
            <pre class="text-11-regular text-text-base whitespace-pre-wrap break-all max-h-32 overflow-auto bg-surface-inset-base rounded p-2">
              {JSON.stringify(props.input, null, 2)}
            </pre>
          </div>
        </Show>

        {/* Output */}
        <Show when={props.output}>
          <div class="flex flex-col gap-0.5">
            <div class="flex items-center justify-between">
              <span class="text-10-medium text-text-weaker uppercase tracking-wider">Output</span>
              <button
                type="button"
                class="flex items-center gap-1 text-10-regular text-text-accent cursor-pointer hover:underline"
                onClick={copyOutput}
              >
                <Icon name={copied() ? "check" : "copy"} size="small" class="w-3 h-3" />
                {copied() ? "Copied" : "Copy"}
              </button>
            </div>
            <pre class="text-11-regular text-text-base whitespace-pre-wrap break-all max-h-64 overflow-auto bg-surface-inset-base rounded p-2">
              {props.output}
            </pre>
          </div>
        </Show>

        <Show when={pending()}>
          <span class="text-text-weaker">Running…</span>
        </Show>
      </div>
    </BasicTool>
  )
}

// HTTP replay gets a specialized renderer
function HttpReplayRenderer(props: {
  tool: string
  input: Record<string, unknown>
  output?: string
  status?: string
  metadata?: Record<string, unknown>
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const pending = () => props.status === "pending" || props.status === "running"
  const parsed = createMemo(() => tryParseJSON(props.output))

  const info = createMemo(() => {
    const target = props.input.target as { method?: string; url?: string } | undefined
    const method = target?.method ?? "?"
    const url = target?.url
    const reqId = props.input.request_id as string | undefined
    let subtitle = ""
    if (url) {
      try { subtitle = new URL(url).pathname + new URL(url).search }
      catch { subtitle = url }
    } else if (reqId) {
      subtitle = reqId.length > 12 ? reqId.slice(0, 12) + "…" : reqId
    }
    const tags: string[] = []
    const mutations = props.input.mutations as unknown[] | undefined
    if (mutations?.length) tags.push(`${mutations.length} mutation${mutations.length > 1 ? "s" : ""}`)
    if (props.input.credential) tags.push("cred swap")
    if (props.input.unauthenticated) tags.push("unauth")
    if (props.input.compare) tags.push("compare")
    if (props.input.sweep) tags.push("sweep")
    return { method, subtitle, tags }
  })

  const statusCode = createMemo(() => {
    const s = parsed()?.status
    return typeof s === "number" ? s : undefined
  })

  const [copied, setCopied] = createSignal(false)
  const copyCurl = async () => {
    const curl = parsed()?.curl as string | undefined
    if (!curl) return
    try {
      await navigator.clipboard.writeText(curl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* */ }
  }

  return (
    <BasicTool
      {...props}
      icon="link"
      allowOpenWhilePending
      trigger={(open) => (
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer
                text={props.tool === "http_replay_raw" ? "Http Replay Raw" : "Http Replay"}
                active={pending()}
              />
            </span>
            <Show when={!open()}>
              <span data-slot="basic-tool-tool-subtitle">
                {info().method} {info().subtitle || "request"}
              </span>
              <Show when={statusCode()}>
                {(code) => <span class={`text-12-medium ${statusColor(code())}`}>{code()}</span>}
              </Show>
              <Show when={info().tags.length > 0}>
                <span data-slot="basic-tool-tool-arg">{info().tags.join(" · ")}</span>
              </Show>
            </Show>
          </div>
        </div>
      )}
    >
      <div class="flex flex-col gap-2 p-3 font-mono" dir="ltr">
        <Show when={parsed()}>
          {(p) => {
            const target = () => p().target as { method?: string; origin?: string; request_target?: string } | undefined
            const bodyPreview = () => p().body_preview as string | undefined
            return (
              <div class="flex flex-col gap-2">
                <Show when={target()}>
                  {(t) => (
                    <div class="text-text-weak text-11-regular">
                      {t().method} {t().origin}{t().request_target}
                    </div>
                  )}
                </Show>
                <Show when={statusCode()}>
                  {(s) => (
                    <div class="flex items-center gap-3">
                      <span class={`text-14-medium ${statusColor(s())}`}>
                        {s()} {p().reason as string}
                      </span>
                      <Show when={p().timing_ms}>
                        {(t) => <span class="text-text-weaker text-11-regular">{t() as number}ms</span>}
                      </Show>
                      <Show when={p().body_len}>
                        {(bl) => <span class="text-text-weaker text-11-regular">{(bl() as number).toLocaleString()} bytes</span>}
                      </Show>
                    </div>
                  )}
                </Show>
                <Show when={p().error}>
                  {(e) => <div class="text-text-critical-base text-12-regular">{e() as string}</div>}
                </Show>
                <Show when={bodyPreview()}>
                  {(bp) => (
                    <div class="max-h-48 overflow-auto rounded bg-surface-inset-base p-2">
                      <pre class="text-11-regular text-text-base whitespace-pre-wrap break-all">{bp()}</pre>
                    </div>
                  )}
                </Show>
                <Show when={p().curl}>
                  <button
                    type="button"
                    class="flex items-center gap-1 text-11-regular text-text-accent cursor-pointer hover:underline self-start"
                    onClick={copyCurl}
                  >
                    <Icon name={copied() ? "check" : "copy"} size="small" class="w-3 h-3" />
                    {copied() ? "Copied" : "Copy curl"}
                  </button>
                </Show>
              </div>
            )
          }}
        </Show>
        <Show when={!parsed() && props.output}>
          <pre class="text-11-regular text-text-base whitespace-pre-wrap break-all max-h-64 overflow-auto bg-surface-inset-base rounded p-2">
            {props.output}
          </pre>
        </Show>
        <Show when={pending()}>
          <span class="text-text-weaker text-12-regular">Sending request…</span>
        </Show>
      </div>
    </BasicTool>
  )
}

// Register http_replay with specialized renderer
ToolRegistry.register({ name: "http_replay", render: HttpReplayRenderer })
ToolRegistry.register({ name: "http_replay_raw", render: HttpReplayRenderer })

// Register all other CyberStrike tools with the smart generic renderer
const CS_TOOLS = [
  "access_probe", "add_intel", "attack_script", "batch",
  "business_test", "ci_audit", "cipipe", "cloud_audit",
  "cloud_get_context", "cloud_record_asset", "cloud_record_edge",
  "cloud_record_exposure", "codesearch", "containerhook", "crypto_probe",
  "csrf_extract", "ebpf", "enrich_vulnerability", "ensure_tools",
  "error_probe", "generate_report", "get_coverage_notes", "hackbrowser",
  "iachook", "identity_probe", "inject_probe", "invalid",
  "k8s_audit", "kubehook", "linuxhook", "list_loaded_tools",
  "llmhook", "load_tools", "login_probe", "lsp", "machook",
  "memory_context", "memory_read", "memory_search", "memory_write",
  "methodology_status", "misconfig_test", "multiedit",
  "recon_test", "record_coverage_note", "report_vulnerability",
  "scope_check", "session_probe", "tool_search",
  "triage_vulnerability", "unload_tools", "update_vrt_check",
  "web_action", "web_get_detail", "web_get_page_state",
  "web_get_request_detail", "web_get_session_context",
  "web_get_vuln_detail", "web_get_vulnerabilities",
  "web_update_credential", "web_update_credential_claims",
  "web_write_function", "web_write_object", "web_write_object_value",
  "web_write_role", "winhook",
]

for (const name of CS_TOOLS) {
  if (!UPSTREAM_TOOLS.has(name)) {
    ToolRegistry.register({ name, render: CyberStrikeToolRenderer })
  }
}
