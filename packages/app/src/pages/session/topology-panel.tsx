import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useParams } from "@solidjs/router"
import type {
  TopologyGetResponse,
  TopologyNmapDiffResponse,
  TopologyNmapScansResponse,
  TopologyNotesResponse,
} from "@cyberstrike-io/sdk/v2/client"
import { Icon } from "@cyberstrike-io/ui/icon"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { usePrompt } from "@/context/prompt"

type Node = TopologyGetResponse["nodes"][number]
type Kind = Node["kind"]

const kinds: Array<{ id: Kind; label: string }> = [
  { id: "asset", label: "Assets" },
  { id: "host", label: "Hosts" },
  { id: "service", label: "Services" },
  { id: "endpoint", label: "Endpoints" },
  { id: "identity", label: "Identities" },
  { id: "finding", label: "Findings" },
  { id: "fact", label: "Facts" },
]

const color = (node: Node) => {
  if (node.kind === "finding") {
    if (node.severity === "critical") return "#e5484d"
    if (node.severity === "high") return "#f76808"
    return "#d99a00"
  }
  if (node.kind === "asset") return "#8e4ec6"
  if (node.kind === "host") return "#0091ff"
  if (node.kind === "endpoint") return "#30a46c"
  if (node.kind === "identity") return "#e54d2e"
  if (node.kind === "service") return "#ab6400"
  return "#687076"
}

