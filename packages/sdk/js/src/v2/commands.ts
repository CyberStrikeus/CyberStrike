// Single source of truth for UI ACTION commands (compact, fork, rename, hackbrowser, model-select,
// toggles, …) across every surface: the TUI, the web app, and the desktop app (which renders the
// web app). Each surface builds its own command registry from this catalog — it owns only the
// per-surface handler and dialog — so the command SET, ids, slash names, categories, default
// keybinds, and which surfaces offer each command can no longer drift apart silently.
//
// This is deliberately metadata-only: no handlers live here (the TUI runs on opentui, the app on
// SolidJS, so rendering/dialogs cannot be shared). Behaviour that CAN be shared — the SDK calls a
// command makes — lives in the shared action helpers, not here.
//
// `title` holds an i18n key resolved by each surface's own translator (falling back to a humanized
// id when a surface lacks the key). Keybind strings use the app's "mod+shift+x" convention.
//
// Custom / MCP / skill commands are NOT here: those already have a single source (the server
// `Command`/`CommandV2` namespace, delivered to every client as `sync.data.command`).

export type CommandSurface = "tui" | "web"

export type CommandSpec = {
  /** Canonical id, identical on every surface. The desktop native menu binds to these. */
  id: string
  /** i18n key (preferred) or literal fallback for the command's display title. */
  title: string
  /** Grouping label in the command palette. */
  category?: string
  /** Slash-command trigger (and aliases) typed in the composer. */
  slash?: { name: string; aliases?: string[] }
  /** Default keybind in the app's "mod+shift+x" form; a surface may remap it. */
  keybind?: string
  /** Which surfaces offer this command. A surface MUST register every id that lists it. */
  surfaces: CommandSurface[]
}

const BOTH: CommandSurface[] = ["tui", "web"]

