import { gcloud, run, resolveProject, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function gcpEnum(args: string[], timeout: number): Promise<HookResult> {
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

export async function vpcEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const output: string[] = [`[*] VPC network enumeration — project: ${project}\n`]
  const findings: Finding[] = []

  const nets = await gcloud(["compute", "networks", "list", "--project", project, "--format=json"], timeout)
  if (nets.exitCode === 0) {
    const items = tryJson(nets.stdout) || []
    output.push(`[+] VPC networks: ${items.length}`)
    for (const n of items) output.push(`    ${n.name} (${n.autoCreateSubnetworks ? "auto" : "custom"})`)
  }

  const subs = await gcloud(["compute", "networks", "subnets", "list", "--project", project, "--format=json"], timeout)
  if (subs.exitCode === 0) {
    const items = tryJson(subs.stdout) || []
    output.push(`\n[+] Subnets: ${items.length}`)
    for (const s of items) {
      output.push(`    ${s.name} — ${s.ipCidrRange} (${s.region?.split("/").pop()})`)
      if (!s.logConfig?.enable) {
        findings.push({
          checkId: "GCP-VPC-001",
          provider: "gcp",
          severity: "medium",
          status: "FAIL",
          resource: `subnet/${s.name}`,
          title: `VPC Flow Logs disabled on ${s.name}`,
          details: `Subnet ${s.name} (${s.ipCidrRange}) has no flow log configuration`,
          remediation: "Enable flow logs: gcloud compute networks subnets update SUBNET --enable-flow-logs",
        })
      }
    }
  }

  const fws = await gcloud(["compute", "firewall-rules", "list", "--project", project, "--format=json"], timeout)
  if (fws.exitCode === 0) {
    const items = tryJson(fws.stdout) || []
    output.push(`\n[+] Firewall rules: ${items.length}`)
    for (const f of items) {
      const dir = f.direction || "INGRESS"
      const ranges = (f.sourceRanges || []).join(",")
      const allowed = (f.allowed || [])
        .map((a: Record<string, string[]>) => `${a.IPProtocol}:${(a.ports || ["all"]).join(",")}`)
        .join(" ")
      output.push(`    ${f.name} [${dir}] src=${ranges || "any"} allow=${allowed} priority=${f.priority}`)
      if ((f.sourceRanges || []).includes("0.0.0.0/0") && dir === "INGRESS") {
        const allPorts = (f.allowed || []).some((a: Record<string, string[]>) => !a.ports || a.ports.length === 0)
        if (allPorts) {
          findings.push({
            checkId: "GCP-FW-001",
            provider: "gcp",
            severity: "critical",
            status: "FAIL",
            resource: `firewall/${f.name}`,
            title: `Open firewall rule: ${f.name}`,
            details: `Rule allows all ports from 0.0.0.0/0`,
            remediation: "Restrict source ranges and ports",
          })
        }
      }
    }
  }

  const routes = await gcloud(["compute", "routes", "list", "--project", project, "--format=json"], timeout)
  if (routes.exitCode === 0) {
    const items = tryJson(routes.stdout) || []
    output.push(`\n[+] Routes: ${items.length}`)
    for (const r of items)
      output.push(
        `    ${r.name} → ${r.destRange} via ${r.nextHopGateway || r.nextHopInstance || r.nextHopIp || "default"}`,
      )
  }

  const vpns = await gcloud(["compute", "vpn-tunnels", "list", "--project", project, "--format=json"], timeout)
  if (vpns.exitCode === 0) {
    const items = tryJson(vpns.stdout) || []
    output.push(`\n[+] VPN tunnels: ${items.length}`)
    for (const v of items) output.push(`    ${v.name} → ${v.peerIp} (${v.status})`)
  }

  return { output: output.join("\n"), findings }
}

export async function iamAnalyzer(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const output: string[] = [`[*] IAM deep analysis — project: ${project}\n`]
  const findings: Finding[] = []

  const sas = await gcloud(["iam", "service-accounts", "list", "--project", project, "--format=json"], timeout)
  if (sas.exitCode !== 0) return { output: `[-] Cannot list service accounts: ${sas.stderr.trim()}`, findings }

  const accounts = tryJson(sas.stdout) || []
  output.push(`[+] Service accounts: ${accounts.length}\n`)

  for (const sa of accounts) {
    const email = sa.email || ""
    const disabled = sa.disabled ? " [DISABLED]" : ""
    output.push(`  ${email}${disabled}`)

    const keys = await gcloud(
      ["iam", "service-accounts", "keys", "list", "--iam-account", email, "--format=json", "--managed-by=user"],
      timeout,
    )
    if (keys.exitCode === 0) {
      const keyList = tryJson(keys.stdout) || []
      output.push(`    User-managed keys: ${keyList.length}`)
      for (const k of keyList) {
        const created = k.validAfterTime || ""
        const age = created ? Math.floor((Date.now() - new Date(created).getTime()) / 86400000) : 0
        output.push(`    key=${k.name?.split("/").pop()} created=${created} age=${age}d`)
        if (age > 90) {
          findings.push({
            checkId: "GCP-IAM-001",
            provider: "gcp",
            severity: "high",
            status: "FAIL",
            resource: email,
            title: `SA key older than 90 days: ${email}`,
            details: `Key ${k.name?.split("/").pop()} is ${age} days old`,
            remediation: "Rotate key: gcloud iam service-accounts keys create --iam-account=" + email,
          })
        }
      }
    }
  }

  const policy = await gcloud(["projects", "get-iam-policy", project, "--format=json"], timeout)
  if (policy.exitCode === 0) {
    const p = tryJson(policy.stdout)
    const bindings = p?.bindings || []
    output.push(`\n[*] Project IAM bindings: ${bindings.length}`)

    const adminRoles = bindings.filter(
      (b: Record<string, string>) =>
        b.role === "roles/owner" || b.role === "roles/editor" || b.role?.includes("Admin") || b.role?.includes("admin"),
    )
    output.push(`[!] Admin/Owner bindings: ${adminRoles.length}`)
    for (const b of adminRoles) {
      for (const m of b.members || []) {
        output.push(`    ${m} → ${b.role}`)
        if (m.startsWith("user:") || m.startsWith("group:")) {
          const domain = m.split("@")[1]
          if (domain && !domain.endsWith(".gserviceaccount.com")) {
            findings.push({
              checkId: "GCP-IAM-002",
              provider: "gcp",
              severity: "high",
              status: "FAIL",
              resource: m,
              title: `Admin role for external identity: ${m}`,
              details: `${m} has ${b.role} — check if external`,
              remediation: "Review and restrict admin bindings",
            })
          }
        }
      }
    }

    const allUsers = bindings.filter((b: Record<string, string[]>) =>
      (b.members || []).some((m: string) => m === "allUsers" || m === "allAuthenticatedUsers"),
    )
    if (allUsers.length > 0) {
      output.push(`\n[!] Public access bindings: ${allUsers.length}`)
      for (const b of allUsers) {
        findings.push({
          checkId: "GCP-IAM-003",
          provider: "gcp",
          severity: "critical",
          status: "FAIL",
          resource: project,
          title: `Public access binding: ${b.role}`,
          details: `Role ${b.role} is bound to allUsers or allAuthenticatedUsers`,
          remediation: "Remove public access binding",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function sqlEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const output: string[] = [`[*] Cloud SQL enumeration — project: ${project}\n`]
  const findings: Finding[] = []

  const instances = await gcloud(["sql", "instances", "list", "--project", project, "--format=json"], timeout)
  if (instances.exitCode !== 0) return { output: `[-] Cannot list SQL instances: ${instances.stderr.trim()}`, findings }

  const items = tryJson(instances.stdout) || []
  output.push(`[+] Cloud SQL instances: ${items.length}\n`)

  for (const inst of items) {
    const name = inst.name || ""
    const version = inst.databaseVersion || ""
    const tier = inst.settings?.tier || ""
    const state = inst.state || ""
    const ip = (inst.ipAddresses || []).map((i: Record<string, string>) => `${i.ipAddress}(${i.type})`).join(", ")

    output.push(`  ${name} [${version}] tier=${tier} state=${state} ip=${ip}`)

    const authNets = inst.settings?.ipConfiguration?.authorizedNetworks || []
    for (const net of authNets) {
      output.push(`    Authorized network: ${net.value} (${net.name || "unnamed"})`)
      if (net.value === "0.0.0.0/0") {
        findings.push({
          checkId: "GCP-SQL-001",
          provider: "gcp",
          severity: "critical",
          status: "FAIL",
          resource: `sql/${name}`,
          title: `SQL instance open to internet: ${name}`,
          details: `Authorized network 0.0.0.0/0 allows any IP`,
          remediation: "Restrict authorized networks to specific CIDRs",
        })
      }
    }

    if (!inst.settings?.ipConfiguration?.requireSsl) {
      findings.push({
        checkId: "GCP-SQL-002",
        provider: "gcp",
        severity: "high",
        status: "FAIL",
        resource: `sql/${name}`,
        title: `SSL not required: ${name}`,
        details: `Cloud SQL instance ${name} does not require SSL for connections`,
        remediation: "Enable SSL: gcloud sql instances patch INSTANCE --require-ssl",
      })
    }

    if (!inst.settings?.backupConfiguration?.enabled) {
      findings.push({
        checkId: "GCP-SQL-003",
        provider: "gcp",
        severity: "medium",
        status: "FAIL",
        resource: `sql/${name}`,
        title: `Backups disabled: ${name}`,
        details: `No automated backups configured for ${name}`,
        remediation: "Enable backups: gcloud sql instances patch INSTANCE --backup-start-time HH:MM",
      })
    }

    const users = await gcloud(
      ["sql", "users", "list", "--instance", name, "--project", project, "--format=json"],
      timeout,
    )
    if (users.exitCode === 0) {
      const userList = tryJson(users.stdout) || []
      output.push(`    Users: ${userList.map((u: Record<string, string>) => u.name).join(", ")}`)
    }

    const dbs = await gcloud(
      ["sql", "databases", "list", "--instance", name, "--project", project, "--format=json"],
      timeout,
    )
    if (dbs.exitCode === 0) {
      const dbList = tryJson(dbs.stdout) || []
      output.push(`    Databases: ${dbList.map((d: Record<string, string>) => d.name).join(", ")}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function kmsEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const output: string[] = [`[*] KMS enumeration — project: ${project}\n`]
  const findings: Finding[] = []

  const locations = ["global", "us-central1", "us-east1", "europe-west1", "asia-east1"]

  for (const loc of locations) {
    const keyrings = await gcloud(
      ["kms", "keyrings", "list", "--location", loc, "--project", project, "--format=json"],
      timeout,
    )
    if (keyrings.exitCode !== 0) continue
    const rings = tryJson(keyrings.stdout) || []
    if (rings.length === 0) continue

    output.push(`[+] Location ${loc}: ${rings.length} keyring(s)`)
    for (const ring of rings) {
      const ringName = ring.name?.split("/").pop() || ring.name
      const keys = await gcloud(
        ["kms", "keys", "list", "--keyring", ringName, "--location", loc, "--project", project, "--format=json"],
        timeout,
      )
      if (keys.exitCode !== 0) continue
      const keyList = tryJson(keys.stdout) || []
      output.push(`    Keyring ${ringName}: ${keyList.length} key(s)`)

      for (const k of keyList) {
        const keyName = k.name?.split("/").pop() || k.name
        const purpose = k.purpose || "unknown"
        const rotation = k.rotationPeriod || "none"
        output.push(`      ${keyName} purpose=${purpose} rotation=${rotation}`)

        if (!k.rotationPeriod) {
          findings.push({
            checkId: "GCP-KMS-001",
            provider: "gcp",
            severity: "medium",
            status: "FAIL",
            resource: `kms/${ringName}/${keyName}`,
            title: `No key rotation: ${keyName}`,
            details: `KMS key ${keyName} in keyring ${ringName} has no rotation period set`,
            remediation: "Set rotation: gcloud kms keys update KEY --keyring RING --location LOC --rotation-period 90d",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function orgEnum(args: string[], timeout: number): Promise<HookResult> {
  const output: string[] = ["[*] GCP organization enumeration\n"]
  const findings: Finding[] = []

  const orgs = await gcloud(["organizations", "list", "--format=json"], timeout)
  if (orgs.exitCode !== 0)
    return { output: `[-] Cannot list organizations (need Org Viewer role): ${orgs.stderr.trim()}`, findings }

  const orgList = tryJson(orgs.stdout) || []
  output.push(`[+] Organizations: ${orgList.length}`)
  for (const o of orgList) {
    output.push(`    ${o.displayName} (${o.name}) state=${o.lifecycleState}`)

    const orgId = o.name?.replace("organizations/", "")
    if (!orgId) continue

    const policies = await gcloud(
      ["resource-manager", "org-policies", "list", "--organization", orgId, "--format=json"],
      timeout,
    )
    if (policies.exitCode === 0) {
      const policyList = tryJson(policies.stdout) || []
      output.push(`    Org policies: ${policyList.length}`)
      for (const p of policyList) output.push(`      ${p.constraint}`)
    }

    const folders = await gcloud(
      ["resource-manager", "folders", "list", "--organization", orgId, "--format=json"],
      timeout,
    )
    if (folders.exitCode === 0) {
      const folderList = tryJson(folders.stdout) || []
      output.push(`    Folders: ${folderList.length}`)
      for (const f of folderList) output.push(`      ${f.displayName} (${f.name}) state=${f.lifecycleState}`)
    }

    const projects = await gcloud(["projects", "list", "--filter=parent.id=" + orgId, "--format=json"], timeout)
    if (projects.exitCode === 0) {
      const projectList = tryJson(projects.stdout) || []
      output.push(`    Projects: ${projectList.length}`)
      for (const p of projectList) output.push(`      ${p.projectId} (${p.name}) state=${p.lifecycleState}`)
      findings.push({
        checkId: "GCP-ORG-001",
        provider: "gcp",
        severity: "info",
        status: "ENUMERATED",
        resource: orgId,
        title: `Organization enumerated: ${o.displayName}`,
        details: `${orgList.length} org(s), ${projectList.length} projects`,
        remediation: "Review organization hierarchy and policies",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function dnsEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const output: string[] = [`[*] Cloud DNS enumeration — project: ${project}\n`]
  const findings: Finding[] = []

  const zones = await gcloud(["dns", "managed-zones", "list", "--project", project, "--format=json"], timeout)
  if (zones.exitCode !== 0) return { output: `[-] Cannot list DNS zones: ${zones.stderr.trim()}`, findings }

  const zoneList = tryJson(zones.stdout) || []
  output.push(`[+] Managed zones: ${zoneList.length}\n`)

  for (const z of zoneList) {
    const name = z.name || ""
    const dns = z.dnsName || ""
    const vis = z.visibility || "public"
    const dnssec = z.dnssecConfig?.state || "off"
    output.push(`  ${name} → ${dns} [${vis}] DNSSEC=${dnssec}`)

    if (dnssec === "off" && vis === "public") {
      findings.push({
        checkId: "GCP-DNS-001",
        provider: "gcp",
        severity: "medium",
        status: "FAIL",
        resource: `dns/${name}`,
        title: `DNSSEC disabled: ${name}`,
        details: `Public zone ${name} (${dns}) has DNSSEC disabled`,
        remediation: "Enable: gcloud dns managed-zones update ZONE --dnssec-state on",
      })
    }

    const records = await gcloud(
      ["dns", "record-sets", "list", "--zone", name, "--project", project, "--format=json"],
      timeout,
    )
    if (records.exitCode === 0) {
      const recList = tryJson(records.stdout) || []
      output.push(`    Records: ${recList.length}`)
      for (const r of recList.slice(0, 20)) {
        output.push(`      ${r.name} ${r.type} TTL=${r.ttl} → ${(r.rrdatas || []).join(", ")}`)
      }
      if (recList.length > 20) output.push(`      ... and ${recList.length - 20} more`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function loggingEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const output: string[] = [`[*] Logging & monitoring enumeration — project: ${project}\n`]
  const findings: Finding[] = []

  const sinks = await gcloud(["logging", "sinks", "list", "--project", project, "--format=json"], timeout)
  if (sinks.exitCode === 0) {
    const sinkList = tryJson(sinks.stdout) || []
    output.push(`[+] Log sinks: ${sinkList.length}`)
    for (const s of sinkList) output.push(`    ${s.name} → ${s.destination} filter="${s.filter || "none"}"`)
    if (sinkList.length === 0) {
      findings.push({
        checkId: "GCP-LOG-001",
        provider: "gcp",
        severity: "high",
        status: "FAIL",
        resource: project,
        title: "No log sinks configured",
        details: `Project ${project} has no log sinks — logs only in Cloud Logging console`,
        remediation: "Create a log sink to export audit logs to GCS/BigQuery/Pub/Sub",
      })
    }
  }

  const metrics = await gcloud(["logging", "metrics", "list", "--project", project, "--format=json"], timeout)
  if (metrics.exitCode === 0) {
    const metricList = tryJson(metrics.stdout) || []
    output.push(`\n[+] Log-based metrics: ${metricList.length}`)
    for (const m of metricList) output.push(`    ${m.name}: ${m.filter?.substring(0, 100) || "no filter"}`)
  }

  const alerts = await gcloud(
    ["alpha", "monitoring", "policies", "list", "--project", project, "--format=json"],
    timeout,
  )
  if (alerts.exitCode === 0) {
    const alertList = tryJson(alerts.stdout) || []
    output.push(`\n[+] Alerting policies: ${alertList.length}`)
    for (const a of alertList) output.push(`    ${a.displayName} enabled=${a.enabled}`)
  }

  return { output: output.join("\n"), findings }
}

export async function spannerEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const output: string[] = [`[*] Cloud Spanner enumeration — project: ${project}\n`]
  const findings: Finding[] = []

  const instances = await gcloud(["spanner", "instances", "list", "--project", project, "--format=json"], timeout)
  if (instances.exitCode !== 0)
    return { output: `[-] Cannot list Spanner instances: ${instances.stderr.trim()}`, findings }

  const items = tryJson(instances.stdout) || []
  output.push(`[+] Spanner instances: ${items.length}\n`)

  for (const inst of items) {
    const name = inst.name?.split("/").pop() || inst.name
    const config = inst.config?.split("/").pop() || ""
    const nodes = inst.nodeCount || inst.processingUnits || 0
    const state = inst.state || ""
    output.push(`  ${name} config=${config} nodes=${nodes} state=${state}`)

    const dbs = await gcloud(
      ["spanner", "databases", "list", "--instance", name, "--project", project, "--format=json"],
      timeout,
    )
    if (dbs.exitCode === 0) {
      const dbList = tryJson(dbs.stdout) || []
      output.push(`    Databases: ${dbList.length}`)
      for (const d of dbList) {
        const dbName = d.name?.split("/").pop() || d.name
        output.push(`      ${dbName} state=${d.state}`)
      }
      findings.push({
        checkId: "GCP-SPANNER-001",
        provider: "gcp",
        severity: "info",
        status: "ENUMERATED",
        resource: `spanner/${name}`,
        title: `Spanner instance enumerated: ${name}`,
        details: `${dbList.length} database(s), config: ${config}`,
        remediation: "Review Spanner IAM and encryption settings",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function artifactRegistryEnum(args: string[], timeout: number): Promise<HookResult> {
  const project = await resolveProject(argVal(args, "--project"))
  const output: string[] = [`[*] Artifact Registry enumeration — project: ${project}\n`]
  const findings: Finding[] = []

  const repos = await gcloud(["artifacts", "repositories", "list", "--project", project, "--format=json"], timeout)
  if (repos.exitCode !== 0) return { output: `[-] Cannot list repositories: ${repos.stderr.trim()}`, findings }

  const items = tryJson(repos.stdout) || []
  output.push(`[+] Repositories: ${items.length}\n`)

  for (const repo of items) {
    const name = repo.name?.split("/").pop() || repo.name
    const format = repo.format || ""
    const loc = repo.name?.split("/")[3] || ""
    output.push(`  ${name} [${format}] location=${loc}`)

    if (format === "DOCKER") {
      const images = await gcloud(
        [
          "artifacts",
          "docker",
          "images",
          "list",
          `${loc}-docker.pkg.dev/${project}/${name}`,
          "--format=json",
          "--limit=20",
        ],
        timeout,
      )
      if (images.exitCode === 0) {
        const imgList = tryJson(images.stdout) || []
        output.push(`    Docker images: ${imgList.length}`)
        for (const img of imgList.slice(0, 10)) {
          const imgName = img.package?.split("/").pop() || img.name?.split("/").pop() || ""
          output.push(`      ${imgName}`)
        }
      }
    }

    findings.push({
      checkId: "GCP-AR-001",
      provider: "gcp",
      severity: "info",
      status: "ENUMERATED",
      resource: `artifact-registry/${name}`,
      title: `Repository enumerated: ${name}`,
      details: `Format: ${format}, location: ${loc}`,
      remediation: "Enable vulnerability scanning on container repos",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function gkeEnum(args: string[], timeout: number): Promise<HookResult> {
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