export function TopologyPanel() {
  const params = useParams()
  const sdk = useSDK()
  const server = useServer()
  const prompt = usePrompt()
  const [graph, setGraph] = createStore<TopologyGetResponse>({
    sessionID: "",
    nodes: [],
    edges: [],
    time: 0,
  })
  const [kind, setKind] = createSignal<Kind | "all">("all")
  const [search, setSearch] = createSignal("")
  const [selected, setSelected] = createSignal("")
  const [zoom, setZoom] = createSignal(1)
  const [error, setError] = createSignal("")
  const [notes, setNotes] = createStore<TopologyNotesResponse>([])
  const [scans, setScans] = createStore<TopologyNmapScansResponse>([])
  const [diff, setDiff] = createSignal<TopologyNmapDiffResponse>()
  const [from, setFrom] = createSignal("")
  const [to, setTo] = createSignal("")
  const [importing, setImporting] = createSignal(false)
  const [draft, setDraft] = createStore({ content: "", link: "", saving: false })
  const [scan, setScan] = createStore({
    target: "",
    profile: "service" as "quick" | "service" | "os" | "comprehensive",
  })
  let fileInput!: HTMLInputElement
  let generation = 0

  const load = async () => {
    const sessionID = params.id
    if (!sessionID) return false
    const request = ++generation
    try {
      const [topology, noteList, history] = await Promise.all([
        sdk.client.topology.get({ sessionID }),
        sdk.client.topology.notes({ sessionID }),
        sdk.client.topology.nmapScans({ sessionID }),
      ])
      if (request !== generation || params.id !== sessionID || !topology.data) return false
      setGraph(reconcile(topology.data))
      setNotes(reconcile(noteList.data ?? []))
      setScans(reconcile(history.data ?? []))
      const available = history.data ?? []
      if (available.length >= 2 && (!available.some((scan) => scan.id === from()) || !available.some((scan) => scan.id === to()))) {
        setFrom(available.at(-2)!.id)
        setTo(available.at(-1)!.id)
      }
      setError("")
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }

  createEffect(() => {
    params.id
    setFrom("")
    setTo("")
    setDiff(undefined)
    let alive = true
    void load()
    const timer = setInterval(() => {
      if (alive) void load()
    }, 10_000)
    onCleanup(() => {
      alive = false
      generation++
      clearInterval(timer)
    })
  })

  createEffect(() => {
    const sessionID = params.id
    const baseline = from()
    const current = to()
    if (!sessionID || !baseline || !current || baseline === current) {
      setDiff(undefined)
      return
    }
    sdk.client.topology
      .nmapDiff({ sessionID, from: baseline, to: current })
      .then((response) => setDiff(response.data))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  })

  const profile = {
    quick: "-T4 -F",
    service: "-T4 -sV",
    os: "-T4 -sV -O",
    comprehensive: "-T4 -sV -O -sC",
  } as const
  const command = () =>
    `nmap ${profile[scan.profile]} --stats-every 5s -oX - ${scan.target.trim() || "<authorized-target>"}`
  const prepareScan = () => {
    const target = scan.target.trim()
    if (!target) return
    const value = `Run the built-in nmap_scan tool against the explicitly authorized target ${target} with the ${scan.profile} profile. Preview the exact command (${command()}), confirm scope and expected impact, and wait for my approval before starting. Persist the XML result into topology and compare it with prior scans.`
    prompt.set([{ type: "text", content: value, start: 0, end: value.length }], value.length)
  }

  const importScan = async (file?: File) => {
    const sessionID = params.id
    if (!file || !sessionID || importing() || server.role() === "observer") return
    if (file.size > 10 * 1024 * 1024) {
      setError("Nmap XML exceeds the 10 MiB import limit")
      return
    }

    setImporting(true)
    try {
      await sdk.client.topology.nmapImport({
        sessionID,
        name: file.name.replace(/\.xml$/i, ""),
        xml: await file.text(),
      })
      await load()
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setImporting(false)
      fileInput.value = ""
    }
  }

  const visible = createMemo(() => {
    const query = search().trim().toLowerCase()
    return graph.nodes.filter((node) => {
      if (kind() !== "all" && node.kind !== kind()) return false
      if (!query) return true
      return `${node.label} ${node.kind} ${node.source} ${node.status ?? ""} ${node.severity ?? ""}`
        .toLowerCase()
        .includes(query)
    })
  })
  const ids = createMemo(() => new Set(visible().map((node) => node.id)))
  const columns = createMemo(() =>
    kinds
      .map((item) => ({ ...item, nodes: visible().filter((node) => node.kind === item.id) }))
      .filter((item) => item.nodes.length > 0),
  )
  const width = createMemo(() => Math.max(760, columns().length * 190 + 80))
  const height = createMemo(() => Math.max(420, Math.max(1, ...columns().map((column) => column.nodes.length)) * 82 + 80))
  const positions = createMemo(() => {
    const result = new Map<string, { x: number; y: number }>()
    columns().forEach((column, x) => {
      column.nodes.forEach((node, y) => {
        result.set(node.id, { x: 70 + x * 190, y: 70 + y * 82 })
      })
    })
    return result
  })
  const edges = createMemo(() =>
    graph.edges.filter((edge) => ids().has(edge.source) && ids().has(edge.target)),
  )
  const current = createMemo(() => graph.nodes.find((node) => node.id === selected()))
  const currentNotes = createMemo(() => notes.filter((note) => note.entityID === selected()))

  const addNote = async () => {
    const sessionID = params.id
    const entityID = selected()
    const content = draft.content.trim()
    if (!sessionID || !entityID || !content || draft.saving || server.role() === "observer") return
    setDraft("saving", true)
    setError("")
    try {
      const response = await sdk.client.topology.noteCreate({
        sessionID,
        entityID,
        title: "Operator note",
        content,
        links: draft.link.trim() ? [draft.link.trim()] : [],
        tags: ["human-confirmed"],
      })
      if (response.data) setNotes(notes.length, response.data)
      setDraft({ content: "", link: "", saving: false })
    } catch (cause) {
      setDraft("saving", false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const removeNote = async (id: string) => {
    const sessionID = params.id
    if (!sessionID || server.role() === "observer") return
    try {
      await sdk.client.topology.noteDelete({ sessionID, noteID: id })
      setNotes(reconcile(notes.filter((note) => note.id !== id)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div class="h-full min-h-0 flex flex-col bg-background-stronger">
      <div class="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border-weak-base overflow-x-auto">
        <button
          type="button"
          class="h-6 px-2 rounded text-11-medium"
          classList={{
            "bg-surface-base text-text-strong": kind() === "all",
            "text-text-weak hover:text-text-base": kind() !== "all",
          }}
          onClick={() => setKind("all")}
        >
          All {graph.nodes.length}
        </button>
        <For each={kinds}>
          {(item) => {
            const count = createMemo(() => graph.nodes.filter((node) => node.kind === item.id).length)
            return (
              <Show when={count() > 0}>
                <button
                  type="button"
                  class="h-6 px-2 rounded text-11-medium"
                  classList={{
                    "bg-surface-base text-text-strong": kind() === item.id,
                    "text-text-weak hover:text-text-base": kind() !== item.id,
                  }}
                  onClick={() => setKind(item.id)}
                >
                  {item.label} {count()}
                </button>
              </Show>
            )
          }}
        </For>
        <div class="flex-1 min-w-2" />
        <input
          type="search"
          value={search()}
          placeholder="Filter topology"
          class="h-6 w-40 px-2 rounded bg-surface-inset-base text-11-regular text-text-base outline-none placeholder:text-text-weaker"
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
        <button
          type="button"
          class="size-6 rounded text-text-weak hover:text-text-base"
          title="Zoom out"
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
        >
          −
        </button>
        <button
          type="button"
          class="w-10 h-6 rounded text-10-mono text-text-weaker hover:text-text-base"
          title="Reset zoom"
          onClick={() => setZoom(1)}
        >
          {Math.round(zoom() * 100)}%
        </button>
        <button
          type="button"
          class="size-6 rounded text-text-weak hover:text-text-base"
          title="Zoom in"
          onClick={() => setZoom((value) => Math.min(2, value + 0.1))}
        >
          +
        </button>
      </div>
      <Show when={scans.length > 0 || server.role() !== "observer"}>
        <div class="shrink-0 flex flex-col border-b border-border-weak-base bg-background-stronger">
          <div class="flex items-center gap-2 px-2 py-1.5 overflow-x-auto">
            <span class="text-10-medium text-text-weaker uppercase tracking-wider shrink-0">Nmap · {scans.length}</span>
            <Show when={scans.length >= 2}>
              <select
                value={from()}
                aria-label="Baseline Nmap scan"
                class="h-6 max-w-40 px-1.5 rounded bg-surface-inset-base text-10-regular text-text-base"
                onChange={(event) => setFrom(event.currentTarget.value)}
              >
                <For each={scans}>{(scan) => <option value={scan.id}>{scan.name}</option>}</For>
              </select>
              <span class="text-10-regular text-text-weaker">→</span>
              <select
                value={to()}
                aria-label="Current Nmap scan"
                class="h-6 max-w-40 px-1.5 rounded bg-surface-inset-base text-10-regular text-text-base"
                onChange={(event) => setTo(event.currentTarget.value)}
              >
                <For each={scans}>{(scan) => <option value={scan.id}>{scan.name}</option>}</For>
              </select>
            </Show>
            <Show when={diff()}>
              {(change) => (
                <div class="flex items-center gap-1 shrink-0">
                  <span class="px-1.5 py-0.5 rounded bg-surface-success-base text-10-medium text-text-success-base">
                    +{change().addedHosts.length} hosts
                  </span>
                  <span class="px-1.5 py-0.5 rounded bg-surface-critical-base text-10-medium text-text-critical-base">
                    −{change().removedHosts.length} hosts
                  </span>
                  <span class="px-1.5 py-0.5 rounded bg-surface-warning-base text-10-medium text-text-warning-base">
                    {change().changedHosts.length} changed
                  </span>
                </div>
              )}
            </Show>
            <div class="flex-1 min-w-2" />
            <Show when={server.role() !== "observer"}>
              <input
                ref={fileInput}
                type="file"
                accept=".xml,text/xml,application/xml"
                class="hidden"
                onChange={(event) => void importScan(event.currentTarget.files?.[0])}
              />
              <button
                type="button"
                class="h-6 px-2 rounded bg-surface-base text-10-medium text-text-accent disabled:opacity-50 shrink-0"
                disabled={importing()}
                onClick={() => fileInput.click()}
              >
                {importing() ? "Importing..." : "Import XML"}
              </button>
            </Show>
          </div>
          <Show when={server.role() !== "observer"}>
            <div class="flex items-center gap-2 px-2 pb-1.5">
              <input
                value={scan.target}
                placeholder="Authorized domain, IP, range, or CIDR"
                aria-label="Nmap target"
                class="h-7 min-w-48 flex-1 px-2 rounded bg-surface-inset-base text-10-mono text-text-base outline-none placeholder:text-text-weaker"
                onInput={(event) => setScan("target", event.currentTarget.value)}
              />
              <select
                value={scan.profile}
                aria-label="Nmap profile"
                class="h-7 px-2 rounded bg-surface-inset-base text-10-regular text-text-base"
                onChange={(event) => setScan("profile", event.currentTarget.value as typeof scan.profile)}
              >
                <option value="quick">Quick</option>
                <option value="service">Service</option>
                <option value="os">OS</option>
                <option value="comprehensive">Comprehensive</option>
              </select>
              <button
                type="button"
                class="h-7 px-2 rounded bg-surface-accent-base text-10-medium text-text-accent-base disabled:opacity-50"
                disabled={!scan.target.trim()}
                title={command()}
                onClick={prepareScan}
              >
                Prepare scan
              </button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={error()}>
        <div class="shrink-0 px-3 py-1.5 bg-surface-critical-base text-11-regular text-text-critical-base">{error()}</div>
      </Show>
      <div class="flex-1 min-h-0 flex">
        <div class="flex-1 min-w-0 overflow-auto bg-surface-inset-base">
          <Show
            when={visible().length > 0}
            fallback={<div class="h-full flex items-center justify-center text-12-regular text-text-weaker">No topology yet</div>}
          >
            <svg
              width={width() * zoom()}
              height={height() * zoom()}
              viewBox={`0 0 ${width()} ${height()}`}
              role="img"
              aria-label="Engagement topology"
            >
              <defs>
                <marker id="topology-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="#687076" />
                </marker>
              </defs>
              <For each={columns()}>
                {(column, index) => (
                  <text x={70 + index() * 190} y="28" text-anchor="middle" fill="#8b8d98" font-size="11">
                    {column.label.toUpperCase()} · {column.nodes.length}
                  </text>
                )}
              </For>
              <For each={edges()}>
                {(edge) => {
                  const from = createMemo(() => positions().get(edge.source))
                  const to = createMemo(() => positions().get(edge.target))
                  return (
                    <Show when={from() && to()}>
                      <line
                        x1={from()!.x + 64}
                        y1={from()!.y}
                        x2={to()!.x - 64}
                        y2={to()!.y}
                        stroke="#687076"
                        stroke-opacity="0.55"
                        marker-end="url(#topology-arrow)"
                      />
                      <text
                        x={(from()!.x + to()!.x) / 2}
                        y={(from()!.y + to()!.y) / 2 - 5}
                        text-anchor="middle"
                        fill="#8b8d98"
                        font-size="9"
                      >
                        {edge.kind}
                      </text>
                    </Show>
                  )
                }}
              </For>
              <For each={visible()}>
                {(node) => {
                  const point = createMemo(() => positions().get(node.id))
                  return (
                    <Show when={point()}>
                      <g
                        role="button"
                        tabindex="0"
                        aria-label={`${node.kind}: ${node.label}`}
                        class="cursor-pointer"
                        onClick={() => setSelected(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") setSelected(node.id)
                        }}
                      >
                        <rect
                          x={point()!.x - 64}
                          y={point()!.y - 22}
                          width="128"
                          height="44"
                          rx="6"
                          fill={selected() === node.id ? color(node) : "#211f1f"}
                          stroke={color(node)}
                          stroke-width={selected() === node.id ? 2 : 1}
                        />
                        <circle cx={point()!.x - 51} cy={point()!.y} r="4" fill={color(node)} />
                        <text x={point()!.x - 42} y={point()!.y - 3} fill="#eeeeef" font-size="10">
                          {node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label}
                        </text>
                        <text x={point()!.x - 42} y={point()!.y + 11} fill="#8b8d98" font-size="9">
                          {node.status ?? node.source}
                        </text>
                        <title>{node.label}</title>
                      </g>
                    </Show>
                  )
                }}
              </For>
            </svg>
          </Show>
        </div>
        <Show when={current()}>
          {(node) => (
            <aside class="w-64 shrink-0 overflow-y-auto border-l border-border-weak-base bg-background-stronger p-3">
              <div class="flex items-start gap-2">
                <span class="mt-1 size-2 rounded-full shrink-0" style={{ background: color(node()) }} />
                <div class="min-w-0 flex-1">
                  <div class="text-12-medium text-text-strong break-words">{node().label}</div>
                  <div class="text-10-medium text-text-weaker uppercase tracking-wider">{node().kind}</div>
                </div>
                <button type="button" class="text-text-weaker hover:text-text-base" onClick={() => setSelected("")}>
                  <Icon name="close-small" size="small" />
                </button>
              </div>
              <div class="mt-3 flex flex-wrap gap-1">
                <Show when={node().status}>
                  <span class="px-1.5 py-0.5 rounded bg-surface-base text-10-medium text-text-weak">
                    {node().status}
                  </span>
                </Show>
                <Show when={node().severity}>
                  <span class="px-1.5 py-0.5 rounded bg-surface-warning-base text-10-medium text-text-warning-base">
                    {node().severity}
                  </span>
                </Show>
                <Show when={node().confidence}>
                  <span class="px-1.5 py-0.5 rounded bg-surface-base text-10-medium text-text-weak">
                    {node().confidence}
                  </span>
                </Show>
              </div>
              <div class="mt-3 text-10-medium text-text-weaker uppercase tracking-wider">Provenance</div>
              <div class="text-11-mono text-text-base">{node().source}</div>
              <pre class="mt-3 text-10-mono text-text-weak whitespace-pre-wrap break-all select-text">
                {JSON.stringify(node().data, null, 2)}
              </pre>
              <div class="mt-4 text-10-medium text-text-weaker uppercase tracking-wider">
                Notes · {currentNotes().length}
              </div>
              <div class="mt-1.5 flex flex-col gap-1.5">
                <For each={currentNotes()}>
                  {(note) => (
                    <div class="group p-2 rounded bg-surface-base border border-border-weak-base">
                      <div class="flex items-start gap-2">
                        <div class="min-w-0 flex-1">
                          <div class="text-10-medium text-text-weaker">{note.author}</div>
                          <div class="text-11-regular text-text-base whitespace-pre-wrap break-words select-text">
                            {note.content}
                          </div>
                        </div>
                        <Show when={server.role() !== "observer"}>
                          <button
                            type="button"
                            class="opacity-0 group-hover:opacity-100 text-text-weaker hover:text-text-critical-base"
                            title="Delete note"
                            onClick={() => removeNote(note.id)}
                          >
                            <Icon name="trash" size="small" />
                          </button>
                        </Show>
                      </div>
                      <For each={note.links}>
                        {(link) => (
                          <a
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            class="mt-1 block text-10-regular text-text-accent hover:underline truncate"
                          >
                            {link}
                          </a>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
              <Show when={server.role() !== "observer"}>
                <div class="mt-2 flex flex-col gap-1.5">
                  <textarea
                    value={draft.content}
                    placeholder="Add target context or a verification note"
                    rows={3}
                    class="w-full resize-y px-2 py-1.5 rounded bg-surface-inset-base border border-border-weak-base text-11-regular text-text-base outline-none focus:border-border-strong placeholder:text-text-weaker"
                    onInput={(event) => setDraft("content", event.currentTarget.value)}
                  />
                  <input
                    type="url"
                    value={draft.link}
                    placeholder="Optional https:// link"
                    class="w-full px-2 py-1.5 rounded bg-surface-inset-base border border-border-weak-base text-11-regular text-text-base outline-none focus:border-border-strong placeholder:text-text-weaker"
                    onInput={(event) => setDraft("link", event.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="self-end px-2 py-1 rounded bg-surface-accent-base text-11-medium text-text-accent-base disabled:opacity-50"
                    disabled={!draft.content.trim() || draft.saving}
                    onClick={addNote}
                  >
                    {draft.saving ? "Saving..." : "Add note"}
                  </button>
                </div>
              </Show>
            </aside>
          )}
        </Show>
      </div>
    </div>
  )
}
