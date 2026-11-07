import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { Database, eq, and } from "../../storage/db"
import { WebCredentialTable } from "../session.sql"
import { Identifier } from "../../id/id"

// Common auth headers to track
export const COMMON_AUTH_HEADERS = [
  "authorization",
  "cookie",
  "x-auth-token",
  "x-api-key",
  "x-access-token",
  "x-session-token",
  "x-csrf-token",
]

export namespace WebCredential {
  // Auth is PER-ORIGIN. An authenticated user talks to portal (session cookie), api (bearer), and
  // third-party hosts (e.g. an analytics endpoint with `authorization: Basic <public-token>`) with
  // DIFFERENT credentials. Collapsing them into one flat header blob — and replaying that blob
  // against every host — captured the WRONG identity: a late analytics request's cookie/authorization
  // clobbered the app's real session. So a credential stores auth keyed by host, and replay applies
  // the set matching the TARGET host.
  export type AuthByHost = Record<string, Record<string, string>>

  // Auth headers a credential should send to `host`. Exact host wins; "*" is a wildcard set (manual
  // web_update_credential overrides + migrated legacy flat credentials). NO fuzzy fallback to another
  // host — sending host A's session to host B is the original bug.
  export function authForHost(headers: AuthByHost, host: string): Record<string, string> {
    return headers[host.toLowerCase()] ?? headers["*"] ?? {}
  }

  // Does this credential carry any replayable auth at all (any host)?
  export function anyAuth(headers: AuthByHost): boolean {
    return Object.values(headers).some((h) => Object.keys(h).length > 0)
  }

  // Flattened union across hosts — for DISPLAY / presence / JWT-claim extraction only, NEVER replay
  // (replay must stay host-scoped via authForHost).
  export function flattenAuth(headers: AuthByHost): Record<string, string> {
    const out: Record<string, string> = {}
    for (const h of Object.values(headers)) Object.assign(out, h)
    return out
  }

  // Tolerate legacy rows: a flat header map (values are strings) → wrap under "*". A per-host map
  // (values are objects) is returned as-is.
  export function normalizeAuth(raw: unknown): AuthByHost {
    if (!raw || typeof raw !== "object") return {}
    const obj = raw as Record<string, unknown>
    const vals = Object.values(obj)
    if (vals.length > 0 && vals.every((v) => typeof v === "string")) return { "*": obj as Record<string, string> }
    return obj as AuthByHost
  }

