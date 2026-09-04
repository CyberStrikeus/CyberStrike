// Sequential multi-role setup state machine (per session).
//
// A web assessment often needs several identities (Anonymous + one browser per role).
// Rather than open them all at once, we set them up ONE AT A TIME: the user presses
// "Start capture" in the current browser, which advances the queue and spawns the next
// role's browser; the orchestrator (first) browser shows "please sign in as <next>"
// until that role's own Start capture fires, then returns to normal.
//
// This module is JUST the state — spawning the browser and the panel display live in the
// routes/extension. In-memory, server-lifetime (mirrors SpawnedProfiles).
export namespace RoleQueue {
  // pending  → queued, not its turn yet
  // spawning → its browser is being launched
  // awaiting → browser open, waiting for the user to log in + press Start capture
  // capturing→ its Start capture fired; identity is set up
  export type Phase = "pending" | "spawning" | "awaiting" | "capturing"
  export interface Role {
    label: string
    phase: Phase
    roleID?: string // web_role this credential should be linked to (user-declared role tier), if any
  }

  const bySession = new Map<string, Role[]>()

  function roles(sessionID: string): Role[] {
    let r = bySession.get(sessionID)
    if (!r) {
      r = []
      bySession.set(sessionID, r)
    }
    return r
  }
  const find = (list: Role[], label: string) => list.find((r) => r.label === label)

  // Add roles in order, skipping labels already queued (dedupe). Fed by the TUI menu (plain label
  // strings) and the panel "Add credential" box (a label with an optional declared role tier →
  // `roleID`). A late roleID on an already-queued label is filled in.
  export function enqueue(sessionID: string, items: Array<string | { label: string; roleID?: string }>): void {
    const list = roles(sessionID)
    for (const raw of items) {
      const label = String((typeof raw === "string" ? raw : raw.label) || "").trim()
      if (!label) continue
      const roleID = typeof raw === "string" ? undefined : raw.roleID
      const existing = find(list, label)
      if (existing) {
        if (roleID && !existing.roleID) existing.roleID = roleID
        continue
      }
      list.push({ label, phase: "pending", roleID })
    }
  }

  // The queued role for a label (with its declared roleID, if any) — used to link the credential to
  // its role when that browser's capture starts. Returns a copy; undefined if the label isn't queued.
  export function getRole(sessionID: string, label: string): Role | undefined {
    const r = find(roles(sessionID), String(label || "").trim())
    return r ? { ...r } : undefined
  }

  // A browser's Start capture fired for `label`. Mark it capturing; if that is a NEW
  // transition, return the next pending role (advanced to "spawning") for the caller to
  // spawn — otherwise null (repeat Start capture never re-spawns). An unqueued label is
  // added (the orchestrator may start capturing without having been enqueued first).
  export function captureStarted(sessionID: string, label: string): Role | null {
    const list = roles(sessionID)
    const l = String(label || "").trim()
    if (!l) return null
    let role = find(list, l)
    if (!role) {
      role = { label: l, phase: "pending" }
      list.push(role)
    }
    if (role.phase === "capturing") return null // idempotent — already set up
    role.phase = "capturing"
    const next = list.find((r) => r.phase === "pending")
    if (!next) return null
    next.phase = "spawning"
    return { ...next }
  }

  // The next role's browser has launched → spawning → awaiting (its login + capture).
  export function spawned(sessionID: string, label: string): void {
    const role = find(roles(sessionID), String(label || "").trim())
    if (role && role.phase === "spawning") role.phase = "awaiting"
  }

  export interface Status {
    roles: Role[]
    // The role being set up right now (spawning or awaiting) — what the orchestrator
    // panel shows guidance for. null when nothing is mid-setup (idle / all captured).
    setup: Role | null
  }
  export function status(sessionID: string): Status {
    const list = roles(sessionID)
    const setup = list.find((r) => r.phase === "spawning" || r.phase === "awaiting") ?? null
    return { roles: list.map((r) => ({ ...r })), setup: setup ? { ...setup } : null }
  }

  export function _reset(): void {
    bySession.clear()
  }
}
