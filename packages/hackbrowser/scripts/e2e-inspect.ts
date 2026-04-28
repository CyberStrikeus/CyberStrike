// E2E inspection: dump what CyberStrike captured + how proxy-agent interpreted it.
//
// Usage:
//   bun run scripts/e2e-inspect.ts --latest
//   bun run scripts/e2e-inspect.ts --session ses_XXX
//   bun run scripts/e2e-inspect.ts --latest --db /custom/path/cyberstrike.db
//
// Reads the CyberStrike SQLite DB read-only and prints:
//   - session metadata
//   - registered credentials + discovered roles
//   - captured requests per credential
//   - proxy-agent interpretation: web_function, web_object
//   - vulnerabilities

import { Database } from "bun:sqlite"
import os from "os"
import path from "path"

function defaultDbPath(): string {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".local", "share")
  return path.join(base, "cyberstrike", "cyberstrike.db")
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}
function has(flag: string): boolean {
  return process.argv.includes(flag)
}

const dbPath = arg("--db") ?? defaultDbPath()
const wantSession = arg("--session")
const wantLatest = has("--latest")

if (!wantSession && !wantLatest) {
  console.error("Usage: bun run scripts/e2e-inspect.ts --latest | --session <id> [--db <path>]")
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })

type SessionRow = {
  id: string
  title: string
  directory: string
  time_created: number
  time_updated: number
}

function pickSessionID(): string {
  if (wantSession) return wantSession
  // Latest session that has at least one request (i.e. an ingest-touched session).
  const row = db
    .query<SessionRow & { rcount: number }, []>(
      `SELECT s.id, s.title, s.directory, s.time_created, s.time_updated,
              (SELECT COUNT(*) FROM request r WHERE r.session_id = s.id) AS rcount
       FROM session s
       WHERE (SELECT COUNT(*) FROM request r WHERE r.session_id = s.id) > 0
       ORDER BY s.time_updated DESC
       LIMIT 1`,
    )
    .get()
  if (!row) {
    console.error("No sessions with captured requests found in DB.")
    process.exit(1)
  }
  return row.id
}

const sessionID = pickSessionID()

function section(title: string): void {
  console.log(`\n─── ${title} ───`)
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z")
}

// ---- Session ----
const session = db
  .query<SessionRow, [string]>(
    `SELECT id, title, directory, time_created, time_updated FROM session WHERE id = ?`,
  )
  .get(sessionID)

if (!session) {
  console.error(`Session not found: ${sessionID}`)
  process.exit(1)
}

console.log(`CyberStrike E2E Inspection`)
console.log(`DB: ${dbPath}`)
section("Session")
console.log(`  id       : ${session.id}`)
console.log(`  title    : ${session.title}`)
console.log(`  created  : ${fmtTime(session.time_created)}`)
console.log(`  updated  : ${fmtTime(session.time_updated)}`)

// ---- Credentials ----
type CredRow = { id: string; label: string; headers: string; role_id: string | null }
const creds = db
  .query<CredRow, [string]>(
    `SELECT id, label, headers, role_id FROM web_credential WHERE session_id = ? ORDER BY time_created ASC`,
  )
  .all(sessionID)

section(`Credentials (${creds.length})`)
for (const c of creds) {
  const headerKeys = Object.keys(JSON.parse(c.headers ?? "{}"))
  console.log(`  [${c.id}] label="${c.label}" role_id=${c.role_id ?? "-"} headers=[${headerKeys.join(", ")}]`)
}
const credLabel = new Map(creds.map(c => [c.id, c.label]))

// ---- Roles ----
type RoleRow = { id: string; name: string; level: number | null; discovered_from: string | null }
const roles = db
  .query<RoleRow, [string]>(
    `SELECT id, name, level, discovered_from FROM web_role WHERE session_id = ? ORDER BY time_created ASC`,
  )
  .all(sessionID)

section(`Roles discovered (${roles.length})`)
for (const r of roles) {
  console.log(`  [${r.id}] name="${r.name}" level=${r.level ?? "-"} src=${r.discovered_from ?? "-"}`)
}

// ---- Requests (captures) ----
type ReqRow = {
  id: string
  credential_id: string | null
  method: string
  normalized_path: string
  trigger_element: string | null
  element_roles: string | null
  ui_context: string | null
  response_status: number | null
  time_created: number
}
const requests = db
  .query<ReqRow, [string]>(
    `SELECT id, credential_id, method, normalized_path, trigger_element, element_roles,
            ui_context, response_status, time_created
     FROM request
     WHERE session_id = ?
     ORDER BY time_created ASC`,
  )
  .all(sessionID)

section(`Captures (${requests.length} requests)`)
const perCred = new Map<string, number>()
for (const r of requests) {
  const who = r.credential_id ? (credLabel.get(r.credential_id) ?? r.credential_id) : "anon"
  perCred.set(who, (perCred.get(who) ?? 0) + 1)
  const roles = r.element_roles ? (JSON.parse(r.element_roles) as string[]).join(",") : "-"
  const ui = r.ui_context ? (JSON.parse(r.ui_context) as { formName?: string; fields?: unknown[] }) : null
  const uiStr = ui ? `ui=${ui.formName ?? "-"}[${(ui.fields as unknown[] | undefined)?.length ?? 0}f]` : "ui=-"
  const trigger = r.trigger_element ? `trig="${r.trigger_element}"` : "trig=-"
  console.log(
    `  [${who.padEnd(8)}] ${r.method.padEnd(6)} ${r.normalized_path.padEnd(30)}` +
      ` → ${r.response_status ?? "?"}  ${trigger}  roles=[${roles}]  ${uiStr}`,
  )
}
console.log(`  — per credential: ${[...perCred.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`)