// Ordered roughly by palette category. Keep ids stable — they are a cross-surface + desktop-menu contract.
export const COMMANDS: CommandSpec[] = [
  // ── Session lifecycle ────────────────────────────────────────────────────
  { id: "session.list", title: "command.session.list", category: "Session", slash: { name: "sessions", aliases: ["resume", "continue"] }, surfaces: BOTH },
  { id: "session.new", title: "command.session.new", category: "Session", keybind: "mod+shift+s", slash: { name: "new", aliases: ["clear"] }, surfaces: BOTH },
  { id: "session.rename", title: "common.rename", category: "Session", surfaces: BOTH },
  { id: "session.compact", title: "command.session.compact", category: "Session", slash: { name: "compact", aliases: ["summarize"] }, surfaces: BOTH },
  { id: "session.fork", title: "command.session.fork", category: "Session", surfaces: BOTH },
  { id: "session.undo", title: "command.session.undo", category: "Session", surfaces: BOTH },
  { id: "session.redo", title: "command.session.redo", category: "Session", surfaces: BOTH },
  { id: "session.export", title: "command.session.export", category: "Session", surfaces: BOTH },
  { id: "session.copy", title: "command.session.copy", category: "Session", surfaces: BOTH },
  { id: "session.timeline", title: "command.session.timeline", category: "Session", surfaces: BOTH },
  { id: "session.share", title: "command.session.share", category: "Session", surfaces: BOTH },
  { id: "session.unshare", title: "command.session.unshare", category: "Session", surfaces: BOTH },
  { id: "session.pin", title: "command.session.pin", category: "Session", surfaces: BOTH },
  // web-only (no archive in the TUI yet)
  { id: "session.archive", title: "command.session.archive", category: "Session", keybind: "mod+shift+backspace", surfaces: ["web"] },

  // ── Agent / model / MCP ──────────────────────────────────────────────────
  { id: "mcp.toggle", title: "command.mcp.toggle", category: "Agent", keybind: "mod+;", slash: { name: "mcp", aliases: ["mcps"] }, surfaces: BOTH },
  { id: "session.bolt.select", title: "command.bolt.select", category: "Agent", slash: { name: "bolt" }, surfaces: BOTH },

  // ── Security pipeline ─────────────────────────────────────────────────────
  { id: "session.hackbrowser.launch", title: "command.hackbrowser.launch", category: "Security", slash: { name: "hackbrowser", aliases: ["hb", "crawl"] }, surfaces: BOTH },
  { id: "session.hackbrowser.stop", title: "command.hackbrowser.stop", category: "Security", slash: { name: "hackbrowser-stop" }, surfaces: BOTH },
  { id: "session.vulnerabilities", title: "command.vulnerabilities", category: "Security", slash: { name: "vulnerabilities", aliases: ["vuln", "vulns"] }, surfaces: BOTH },
  { id: "session.web", title: "command.web", category: "Security", slash: { name: "web", aliases: ["endpoints", "roles", "credentials"] }, surfaces: BOTH },
  { id: "session.methodology", title: "command.methodology", category: "Security", slash: { name: "methodology" }, surfaces: BOTH },
  { id: "session.report", title: "command.report", category: "Security", slash: { name: "report" }, surfaces: BOTH },
  { id: "session.poster", title: "command.poster", category: "Security", slash: { name: "poster" }, surfaces: BOTH },
  { id: "session.queue.pause", title: "command.queue.pause", category: "Security", slash: { name: "qpause" }, surfaces: BOTH },
  { id: "session.queue.resume", title: "command.queue.resume", category: "Security", slash: { name: "qresume" }, surfaces: BOTH },

  // ── View toggles ──────────────────────────────────────────────────────────
  { id: "view.thinking", title: "command.view.thinking", category: "View", slash: { name: "thinking", aliases: ["toggle-thinking"] }, surfaces: BOTH },
  { id: "view.timestamps", title: "command.view.timestamps", category: "View", slash: { name: "timestamps", aliases: ["toggle-timestamps"] }, surfaces: BOTH },
  { id: "view.status", title: "command.view.status", category: "View", slash: { name: "status" }, surfaces: BOTH },
  { id: "view.help", title: "command.view.help", category: "View", slash: { name: "help" }, surfaces: BOTH },

  // ── Web-app-only surface features (TUI has no terminal / file tree / review pane) ──
  { id: "terminal.toggle", title: "command.terminal.toggle", category: "View", keybind: "ctrl+`", surfaces: ["web"] },
  { id: "terminal.new", title: "command.terminal.new", category: "View", keybind: "ctrl+alt+t", surfaces: ["web"] },
  { id: "terminal.close", title: "terminal.close", category: "View", keybind: "mod+w", surfaces: ["web"] },
  { id: "review.toggle", title: "command.review.toggle", category: "View", keybind: "mod+shift+r", surfaces: ["web"] },
  { id: "fileTree.toggle", title: "command.fileTree.toggle", category: "View", keybind: "mod+\\", surfaces: ["web"] },
  { id: "file.open", title: "command.file.open", category: "File", keybind: "mod+p", surfaces: ["web"] },
  { id: "tab.close", title: "command.tab.close", category: "View", keybind: "mod+w", surfaces: ["web"] },
  { id: "context.addSelection", title: "command.context.addSelection", category: "File", keybind: "mod+shift+l", surfaces: ["web"] },
  { id: "input.focus", title: "command.input.focus", category: "View", keybind: "ctrl+l", surfaces: ["web"] },
  { id: "message.previous", title: "command.message.previous", category: "View", keybind: "mod+alt+[", surfaces: ["web"] },
  { id: "message.next", title: "command.message.next", category: "View", keybind: "mod+alt+]", surfaces: ["web"] },
  { id: "permissions.autoaccept", title: "command.permissions.autoaccept", category: "Session", keybind: "mod+shift+a", surfaces: ["web"] },
  { id: "session.skills", title: "command.session.skills", category: "Agent", slash: { name: "skills" }, surfaces: ["web"] },
  { id: "logs.export", title: "command.logs.export", category: "Session", surfaces: ["web"] },

  // ── TUI-only surface features (no DOM/terminal equivalent needed in the app) ──
  { id: "prompt.stash", title: "command.prompt.stash", category: "Prompt", surfaces: ["tui"] },
  { id: "prompt.stash.pop", title: "command.prompt.stash.pop", category: "Prompt", surfaces: ["tui"] },
  { id: "prompt.stash.list", title: "command.prompt.stash.list", category: "Prompt", surfaces: ["tui"] },
  { id: "view.conceal", title: "command.view.conceal", category: "View", surfaces: ["tui"] },
  { id: "view.actions", title: "command.view.actions", category: "View", surfaces: ["tui"] },
  { id: "view.scrollbar", title: "command.view.scrollbar", category: "View", surfaces: ["tui"] },
  { id: "view.header", title: "command.view.header", category: "View", surfaces: ["tui"] },
]

const byId = new Map(COMMANDS.map((c) => [c.id, c]))

/** Look up a command spec by its canonical id. */
export function command(id: string): CommandSpec | undefined {
  return byId.get(id)
}

/** The ids a given surface is expected to register. */
export function commandsFor(surface: CommandSurface): CommandSpec[] {
  return COMMANDS.filter((c) => c.surfaces.includes(surface))
}