  // `Host:` header of a raw HTTP request, lowercased.
  function hostOf(rawRequest: string): string | undefined {
    const head = rawRequest.split(/\r?\n\r?\n/, 1)[0] ?? ""
    for (const line of head.split(/\r?\n/).slice(1)) {
      const idx = line.indexOf(":")
      if (idx <= 0) continue
      if (line.slice(0, idx).trim().toLowerCase() === "host") return line.slice(idx + 1).trim().toLowerCase()
    }
    return undefined
  }
  export const Info = z
    .object({
      id: z.string(),
      session_id: z.string(),
      label: z.string(),
      // Flattened union of all hosts' auth — for display / presence / JWT claims. Replay must use
      // authByHost via authForHost(), never this.
      headers: z.record(z.string(), z.string()),
      // Per-host auth, the source of truth for host-scoped replay.
      authByHost: z.record(z.string(), z.record(z.string(), z.string())).default({}),
      container_id: z.string().optional(),
      role_id: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({ ref: "WebCredential" })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Updated: BusEvent.define(
      "web_credential.updated",
      z.object({
        sessionID: z.string(),
        credentials: z.array(Info),
      }),
    ),
  }

  export function add(input: {
    sessionID: string
    label: string
    headers?: Record<string, string>
    containerID?: string
    roleID?: string
  }): Info {
    const id = Identifier.ascending("web_credential")
    const now = Date.now()
    // A flat `headers` input is a manual/registration set with no host context → wildcard "*".
    // Per-host auth is filled in later by captureAuthFromRaw from live traffic.
    const authByHost: AuthByHost = input.headers ? { "*": input.headers } : {}

    Database.use((db) => {
      db.insert(WebCredentialTable)
        .values({
          id,
          session_id: input.sessionID,
          label: input.label,
          headers: authByHost,
          container_id: input.containerID ?? null,
          role_id: input.roleID ?? null,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    const list = get(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, credentials: list })

    return {
      id,
      session_id: input.sessionID,
      label: input.label,
      headers: input.headers ?? {},
      authByHost,
      container_id: input.containerID,
      role_id: input.roleID,
      time: { created: now, updated: now },
    }
  }

  // One credential per (session, label). A label is a role identity, so registering the same
  // label twice — e.g. "anonymous" auto-created at launch AND again when the user presses Start
  // capture — must reuse the existing credential, not create a duplicate. Any newly-supplied
  // headers/container are merged in so a re-registration can still enrich the credential.
  export function ensure(input: {
    sessionID: string
    label: string
    headers?: Record<string, string>
    containerID?: string
    roleID?: string
  }): Info {
    const existing = getByLabel(input.sessionID, input.label)
    if (!existing) return add(input)
    const hasHeaders = !!input.headers && Object.keys(input.headers).length > 0
    if (!hasHeaders && input.containerID === undefined && input.roleID === undefined) return existing
    // Merge a flat re-registration set under the wildcard host (no host context here).
    const authByHost: AuthByHost = hasHeaders
      ? { ...existing.authByHost, "*": { ...(existing.authByHost["*"] ?? {}), ...input.headers } }
      : existing.authByHost
    const containerID = input.containerID ?? existing.container_id
    const roleID = input.roleID ?? existing.role_id
    const now = Date.now()
    Database.use((db) =>
      db
        .update(WebCredentialTable)
        .set({ headers: authByHost, container_id: containerID ?? null, role_id: roleID ?? null, time_updated: now })
        .where(eq(WebCredentialTable.id, existing.id))
        .run(),
    )
    const list = get(input.sessionID)
    Bus.publish(Event.Updated, { sessionID: input.sessionID, credentials: list })
    return {
      ...existing,
      headers: flattenAuth(authByHost),
      authByHost,
      container_id: containerID,
      role_id: roleID,
      time: { created: existing.time.created, updated: now },
    }
  }

  // Pull the auth headers (COMMON_AUTH_HEADERS) out of a raw HTTP request string.
  function extractAuthHeaders(rawRequest: string): Record<string, string> {
    const out: Record<string, string> = {}
    const head = rawRequest.split(/\r?\n\r?\n/, 1)[0] ?? ""
    const lines = head.split(/\r?\n/)
    // line 0 is the request line ("GET /x HTTP/1.1"); headers start at 1
    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(":")
      if (idx <= 0) continue
      const name = lines[i].slice(0, idx).trim()
      if (!COMMON_AUTH_HEADERS.includes(name.toLowerCase())) continue
      const value = lines[i].slice(idx + 1).trim()
      if (value) out[name] = value
    }
    return out
  }

  // Fill a credential's replayable auth from a captured request's OWN auth headers.
  //
  // A credential registered by spawn-profile / panel "Add role" starts as a
  // label-only placeholder (no headers). Cross-credential replay — the whole point
  // of a role browser: testing an endpoint AS org1 / org2 (IDOR, BFLA) — injects
  // `credential.headers`, so an empty credential means the authz/idor agents have
  // nothing to swap in and correctly report they cannot test as that identity.
  //
  // The browser extension already tags each ingested request with the capturing
  // profile's `credential_id`, and the raw request carries that profile's real auth
  // (Cookie / Authorization / …). So at ingest we lift those headers onto the
  // credential. Keyed off the LIVE ingest credential_id (not the stored request row,
  // which template-dedup collapses onto whichever identity hit the endpoint first),
  // so each identity fills in from its own traffic even on shared endpoints. Merge,
  // never clear; write only on change to avoid a DB write + Bus event per request.
  // Returns true only when THIS call first made a real alternate identity replayable —
  // i.e. the credential had no auth before, now does, and it is not the anonymous
  // baseline. The caller uses that edge to queue cross-credential retests exactly once.
  export function captureAuthFromRaw(input: { sessionID: string; credentialID: string; rawRequest: string }): boolean {
    const host = hostOf(input.rawRequest)
    const auth = extractAuthHeaders(input.rawRequest)
    // No host = can't attribute the auth to an origin; skip rather than pollute the wildcard.
    if (!host || Object.keys(auth).length === 0) return false
    const existing = getById(input.credentialID)
    if (!existing || existing.session_id !== input.sessionID) return false
    // Merge ONLY within this host's set — an analytics request to host B can no longer clobber the
    // app session captured for host A.
    const existingForHost = existing.authByHost[host] ?? {}
    const mergedForHost = { ...existingForHost, ...auth }
    const changed =
      Object.keys(mergedForHost).length !== Object.keys(existingForHost).length ||
      Object.keys(mergedForHost).some((k) => existingForHost[k] !== mergedForHost[k])
    if (!changed) return false
    const hadAnyAuth = anyAuth(existing.authByHost)
    update({ id: input.credentialID, sessionID: input.sessionID, headers: { ...existing.authByHost, [host]: mergedForHost } })
    // Fire the cross-credential retest edge exactly once: the first time a non-anon identity becomes
    // replayable (had no auth for ANY host before, now does).
    return !hadAnyAuth && existing.label.trim().toLowerCase() !== "anonymous"
  }

  // Case-insensitive (and whitespace-trimmed) label lookup: "anonymous", "Anonymous" and
  // " Anonymous " are the SAME role, so the same identity is never duplicated over a casing
  // difference. Compared in JS over the session's (few) credentials to stay portable across
  // SQLite collations. The FIRST-registered casing is kept as canonical.
  export function getByLabel(sessionID: string, label: string): Info | undefined {
    const target = label.trim().toLowerCase()
    return get(sessionID).find((c) => c.label.trim().toLowerCase() === target)
  }

  function rowToInfo(row: typeof WebCredentialTable.$inferSelect): Info {
    const authByHost = normalizeAuth(row.headers)
    return {
      id: row.id,
      session_id: row.session_id,
      label: row.label,
      headers: flattenAuth(authByHost),
      authByHost,
      container_id: row.container_id ?? undefined,
      role_id: row.role_id ?? undefined,
      time: { created: row.time_created, updated: row.time_updated },
    }
  }

  export function get(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db.select().from(WebCredentialTable).where(eq(WebCredentialTable.session_id, sessionID)).all(),
    )
    return rows.map(rowToInfo)
  }

  export function getById(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(WebCredentialTable).where(eq(WebCredentialTable.id, id)).get())
    if (!row) return undefined
    return rowToInfo(row)
  }

  export function getByContainer(sessionID: string, containerID: string): Info | undefined {
    const row = Database.use((db) =>
      db
        .select()
        .from(WebCredentialTable)
        .where(and(eq(WebCredentialTable.session_id, sessionID), eq(WebCredentialTable.container_id, containerID)))
        .get(),
    )
    if (!row) return undefined
    return rowToInfo(row)
  }

  export function link(input: { id: string; roleID: string }): void {
    const now = Date.now()
    Database.use((db) => {
      const row = db
        .update(WebCredentialTable)
        .set({ role_id: input.roleID, time_updated: now })
        .where(eq(WebCredentialTable.id, input.id))
        .returning()
        .get()
      if (row) {
        const list = get(row.session_id)
        Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, credentials: list }))
      }
    })
  }

  export function remove(id: string): void {
    Database.use((db) => {
      const row = db.select().from(WebCredentialTable).where(eq(WebCredentialTable.id, id)).get()
      if (row) {
        db.delete(WebCredentialTable).where(eq(WebCredentialTable.id, id)).run()
        const list = get(row.session_id)
        Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, credentials: list }))
      }
    })
  }

  export function update(input: {
    id: string
    sessionID: string
    headers?: AuthByHost
    label?: string
    containerID?: string
    roleID?: string
  }): Info | undefined {
    const now = Date.now()

    return Database.use((db) => {
      const existing = db.select().from(WebCredentialTable).where(eq(WebCredentialTable.id, input.id)).get()
      if (!existing) return undefined

      // Session kontrolü
      if (existing.session_id !== input.sessionID) {
        throw new Error(`Credential ${input.id} does not belong to session ${input.sessionID}`)
      }

      const updates: Record<string, unknown> = { time_updated: now }

      if (input.headers !== undefined) {
        updates.headers = input.headers
      }

      if (input.label !== undefined) {
        updates.label = input.label
      }

      if (input.containerID !== undefined) {
        updates.container_id = input.containerID
      }

      if (input.roleID !== undefined) {
        updates.role_id = input.roleID
      }

      db.update(WebCredentialTable).set(updates).where(eq(WebCredentialTable.id, input.id)).run()

      const row = db.select().from(WebCredentialTable).where(eq(WebCredentialTable.id, input.id)).get()
      if (!row) return undefined

      const list = get(row.session_id)
      Database.effect(() => Bus.publish(Event.Updated, { sessionID: row.session_id, credentials: list }))

      return rowToInfo(row)
    })
  }

  export function exists(sessionID: string, label: string): boolean {
    const rows = Database.use((db) =>
      db.select().from(WebCredentialTable).where(eq(WebCredentialTable.session_id, sessionID)).all(),
    )
    return rows.some((r) => r.label === label)
  }

  export function existsByContainer(sessionID: string, containerID: string): boolean {
    const row = Database.use((db) =>
      db
        .select({ id: WebCredentialTable.id })
        .from(WebCredentialTable)
        .where(and(eq(WebCredentialTable.session_id, sessionID), eq(WebCredentialTable.container_id, containerID)))
        .get(),
    )
    return !!row
  }

  // Helper: JWT token'dan claims çıkar (Authorization header'dan)
  export function extractJWTClaims(headers: Record<string, string>): Record<string, unknown> | undefined {
    const auth = headers["Authorization"] || headers["authorization"]
    if (!auth) return undefined

    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth.trim()

    try {
      const parts = token.split(".")
      if (parts.length !== 3) return undefined

      const payload = parts[1]
      const decoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
      return JSON.parse(decoded)
    } catch {
      return undefined
    }
  }
}