// ---- Web Functions (proxy-analyzer interpretation) ----
type FuncRow = {
  id: string
  name: string
  action_type: string
  request_id: string
  role_id: string | null
  objects: string | null
  method: string
  normalized_path: string
}
const functions = db
  .query<FuncRow, [string]>(
    `SELECT f.id, f.name, f.action_type, f.request_id, f.role_id, f.objects,
            r.method, r.normalized_path
     FROM web_function f
     LEFT JOIN request r ON r.id = f.request_id
     WHERE f.session_id = ?
     ORDER BY f.time_created ASC`,
  )
  .all(sessionID)

// Build object-id → name lookup for the functions loop below.
type ObjRow = {
  id: string
  name: string
  fields: string | null
  sensitive_fields: string | null
  id_fields: string | null
}
const objects = db
  .query<ObjRow, [string]>(
    `SELECT id, name, fields, sensitive_fields, id_fields
     FROM web_object WHERE session_id = ? ORDER BY time_created ASC`,
  )
  .all(sessionID)
const objNameByID = new Map(objects.map(o => [o.id, o.name]))

section(`Web Functions interpreted (${functions.length})`)
for (const f of functions) {
  const objIDs = f.objects ? (JSON.parse(f.objects) as string[]) : []
  const objs = objIDs.map(id => objNameByID.get(id) ?? id).join(",")
  const role = f.role_id ? (roles.find(r => r.id === f.role_id)?.name ?? f.role_id) : "-"
  console.log(
    `  [${f.action_type.padEnd(6)}] ${f.name.padEnd(28)} ${f.method} ${f.normalized_path}` +
      `  role=${role}  objects=[${objs}]`,
  )
}

// ---- Web Objects (proxy-analyzer interpretation) ----
section(`Web Objects interpreted (${objects.length})`)
for (const o of objects) {
  const fields = o.fields ? (JSON.parse(o.fields) as string[]).join(",") : "-"
  const sens = o.sensitive_fields ? (JSON.parse(o.sensitive_fields) as string[]).join(",") : "-"
  const ids = o.id_fields ? (JSON.parse(o.id_fields) as string[]).join(",") : "-"
  console.log(`  ${o.name}:  fields=[${fields}]  sensitive=[${sens}]  id=[${ids}]`)
}

// ---- Object Values (optional, shows what proxy-analyzer seeded) ----
type ValRow = { object_id: string; field_name: string; value: string; credential_id: string | null }
const values = db
  .query<ValRow, [string]>(
    `SELECT object_id, field_name, value, credential_id
     FROM web_object_value WHERE session_id = ? ORDER BY time_created ASC LIMIT 30`,
  )
  .all(sessionID)

if (values.length > 0) {
  section(`Object values (sample, max 30)`)
  for (const v of values) {
    const objName = objects.find(o => o.id === v.object_id)?.name ?? v.object_id
    const who = v.credential_id ? (credLabel.get(v.credential_id) ?? v.credential_id) : "-"
    console.log(`  ${objName}.${v.field_name} = "${v.value}"  via=${who}`)
  }
}

// ---- Vulnerabilities ----
type VulnRow = {
  id: string
  severity: string
  title: string
  description: string
  cwe_id: string | null
  status: string
  poc: string | null
  recommendation: string | null
  time_created: number
}
const vulns = db
  .query<VulnRow, [string]>(
    `SELECT id, severity, title, description, cwe_id, status, poc, recommendation, time_created
     FROM vulnerability WHERE session_id = ? ORDER BY position ASC`,
  )
  .all(sessionID)

section(`Vulnerabilities (${vulns.length})`)
for (const v of vulns) {
  console.log(`  [${v.severity.toUpperCase().padEnd(8)}] ${v.title}  (${v.cwe_id ?? "no-CWE"}) — ${v.status}`)
  const desc = v.description.split("\n")[0]?.slice(0, 140) ?? ""
  if (desc) console.log(`              ${desc}`)
  if (v.poc) {
    const poc = v.poc.split("\n")[0]?.slice(0, 140) ?? ""
    console.log(`      poc:    ${poc}`)
  }
}

// ---- Summary ----
section("Summary")
console.log(`  requests         : ${requests.length}`)
console.log(`  credentials      : ${creds.length}`)
console.log(`  roles            : ${roles.length}`)
console.log(`  web_functions    : ${functions.length}`)
console.log(`  web_objects      : ${objects.length}`)
console.log(`  vulnerabilities  : ${vulns.length}  (${["critical", "high", "medium", "low", "info"]
    .map(s => `${s}=${vulns.filter(v => v.severity === s).length}`)
    .join(" ")})`)

db.close()
