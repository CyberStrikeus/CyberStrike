import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

// ── Existing handlers (moved from monolithic azurehook.ts) ──

export async function entraEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Entra ID / Azure AD Enumeration\n"]

  const acct = await run("az", ["account", "show", "-o", "json"], timeout)
  if (acct.exitCode !== 0) return { output: `[-] Not logged in: ${acct.stderr.trim()}`, findings }
  const account = tryJson(acct.stdout)
  output.push(`[*] Tenant: ${account?.tenantId}`, `[*] Subscription: ${account?.name} (${account?.id})\n`)

  const users = await run(
    "az",
    [
      "ad",
      "user",
      "list",
      "--query",
      "[].{name:displayName,upn:userPrincipalName,enabled:accountEnabled}",
      "-o",
      "json",
    ],
    timeout,
  )
  if (users.exitCode === 0) {
    const ul = tryJson(users.stdout) || []
    output.push(`[+] Users: ${ul.length}`)
    for (const u of ul.slice(0, 20)) output.push(`    ${u.upn} (${u.enabled ? "enabled" : "disabled"})`)
    if (ul.length > 20) output.push(`    ... and ${ul.length - 20} more`)
  }

  const sps = await run(
    "az",
    [
      "ad",
      "sp",
      "list",
      "--all",
      "--query",
      "[].{name:displayName,appId:appId,type:servicePrincipalType}",
      "-o",
      "json",
    ],
    timeout,
  )
  if (sps.exitCode === 0) {
    const sl = tryJson(sps.stdout) || []
    output.push(`[+] Service Principals: ${sl.length}`)
  }

  const roles = await az(
    [
      "role",
      "assignment",
      "list",
      "--all",
      "--query",
      "[].{principal:principalName,role:roleDefinitionName,scope:scope}",
    ],
    sub,
    timeout,
  )
  if (roles.exitCode === 0) {
    const rl = tryJson(roles.stdout) || []
    output.push(`[+] Role Assignments: ${rl.length}`)
    const dangerous = ["Owner", "Contributor", "User Access Administrator"]
    for (const r of rl) {
      if (dangerous.includes(r.role)) {
        findings.push({
          checkId: "AZURE-ENUM-001",
          provider: "azure",
          severity: r.role === "Owner" ? "critical" : "high",
          status: "FAIL",
          resource: r.principal || "unknown",
          title: `Dangerous role: ${r.role}`,
          details: `${r.principal} has ${r.role} at ${r.scope}`,
          remediation: "Use least-privilege custom roles",
        })
      }
    }
  }

  const apps = await run(
    "az",
    ["ad", "app", "list", "--query", "[].{name:displayName,appId:appId}", "-o", "json"],
    timeout,
  )
  if (apps.exitCode === 0) {
    const al = tryJson(apps.stdout) || []
    output.push(`[+] App Registrations: ${al.length}`)
  }

  return { output: output.join("\n"), findings }
}

export async function vmEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure VMs...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const vms = await az(["vm", "list", ...rgArgs, "--show-details"], sub, timeout)
  if (vms.exitCode !== 0)
    return { output: output.join("\n") + `[-] Cannot list VMs: ${vms.stderr.slice(0, 200)}`, findings }

  const items = tryJson(vms.stdout) || []
  output.push(`[+] VMs: ${items.length}\n`)

  for (const vm of items) {
    output.push(`── ${vm.name} (${vm.hardwareProfile?.vmSize}) ──`)
    output.push(`    RG: ${vm.resourceGroup}, Location: ${vm.location}`)
    output.push(`    OS: ${vm.storageProfile?.osDisk?.osType || "?"}`)
    output.push(`    Power: ${vm.powerState || "?"}`)
    output.push(`    Public IP: ${vm.publicIps || "none"}`)

    if (vm.publicIps) {
      findings.push({
        checkId: "AZ-VM-001",
        provider: "azure",
        severity: "medium",
        status: "INFO",
        resource: `vm://${vm.name}`,
        title: `VM with public IP: ${vm.name}`,
        details: `Public IP: ${vm.publicIps}`,
        remediation: "Remove public IP if not required, use Azure Bastion instead",
      })
    }

    const extensions = await az(
      ["vm", "extension", "list", "--vm-name", vm.name, "--resource-group", vm.resourceGroup],
      sub,
      15,
    )
    if (extensions.exitCode === 0) {
      const exts = tryJson(extensions.stdout) || []
      if (exts.length > 0) {
        output.push(`    Extensions: ${exts.map((e: Record<string, string>) => e.name).join(", ")}`)
      }
    }

    const disks = vm.storageProfile?.dataDisks || []
    const osDisk = vm.storageProfile?.osDisk
    if (osDisk && !osDisk.encryptionSettings?.enabled && !osDisk.managedDisk?.diskEncryptionSet) {
      output.push(`    [!] OS disk not encrypted`)
    }
    if (disks.length > 0) output.push(`    Data disks: ${disks.length}`)
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function aksEnum(args: string[], timeout: number): Promise<HookResult> {
  const cluster = argVal(args, "--cluster")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Kubernetes Service enumeration...\n"]

  if (!cluster) {
    const list = await az(
      [
        "aks",
        "list",
        "--query",
        "[].{name:name,rg:resourceGroup,k8sVersion:kubernetesVersion,powerState:powerState.code,nodeCount:agentPoolProfiles[0].count}",
      ],
      undefined,
      timeout,
    )
    if (list.exitCode === 0) {
      const clusters = tryJson(list.stdout) || []
      output.push(`[+] AKS clusters: ${clusters.length}`)
      for (const c of clusters)
        output.push(`    ${c.name} (k8s ${c.k8sVersion}) — rg: ${c.rg}, nodes: ${c.nodeCount}, state: ${c.powerState}`)
      findings.push({
        checkId: "AZ-AKS-001",
        provider: "azure",
        severity: "info",
        status: "ENUMERATED",
        resource: "azure://aks",
        title: `AKS clusters enumerated: ${clusters.length}`,
        details: clusters.map((c: Record<string, string>) => c.name).join(", "),
        remediation: "Review cluster configurations for security misconfigurations",
      })
    }
    return { output: output.join("\n"), findings }
  }

  const show = await az(["aks", "show", "--name", cluster, ...(rg ? ["--resource-group", rg] : [])], undefined, timeout)
  if (show.exitCode === 0) {
    const info = tryJson(show.stdout)
    if (info) {
      output.push(`[+] Cluster: ${info.name}`)
      output.push(`    K8s version: ${info.kubernetesVersion}`)
      output.push(`    RBAC: ${info.enableRbac ? "ENABLED" : "DISABLED"}`)
      output.push(`    Network plugin: ${info.networkProfile?.networkPlugin || "unknown"}`)
      output.push(`    Network policy: ${info.networkProfile?.networkPolicy || "none"}`)
      output.push(`    AAD integration: ${info.aadProfile ? "YES" : "NO"}`)
      output.push(`    Private cluster: ${info.apiServerAccessProfile?.enablePrivateCluster ? "YES" : "NO"}`)
      if (!info.enableRbac) {
        findings.push({
          checkId: "AZ-AKS-002",
          provider: "azure",
          severity: "critical",
          status: "FAIL",
          resource: `aks://${cluster}`,
          title: `AKS RBAC disabled on ${cluster}`,
          details: "Kubernetes RBAC is not enabled — any authenticated user has full cluster access",
          remediation: "Enable RBAC: az aks update --name CLUSTER --resource-group RG --enable-aad --enable-azure-rbac",
        })
      }
    }
  }

  const nodePools = await az(
    ["aks", "nodepool", "list", "--cluster-name", cluster, ...(rg ? ["--resource-group", rg] : [])],
    undefined,
    timeout,
  )
  if (nodePools.exitCode === 0) {
    const pools = tryJson(nodePools.stdout) || []
    output.push(`\n[+] Node pools: ${pools.length}`)
    for (const p of pools) output.push(`    ${p.name}: ${p.count} nodes, VM: ${p.vmSize}, OS: ${p.osType}`)
  }

  const creds = await az(
    [
      "aks",
      "get-credentials",
      "--name",
      cluster,
      ...(rg ? ["--resource-group", rg] : []),
      "--admin",
      "--overwrite-existing",
      "-f",
      `/tmp/cs-aks-${cluster}-kubeconfig`,
    ],
    undefined,
    timeout,
  )
  if (creds.exitCode === 0) {
    output.push(`\n[+] Admin kubeconfig extracted to /tmp/cs-aks-${cluster}-kubeconfig`)
    output.push(`    Use: export KUBECONFIG=/tmp/cs-aks-${cluster}-kubeconfig`)
    findings.push({
      checkId: "AZ-AKS-003",
      provider: "azure",
      severity: "critical",
      status: "EXTRACTED",
      resource: `aks://${cluster}/kubeconfig`,
      title: `AKS admin kubeconfig extracted: ${cluster}`,
      details: "Cluster admin credentials retrieved — full cluster access",
      remediation: "Disable local admin account, use AAD integration",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function nsgAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Azure Network Security Groups...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const nsgs = await az(["network", "nsg", "list", ...rgArgs], sub, timeout)
  if (nsgs.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list NSGs", findings }

  const items = tryJson(nsgs.stdout) || []
  output.push(`[+] NSGs: ${items.length}\n`)

  const dangerousPorts = ["22", "3389", "1433", "3306", "5432", "27017", "6379", "9200"]

  for (const nsg of items) {
    output.push(`── ${nsg.name} (${nsg.resourceGroup}) ──`)
    const rules = [...(nsg.securityRules || []), ...(nsg.defaultSecurityRules || [])]
    const inbound = rules.filter((r: Record<string, string>) => r.direction === "Inbound" && r.access === "Allow")

    for (const rule of inbound) {
      const src = rule.sourceAddressPrefix || (rule.sourceAddressPrefixes || []).join(",")
      const port = rule.destinationPortRange || (rule.destinationPortRanges || []).join(",")

      if (src === "*" || src === "0.0.0.0/0" || src === "Internet") {
        const isDangerous = port === "*" || dangerousPorts.some((p) => port.includes(p))
        if (isDangerous) {
          output.push(`  [!] ${rule.name}: ${src} → ${port} (OPEN TO INTERNET)`)
          findings.push({
            checkId: "AZ-NSG-001",
            provider: "azure",
            severity: port === "*" ? "critical" : "high",
            status: "FAIL",
            resource: `nsg://${nsg.name}/${rule.name}`,
            title: `Open NSG rule: ${nsg.name}/${rule.name}`,
            details: `Source: ${src}, Port: ${port}, Priority: ${rule.priority}`,
            remediation: "Restrict source addresses to specific IP ranges",
          })
        }
      }
    }

    const associations = nsg.networkInterfaces?.length || 0
    const subnetAssoc = nsg.subnets?.length || 0
    output.push(`  Associated: ${associations} NIC(s), ${subnetAssoc} subnet(s)`)
    if (associations === 0 && subnetAssoc === 0) output.push(`  [!] NSG not associated with any resource`)
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function rbacAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Azure RBAC role assignments...\n"]

  const assignments = await az(["role", "assignment", "list", "--all", "--include-inherited"], sub, timeout)
  if (assignments.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list role assignments", findings }

  const items = tryJson(assignments.stdout) || []
  output.push(`[+] Total role assignments: ${items.length}\n`)

  const dangerousRoles = ["Owner", "Contributor", "User Access Administrator"]
  const subLevel = items.filter(
    (a: Record<string, string>) =>
      a.scope?.match(/^\/subscriptions\/[^/]+$/) && dangerousRoles.includes(a.roleDefinitionName),
  )

  if (subLevel.length > 0) {
    output.push(`[!] Subscription-level privileged assignments: ${subLevel.length}`)
    for (const a of subLevel) {
      output.push(`    ${a.principalType}/${a.principalName} → ${a.roleDefinitionName}`)
      findings.push({
        checkId: "AZ-RBAC-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `rbac://${a.principalName}`,
        title: `${a.roleDefinitionName} at subscription: ${a.principalName}`,
        details: `${a.principalType} "${a.principalName}" has ${a.roleDefinitionName} at subscription scope`,
        remediation: "Scope role assignment to resource group or resource level",
      })
    }
  }

  const spAssignments = items.filter((a: Record<string, string>) => a.principalType === "ServicePrincipal")
  output.push(`\n[+] Service Principal assignments: ${spAssignments.length}`)
  for (const a of spAssignments) {
    if (dangerousRoles.includes(a.roleDefinitionName)) {
      output.push(`    [!] ${a.principalName} → ${a.roleDefinitionName} (scope: ${a.scope?.split("/").pop()})`)
    }
  }

  const customRoles = await az(["role", "definition", "list", "--custom-role-only"], sub, timeout)
  if (customRoles.exitCode === 0) {
    const roles = tryJson(customRoles.stdout) || []
    output.push(`\n[+] Custom roles: ${roles.length}`)
    for (const role of roles) {
      const permissions = role.permissions || []
      for (const p of permissions) {
        const actions = p.actions || []
        if (actions.includes("*")) {
          output.push(`    [!] ${role.roleName}: wildcard action (*)`)
          findings.push({
            checkId: "AZ-RBAC-002",
            provider: "azure",
            severity: "critical",
            status: "FAIL",
            resource: `role://${role.roleName}`,
            title: `Custom role with wildcard: ${role.roleName}`,
            details: `Role has * action — equivalent to built-in Owner`,
            remediation: "Restrict actions to specific resource types and operations",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function sqlEnumAzure(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const server = argVal(args, "--server")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure SQL...\n"]

  const servers = server
    ? await az(
        ["sql", "server", "show", "--name", server, "--resource-group", argVal(args, "--resource-group") || ""],
        sub,
        timeout,
      )
    : await az(["sql", "server", "list"], sub, timeout)

  if (servers.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list SQL servers", findings }

  const items = server ? [tryJson(servers.stdout)].filter(Boolean) : tryJson(servers.stdout) || []
  output.push(`[+] SQL Servers: ${items.length}\n`)

  for (const srv of items) {
    output.push(`── ${srv.name} (${srv.location}) ──`)
    output.push(`    FQDN: ${srv.fullyQualifiedDomainName}`)
    output.push(`    Admin: ${srv.administratorLogin}`)
    output.push(`    Version: ${srv.version}`)
    output.push(`    Public network: ${srv.publicNetworkAccess}`)

    if (srv.publicNetworkAccess === "Enabled") {
      findings.push({
        checkId: "AZ-SQL-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `sql://${srv.name}`,
        title: `SQL Server public access: ${srv.name}`,
        details: `Public network access is enabled`,
        remediation: "Disable public network access, use private endpoints",
      })
    }

    const firewall = await az(
      ["sql", "server", "firewall-rule", "list", "--server", srv.name, "--resource-group", srv.resourceGroup],
      sub,
      15,
    )
    if (firewall.exitCode === 0) {
      const rules = tryJson(firewall.stdout) || []
      output.push(`    Firewall rules: ${rules.length}`)
      for (const r of rules) {
        output.push(`      ${r.name}: ${r.startIpAddress} - ${r.endIpAddress}`)
        if (r.startIpAddress === "0.0.0.0" && r.endIpAddress === "255.255.255.255") {
          findings.push({
            checkId: "AZ-SQL-002",
            provider: "azure",
            severity: "critical",
            status: "FAIL",
            resource: `sql://${srv.name}/${r.name}`,
            title: `SQL allow-all firewall: ${srv.name}`,
            details: `Rule "${r.name}" allows 0.0.0.0-255.255.255.255`,
            remediation: "Remove allow-all rule, restrict to specific IPs",
          })
        }
      }
    }

    const dbs = await az(["sql", "db", "list", "--server", srv.name, "--resource-group", srv.resourceGroup], sub, 15)
    if (dbs.exitCode === 0) {
      const dbList = tryJson(dbs.stdout) || []
      output.push(`    Databases: ${dbList.length}`)
      for (const db of dbList) {
        if (db.name === "master") continue
        const tde = db.transparentDataEncryption?.state || "unknown"
        output.push(`      ${db.name} (${db.currentServiceObjectiveName}) TDE: ${tde}`)
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function appServiceEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure App Services...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const apps = await az(["webapp", "list", ...rgArgs], sub, timeout)
  if (apps.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list web apps", findings }

  const items = tryJson(apps.stdout) || []
  output.push(`[+] App Services: ${items.length}\n`)

  const secretPattern = /(?:password|secret|api[_-]?key|token|credential|connection[_-]?string)/i

  for (const app of items) {
    output.push(`── ${app.name} (${app.kind || "webapp"}) ──`)
    output.push(`    URL: ${app.defaultHostName}`)
    output.push(`    State: ${app.state}`)
    output.push(`    HTTPS only: ${app.httpsOnly}`)
    output.push(`    Client cert: ${app.clientCertEnabled}`)
    output.push(`    Identity: ${app.identity?.type || "none"}`)

    if (!app.httpsOnly) {
      findings.push({
        checkId: "AZ-APP-001",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `webapp://${app.name}`,
        title: `HTTPS not enforced: ${app.name}`,
        details: "App Service allows HTTP connections",
        remediation: "Enable HTTPS Only in App Service settings",
      })
    }

    const settings = await az(
      ["webapp", "config", "appsettings", "list", "--name", app.name, "--resource-group", app.resourceGroup],
      sub,
      15,
    )
    if (settings.exitCode === 0) {
      const settingList = tryJson(settings.stdout) || []
      for (const s of settingList) {
        if (secretPattern.test(s.name) || secretPattern.test(s.value || "")) {
          output.push(`    [!] Setting: ${s.name} = ${String(s.value || "").substring(0, 80)}...`)
          findings.push({
            checkId: "AZ-APP-002",
            provider: "azure",
            severity: "high",
            status: "EXTRACTED",
            resource: `webapp://${app.name}`,
            title: `Secret in app settings: ${app.name}/${s.name}`,
            details: `${s.name}: ${String(s.value || "").substring(0, 200)}`,
            remediation: "Use Key Vault references instead of plaintext secrets",
          })
        }
      }
    }

    const connStrings = await az(
      ["webapp", "config", "connection-string", "list", "--name", app.name, "--resource-group", app.resourceGroup],
      sub,
      15,
    )
    if (connStrings.exitCode === 0) {
      const cs = tryJson(connStrings.stdout)
      if (cs) {
        for (const [name, val] of Object.entries(cs)) {
          const v = val as Record<string, string>
          output.push(`    [!] Connection string: ${name} (${v.type}) = ${v.value?.substring(0, 80)}...`)
          findings.push({
            checkId: "AZ-APP-003",
            provider: "azure",
            severity: "critical",
            status: "EXTRACTED",
            resource: `webapp://${app.name}`,
            title: `Connection string: ${app.name}/${name}`,
            details: `${name}: ${v.value?.substring(0, 200)}`,
            remediation: "Use Key Vault references for connection strings",
          })
        }
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

// ── NEW handlers ──

export async function subscriptionEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure subscriptions and management groups...\n"]

  const acct = await run("az", ["account", "show", "-o", "json"], timeout)
  if (acct.exitCode !== 0) return { output: "[-] Not logged in to Azure CLI", findings }
  const current = tryJson(acct.stdout)
  output.push(`[*] Current tenant: ${current?.tenantId}`)
  output.push(`[*] Current subscription: ${current?.name} (${current?.id})\n`)

  const subs = await run("az", ["account", "list", "--all", "-o", "json"], timeout)
  if (subs.exitCode === 0) {
    const items = tryJson(subs.stdout) || []
    output.push(`[+] Accessible subscriptions: ${items.length}`)
    const tenants = new Set<string>()
    for (const s of items) {
      const state = s.state === "Enabled" ? "" : ` [${s.state}]`
      output.push(`    ${s.name} (${s.id}) — tenant: ${s.tenantId}${state}`)
      tenants.add(s.tenantId)
    }
    if (tenants.size > 1) {
      findings.push({
        checkId: "AZ-SUB-001",
        provider: "azure",
        severity: "info",
        status: "ENUMERATED",
        resource: "azure://subscriptions",
        title: `Multi-tenant access: ${tenants.size} tenants`,
        details: `Tenants: ${[...tenants].join(", ")}`,
        remediation: "Review cross-tenant access — each tenant is a separate blast radius",
      })
    }
    findings.push({
      checkId: "AZ-SUB-002",
      provider: "azure",
      severity: items.length > 5 ? "high" : "info",
      status: "ENUMERATED",
      resource: "azure://subscriptions",
      title: `${items.length} subscriptions accessible`,
      details: items.map((s: Record<string, string>) => `${s.name} (${s.id})`).join("; "),
      remediation: "Ensure subscription access follows least privilege",
    })
  }

  const mgGroups = await run("az", ["account", "management-group", "list", "-o", "json"], timeout)
  if (mgGroups.exitCode === 0) {
    const groups = tryJson(mgGroups.stdout) || []
    output.push(`\n[+] Management groups: ${groups.length}`)
    for (const g of groups) output.push(`    ${g.displayName} (${g.name}) — type: ${g.type}`)
    if (groups.length > 0) {
      findings.push({
        checkId: "AZ-SUB-003",
        provider: "azure",
        severity: "info",
        status: "ENUMERATED",
        resource: "azure://management-groups",
        title: `Management group access: ${groups.length} groups`,
        details: groups.map((g: Record<string, string>) => g.displayName).join(", "),
        remediation: "Review management group hierarchy for over-scoped permissions",
      })
    }
  }

  const tenants = await run("az", ["account", "tenant", "list", "-o", "json"], timeout)
  if (tenants.exitCode === 0) {
    const tList = tryJson(tenants.stdout) || []
    output.push(`\n[+] Tenants: ${tList.length}`)
    for (const t of tList) output.push(`    ${t.tenantId} (${t.tenantCategory || "unknown"})`)
  }

  return { output: output.join("\n"), findings }
}

export async function resourceGraph(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Resource Graph — cross-subscription discovery...\n"]

  const extCheck = await run("az", ["extension", "show", "--name", "resource-graph", "-o", "json"], 10)
  if (extCheck.exitCode !== 0) {
    output.push("[*] Installing resource-graph extension...")
    await run("az", ["extension", "add", "--name", "resource-graph", "-y"], 30)
  }

  const subArgs = sub ? ["--subscriptions", sub] : []

  const queries: { label: string; q: string; checkId: string; severity: string }[] = [
    {
      label: "Public IPs",
      q: "Resources | where type =~ 'Microsoft.Network/publicIPAddresses' | project name, resourceGroup, subscriptionId, properties.ipAddress, properties.publicIPAllocationMethod",
      checkId: "AZ-RG-001",
      severity: "medium",
    },
    {
      label: "Storage with public access",
      q: "Resources | where type =~ 'Microsoft.Storage/storageAccounts' and properties.allowBlobPublicAccess == true | project name, resourceGroup, subscriptionId",
      checkId: "AZ-RG-002",
      severity: "high",
    },
    {
      label: "VMs with public IPs",
      q: "Resources | where type =~ 'Microsoft.Compute/virtualMachines' | where isnotnull(properties.networkProfile.networkInterfaces) | project name, resourceGroup, subscriptionId, properties.hardwareProfile.vmSize",
      checkId: "AZ-RG-003",
      severity: "medium",
    },
    {
      label: "Open NSG rules (any source, any port)",
      q: "Resources | where type =~ 'Microsoft.Network/networkSecurityGroups' | mvexpand rules = properties.securityRules | where rules.properties.direction == 'Inbound' and rules.properties.access == 'Allow' and rules.properties.sourceAddressPrefix == '*' and rules.properties.destinationPortRange == '*' | project name, resourceGroup, subscriptionId, ruleName = rules.name",
      checkId: "AZ-RG-004",
      severity: "critical",
    },
  ]

  for (const q of queries) {
    const r = await run("az", ["graph", "query", "-q", q.q, ...subArgs, "-o", "json"], timeout)
    if (r.exitCode === 0) {
      const data = tryJson(r.stdout)
      const count = data?.count ?? data?.data?.length ?? 0
      const items = data?.data || []
      output.push(`[+] ${q.label}: ${count}`)
      for (const item of items.slice(0, 15)) {
        output.push(`    ${item.name} (${item.resourceGroup}) — sub: ${item.subscriptionId?.substring(0, 8)}...`)
      }
      if (items.length > 15) output.push(`    ... and ${items.length - 15} more`)
      if (count > 0) {
        findings.push({
          checkId: q.checkId,
          provider: "azure",
          severity: q.severity,
          status: "FAIL",
          resource: "azure://resource-graph",
          title: `${q.label}: ${count} found`,
          details: items.slice(0, 10).map((i: Record<string, string>) => i.name).join(", "),
          remediation: `Review ${q.label.toLowerCase()} for security exposure`,
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function vnetEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure VNet topology...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const vnets = await az(["network", "vnet", "list", ...rgArgs], sub, timeout)
  if (vnets.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list VNets", findings }

  const items = tryJson(vnets.stdout) || []
  output.push(`[+] VNets: ${items.length}\n`)

  for (const vnet of items) {
    output.push(`── ${vnet.name} (${vnet.resourceGroup}) ──`)
    const prefixes = vnet.addressSpace?.addressPrefixes || []
    output.push(`    Address space: ${prefixes.join(", ")}`)
    output.push(`    DNS: ${(vnet.dhcpOptions?.dnsServers || []).join(", ") || "Azure default"}`)

    const subnets = vnet.subnets || []
    output.push(`    Subnets: ${subnets.length}`)
    for (const s of subnets) {
      const nsg = s.networkSecurityGroup ? s.networkSecurityGroup.id.split("/").pop() : "NONE"
      const svcEndpoints = (s.serviceEndpoints || []).map((e: Record<string, string>) => e.service).join(", ")
      output.push(`      ${s.name}: ${s.addressPrefix} — NSG: ${nsg}${svcEndpoints ? `, SvcEndpoints: ${svcEndpoints}` : ""}`)
      if (nsg === "NONE") {
        findings.push({
          checkId: "AZ-VNET-001",
          provider: "azure",
          severity: "medium",
          status: "FAIL",
          resource: `vnet://${vnet.name}/${s.name}`,
          title: `Subnet without NSG: ${vnet.name}/${s.name}`,
          details: `Subnet ${s.name} (${s.addressPrefix}) has no NSG attached`,
          remediation: "Attach NSG to subnet for traffic filtering",
        })
      }
    }

    const peerings = await az(
      ["network", "vnet", "peering", "list", "--vnet-name", vnet.name, "--resource-group", vnet.resourceGroup],
      sub,
      15,
    )
    if (peerings.exitCode === 0) {
      const peers = tryJson(peerings.stdout) || []
      if (peers.length > 0) {
        output.push(`    Peerings: ${peers.length}`)
        for (const p of peers) {
          const remote = p.remoteVirtualNetwork?.id?.split("/").pop() || "?"
          output.push(`      → ${remote} (${p.peeringState}) allowGateway: ${p.allowGatewayTransit}, useRemote: ${p.useRemoteGateways}`)
          findings.push({
            checkId: "AZ-VNET-002",
            provider: "azure",
            severity: "medium",
            status: "INFO",
            resource: `vnet://${vnet.name}/peering/${p.name}`,
            title: `VNet peering: ${vnet.name} → ${remote}`,
            details: `State: ${p.peeringState}, allows forwarded traffic: ${p.allowForwardedTraffic}`,
            remediation: "Ensure peering is intentional — peered VNets have implicit network trust",
          })
        }
      }
    }
    output.push("")
  }

  const vpn = await az(["network", "vnet-gateway", "list", ...(rg ? ["--resource-group", rg] : [])], sub, timeout)
  if (vpn.exitCode === 0) {
    const gateways = tryJson(vpn.stdout) || []
    if (gateways.length > 0) {
      output.push(`[+] VPN Gateways: ${gateways.length}`)
      for (const g of gateways) {
        output.push(`    ${g.name} (${g.gatewayType}/${g.vpnType}) — SKU: ${g.sku?.name}`)
      }
    }
  }

  const er = await az(["network", "express-route", "list"], sub, timeout)
  if (er.exitCode === 0) {
    const circuits = tryJson(er.stdout) || []
    if (circuits.length > 0) {
      output.push(`\n[+] ExpressRoute circuits: ${circuits.length}`)
      for (const c of circuits) {
        output.push(`    ${c.name} — provider: ${c.serviceProviderProperties?.serviceProviderName}, bandwidth: ${c.serviceProviderProperties?.bandwidthInMbps}Mbps`)
        findings.push({
          checkId: "AZ-VNET-003",
          provider: "azure",
          severity: "info",
          status: "ENUMERATED",
          resource: `expressroute://${c.name}`,
          title: `ExpressRoute circuit: ${c.name}`,
          details: `Private peering to on-premises network — potential pivot path`,
          remediation: "Review ExpressRoute routing and access controls",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function dnsEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure DNS...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []

  const zones = await az(["network", "dns", "zone", "list", ...rgArgs], sub, timeout)
  if (zones.exitCode === 0) {
    const items = tryJson(zones.stdout) || []
    output.push(`[+] Public DNS zones: ${items.length}`)
    for (const z of items) {
      output.push(`\n── ${z.name} (${z.resourceGroup}) ──`)
      output.push(`    Records: ${z.numberOfRecordSets}`)

      const records = await az(
        ["network", "dns", "record-set", "list", "--zone-name", z.name, "--resource-group", z.resourceGroup],
        sub,
        30,
      )
      if (records.exitCode === 0) {
        const recs = tryJson(records.stdout) || []
        const cnames = recs.filter((r: Record<string, string>) => r.type?.endsWith("/CNAME"))
        for (const cn of cnames) {
          const target = cn.cnameRecord?.cname || ""
          output.push(`    CNAME: ${cn.name}.${z.name} → ${target}`)
          const danglingPatterns = [
            ".azurewebsites.net",
            ".cloudapp.azure.com",
            ".trafficmanager.net",
            ".blob.core.windows.net",
            ".azureedge.net",
            ".azure-api.net",
          ]
          const isDangling = danglingPatterns.some((p) => target.endsWith(p))
          if (isDangling) {
            findings.push({
              checkId: "AZ-DNS-001",
              provider: "azure",
              severity: "high",
              status: "POTENTIAL",
              resource: `dns://${z.name}/${cn.name}`,
              title: `Potential subdomain takeover: ${cn.name}.${z.name}`,
              details: `CNAME points to Azure service: ${target} — verify target resource exists`,
              remediation: "Remove dangling CNAME or reclaim the Azure resource",
            })
          }
        }
        const aRecs = recs.filter((r: Record<string, string>) => r.type?.endsWith("/A") || r.type?.endsWith("/AAAA"))
        output.push(`    A/AAAA records: ${aRecs.length}, CNAME records: ${cnames.length}`)
      }
    }
  }

  const privateZones = await az(["network", "private-dns", "zone", "list", ...rgArgs], sub, timeout)
  if (privateZones.exitCode === 0) {
    const items = tryJson(privateZones.stdout) || []
    output.push(`\n[+] Private DNS zones: ${items.length}`)
    for (const z of items) {
      output.push(`    ${z.name} — records: ${z.numberOfRecordSets}`)

      const links = await az(
        ["network", "private-dns", "link", "vnet", "list", "--zone-name", z.name, "--resource-group", z.resourceGroup],
        sub,
        15,
      )
      if (links.exitCode === 0) {
        const vnetLinks = tryJson(links.stdout) || []
        for (const l of vnetLinks) {
          const vnet = l.virtualNetwork?.id?.split("/").pop() || "?"
          output.push(`      → linked VNet: ${vnet} (registration: ${l.registrationEnabled})`)
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function acrEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Container Registries...\n"]

  const registries = await az(["acr", "list"], sub, timeout)
  if (registries.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list ACRs", findings }

  const items = tryJson(registries.stdout) || []
  output.push(`[+] Container Registries: ${items.length}\n`)

  for (const acr of items) {
    output.push(`── ${acr.name} (${acr.loginServer}) ──`)
    output.push(`    SKU: ${acr.sku?.name}`)
    output.push(`    Admin: ${acr.adminUserEnabled ? "ENABLED" : "disabled"}`)
    output.push(`    Public access: ${acr.publicNetworkAccess || "Enabled"}`)
    output.push(`    Network rules: ${acr.networkRuleSet?.defaultAction || "Allow"}`)

    if (acr.adminUserEnabled) {
      findings.push({
        checkId: "AZ-ACR-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `acr://${acr.name}`,
        title: `ACR admin user enabled: ${acr.name}`,
        details: "Admin user provides full push/pull access — shared credential, no audit trail",
        remediation: "Disable admin user, use Azure AD/managed identity for auth",
      })

      const creds = await az(["acr", "credential", "show", "--name", acr.name], sub, 15)
      if (creds.exitCode === 0) {
        const credData = tryJson(creds.stdout)
        if (credData) {
          output.push(`    [!] Admin username: ${credData.username}`)
          output.push(`    [!] Admin password: ${credData.passwords?.[0]?.value?.substring(0, 20)}...`)
          findings.push({
            checkId: "AZ-ACR-002",
            provider: "azure",
            severity: "critical",
            status: "EXTRACTED",
            resource: `acr://${acr.name}/credentials`,
            title: `ACR admin credentials extracted: ${acr.name}`,
            details: `Username: ${credData.username}, can push/pull any image`,
            remediation: "Rotate credentials immediately, disable admin user",
          })
        }
      }
    }

    const repos = await az(["acr", "repository", "list", "--name", acr.name], sub, 30)
    if (repos.exitCode === 0) {
      const repoList = tryJson(repos.stdout) || []
      output.push(`    Repositories: ${repoList.length}`)
      for (const repo of repoList.slice(0, 20)) output.push(`      ${repo}`)
      if (repoList.length > 20) output.push(`      ... and ${repoList.length - 20} more`)
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function vmssEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Virtual Machine Scale Sets...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const sets = await az(["vmss", "list", ...rgArgs], sub, timeout)
  if (sets.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list VMSS", findings }

  const items = tryJson(sets.stdout) || []
  output.push(`[+] VMSS: ${items.length}\n`)

  for (const vmss of items) {
    output.push(`── ${vmss.name} (${vmss.resourceGroup}) ──`)
    output.push(`    VM size: ${vmss.sku?.name}`)
    output.push(`    Capacity: ${vmss.sku?.capacity}`)
    output.push(`    Upgrade policy: ${vmss.upgradePolicy?.mode || "Manual"}`)

    const identity = vmss.identity
    if (identity) {
      output.push(`    Identity: ${identity.type}`)
      if (identity.type === "SystemAssigned" || identity.type === "SystemAssigned, UserAssigned") {
        findings.push({
          checkId: "AZ-VMSS-001",
          provider: "azure",
          severity: "info",
          status: "ENUMERATED",
          resource: `vmss://${vmss.name}`,
          title: `VMSS with managed identity: ${vmss.name}`,
          details: `Identity type: ${identity.type} — check RBAC assignments for over-privilege`,
          remediation: "Review managed identity role assignments",
        })
      }
    }

    const extensions = vmss.virtualMachineProfile?.extensionProfile?.extensions || []
    if (extensions.length > 0) {
      output.push(`    Extensions: ${extensions.map((e: Record<string, string>) => e.name).join(", ")}`)
      for (const ext of extensions) {
        if (ext.properties?.type === "CustomScriptExtension" || ext.properties?.type === "CustomScript") {
          findings.push({
            checkId: "AZ-VMSS-002",
            provider: "azure",
            severity: "medium",
            status: "INFO",
            resource: `vmss://${vmss.name}/ext/${ext.name}`,
            title: `Custom script extension on VMSS: ${vmss.name}`,
            details: `Extension ${ext.name} runs arbitrary code on scale-out`,
            remediation: "Review custom script for malicious or sensitive content",
          })
        }
      }
    }

    const instances = await az(
      ["vmss", "list-instances", "--name", vmss.name, "--resource-group", vmss.resourceGroup],
      sub,
      15,
    )
    if (instances.exitCode === 0) {
      const instanceList = tryJson(instances.stdout) || []
      output.push(`    Running instances: ${instanceList.length}`)
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function redisEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Cache for Redis...\n"]

  const caches = await az(["redis", "list"], sub, timeout)
  if (caches.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Redis caches", findings }

  const items = tryJson(caches.stdout) || []
  output.push(`[+] Redis instances: ${items.length}\n`)

  for (const cache of items) {
    output.push(`── ${cache.name} (${cache.location}) ──`)
    output.push(`    Host: ${cache.hostName}`)
    output.push(`    Port: ${cache.port} (SSL: ${cache.sslPort})`)
    output.push(`    SKU: ${cache.sku?.name} (${cache.sku?.family}${cache.sku?.capacity})`)
    output.push(`    TLS min: ${cache.minimumTlsVersion || "not set"}`)
    output.push(`    Non-SSL port: ${cache.enableNonSslPort ? "ENABLED" : "disabled"}`)
    output.push(`    Public access: ${cache.publicNetworkAccess || "Enabled"}`)

    if (cache.enableNonSslPort) {
      findings.push({
        checkId: "AZ-REDIS-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `redis://${cache.name}`,
        title: `Redis non-SSL port enabled: ${cache.name}`,
        details: `Port ${cache.port} accepts unencrypted connections — credentials visible in transit`,
        remediation: "Disable non-SSL port: az redis update --name NAME --set enableNonSslPort=false",
      })
    }

    if (cache.publicNetworkAccess !== "Disabled") {
      findings.push({
        checkId: "AZ-REDIS-002",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `redis://${cache.name}`,
        title: `Redis public network access: ${cache.name}`,
        details: "Redis is accessible from public networks",
        remediation: "Disable public access, use private endpoints",
      })
    }

    const keys = await az(
      ["redis", "list-keys", "--name", cache.name, "--resource-group", cache.resourceGroup],
      sub,
      15,
    )
    if (keys.exitCode === 0) {
      const keyData = tryJson(keys.stdout)
      if (keyData) {
        output.push(`    [!] Primary key: ${keyData.primaryKey?.substring(0, 20)}...`)
        findings.push({
          checkId: "AZ-REDIS-003",
          provider: "azure",
          severity: "critical",
          status: "EXTRACTED",
          resource: `redis://${cache.name}/keys`,
          title: `Redis access keys extracted: ${cache.name}`,
          details: `Full access keys retrieved — connect: redis-cli -h ${cache.hostName} -p ${cache.sslPort} -a KEY --tls`,
          remediation: "Rotate keys, use AAD authentication if supported",
        })
      }
    }

    const firewall = await az(
      ["redis", "firewall-rules", "list", "--name", cache.name, "--resource-group", cache.resourceGroup],
      sub,
      15,
    )
    if (firewall.exitCode === 0) {
      const rules = tryJson(firewall.stdout) || []
      output.push(`    Firewall rules: ${rules.length}`)
      for (const r of rules) {
        output.push(`      ${r.name}: ${r.startIP} - ${r.endIP}`)
        if (r.startIP === "0.0.0.0" && r.endIP === "255.255.255.255") {
          findings.push({
            checkId: "AZ-REDIS-004",
            provider: "azure",
            severity: "critical",
            status: "FAIL",
            resource: `redis://${cache.name}/firewall/${r.name}`,
            title: `Redis allow-all firewall: ${cache.name}`,
            details: `Rule "${r.name}" allows 0.0.0.0 - 255.255.255.255`,
            remediation: "Restrict firewall rules to specific IP ranges",
          })
        }
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function dataFactoryEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Data Factory...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const factories = await az(["datafactory", "list", ...rgArgs], sub, timeout)
  if (factories.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Data Factories (extension may be needed: az extension add --name datafactory)", findings }

  const items = tryJson(factories.stdout) || []
  output.push(`[+] Data Factories: ${items.length}\n`)

  const secretPattern = /(?:password|secret|key|token|credential|AccountKey|SharedAccessSignature)/i

  for (const df of items) {
    output.push(`── ${df.name} (${df.resourceGroup}) ──`)
    output.push(`    Location: ${df.location}`)
    output.push(`    Public access: ${df.publicNetworkAccess || "Enabled"}`)
    output.push(`    Identity: ${df.identity?.type || "none"}`)

    const linkedServices = await az(
      ["datafactory", "linked-service", "list", "--factory-name", df.name, "--resource-group", df.resourceGroup],
      sub,
      30,
    )
    if (linkedServices.exitCode === 0) {
      const services = tryJson(linkedServices.stdout) || []
      output.push(`    Linked services: ${services.length}`)
      for (const svc of services) {
        const svcType = svc.properties?.type || "Unknown"
        output.push(`      ${svc.name} (${svcType})`)
        const connStr = JSON.stringify(svc.properties?.typeProperties || {})
        if (secretPattern.test(connStr)) {
          output.push(`        [!] Contains credential-like values`)
          findings.push({
            checkId: "AZ-ADF-001",
            provider: "azure",
            severity: "high",
            status: "POTENTIAL",
            resource: `adf://${df.name}/${svc.name}`,
            title: `Potential credentials in linked service: ${df.name}/${svc.name}`,
            details: `Linked service type: ${svcType} — connection properties may contain plaintext credentials`,
            remediation: "Use Key Vault references for linked service credentials",
          })
        }
      }
    }

    const pipelines = await az(
      ["datafactory", "pipeline", "list", "--factory-name", df.name, "--resource-group", df.resourceGroup],
      sub,
      30,
    )
    if (pipelines.exitCode === 0) {
      const pipelineList = tryJson(pipelines.stdout) || []
      output.push(`    Pipelines: ${pipelineList.length}`)
      for (const p of pipelineList.slice(0, 10)) output.push(`      ${p.name}`)
    }

    const runtimes = await az(
      ["datafactory", "integration-runtime", "list", "--factory-name", df.name, "--resource-group", df.resourceGroup],
      sub,
      15,
    )
    if (runtimes.exitCode === 0) {
      const rtList = tryJson(runtimes.stdout) || []
      output.push(`    Integration runtimes: ${rtList.length}`)
      for (const rt of rtList) output.push(`      ${rt.name} (${rt.properties?.type || "?"})`)
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function frontDoorEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Front Door & Application Gateways...\n"]

  const frontDoors = await az(["network", "front-door", "list"], sub, timeout)
  if (frontDoors.exitCode === 0) {
    const items = tryJson(frontDoors.stdout) || []
    output.push(`[+] Front Doors: ${items.length}`)

    for (const fd of items) {
      output.push(`\n── Front Door: ${fd.name} (${fd.resourceGroup}) ──`)
      output.push(`    State: ${fd.enabledState}`)

      const backends = fd.backendPools || []
      for (const pool of backends) {
        output.push(`    Backend pool: ${pool.name}`)
        for (const b of pool.backends || []) {
          output.push(`      → ${b.address}:${b.httpPort}/${b.httpsPort} (priority: ${b.priority}, weight: ${b.weight})`)
        }
      }

      const rules = fd.routingRules || []
      for (const rule of rules) {
        const accepted = rule.acceptedProtocols || []
        if (accepted.includes("Http")) {
          findings.push({
            checkId: "AZ-FD-001",
            provider: "azure",
            severity: "medium",
            status: "FAIL",
            resource: `frontdoor://${fd.name}/${rule.name}`,
            title: `Front Door accepts HTTP: ${fd.name}/${rule.name}`,
            details: `Routing rule "${rule.name}" accepts HTTP — should redirect to HTTPS`,
            remediation: "Configure HTTP to HTTPS redirect rule",
          })
        }
      }
    }

    const wafPolicies = await az(["network", "front-door", "waf-policy", "list"], sub, timeout)
    if (wafPolicies.exitCode === 0) {
      const policies = tryJson(wafPolicies.stdout) || []
      output.push(`\n[+] Front Door WAF policies: ${policies.length}`)
      for (const p of policies) {
        output.push(`    ${p.name}: mode=${p.policySettings?.mode}, state=${p.policySettings?.enabledState}`)
        if (p.policySettings?.mode === "Detection") {
          findings.push({
            checkId: "AZ-FD-002",
            provider: "azure",
            severity: "medium",
            status: "FAIL",
            resource: `waf://${p.name}`,
            title: `WAF in Detection mode: ${p.name}`,
            details: "WAF is logging but not blocking malicious requests",
            remediation: "Switch WAF to Prevention mode",
          })
        }
        const exclusions = p.managedRules?.managedRuleSets?.flatMap((r: Record<string, unknown[]>) => r.ruleGroupOverrides || []) || []
        if (exclusions.length > 0) {
          output.push(`    [!] Rule overrides: ${exclusions.length} groups modified`)
        }
      }
    }
  }

  const appGateways = await az(["network", "application-gateway", "list"], sub, timeout)
  if (appGateways.exitCode === 0) {
    const gateways = tryJson(appGateways.stdout) || []
    output.push(`\n[+] Application Gateways: ${gateways.length}`)
    for (const gw of gateways) {
      output.push(`    ${gw.name} (${gw.resourceGroup}) — SKU: ${gw.sku?.name}, tier: ${gw.sku?.tier}`)
      const wafConfig = gw.webApplicationFirewallConfiguration
      if (wafConfig) {
        output.push(`      WAF: ${wafConfig.enabled ? "enabled" : "disabled"}, mode: ${wafConfig.firewallMode}`)
        if (wafConfig.firewallMode === "Detection") {
          findings.push({
            checkId: "AZ-FD-003",
            provider: "azure",
            severity: "medium",
            status: "FAIL",
            resource: `appgw://${gw.name}`,
            title: `App Gateway WAF in Detection mode: ${gw.name}`,
            details: "WAF is logging but not blocking",
            remediation: "Switch WAF to Prevention mode",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function containerInstanceEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Container Instances...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const containers = await az(["container", "list", ...rgArgs], sub, timeout)
  if (containers.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list ACI groups", findings }

  const items = tryJson(containers.stdout) || []
  output.push(`[+] Container groups: ${items.length}\n`)

  const secretPattern = /(?:password|secret|api[_-]?key|token|credential|connection[_-]?string)/i

  for (const group of items) {
    output.push(`── ${group.name} (${group.resourceGroup}) ──`)
    output.push(`    OS: ${group.osType}`)
    output.push(`    State: ${group.instanceView?.state || group.provisioningState}`)
    output.push(`    IP: ${group.ipAddress?.ip || "private"} (${group.ipAddress?.type || "?"})`)
    output.push(`    Identity: ${group.identity?.type || "none"}`)

    if (group.ipAddress?.type === "Public") {
      findings.push({
        checkId: "AZ-ACI-001",
        provider: "azure",
        severity: "medium",
        status: "INFO",
        resource: `aci://${group.name}`,
        title: `ACI with public IP: ${group.name}`,
        details: `Public IP: ${group.ipAddress?.ip}, ports: ${(group.ipAddress?.ports || []).map((p: Record<string, number>) => `${p.port}/${p.protocol}`).join(", ")}`,
        remediation: "Use private IP with VNet integration if public access not needed",
      })
    }

    const containerList = group.containers || []
    for (const c of containerList) {
      output.push(`    Container: ${c.name} — image: ${c.image}`)
      const envVars = c.environmentVariables || []
      if (envVars.length > 0) {
        output.push(`      Env vars: ${envVars.length}`)
        for (const env of envVars) {
          if (env.secureValue) {
            output.push(`        ${env.name} = [SECURE - redacted]`)
          } else if (secretPattern.test(env.name) || secretPattern.test(env.value || "")) {
            output.push(`        [!] ${env.name} = ${String(env.value || "").substring(0, 80)}`)
            findings.push({
              checkId: "AZ-ACI-002",
              provider: "azure",
              severity: "high",
              status: "EXTRACTED",
              resource: `aci://${group.name}/${c.name}`,
              title: `Secret in ACI env var: ${group.name}/${c.name}/${env.name}`,
              details: `${env.name}: ${String(env.value || "").substring(0, 200)}`,
              remediation: "Use secureValue for secrets or mount from Key Vault",
            })
          }
        }
      }

      const mounts = c.volumeMounts || []
      if (mounts.length > 0) {
        output.push(`      Volume mounts: ${mounts.map((m: Record<string, string>) => `${m.name}→${m.mountPath}`).join(", ")}`)
      }
    }

    const volumes = group.volumes || []
    for (const v of volumes) {
      if (v.azureFile) {
        output.push(`    Volume: ${v.name} → Azure File Share: ${v.azureFile.shareName} (account: ${v.azureFile.storageAccountName})`)
        findings.push({
          checkId: "AZ-ACI-003",
          provider: "azure",
          severity: "medium",
          status: "INFO",
          resource: `aci://${group.name}/volume/${v.name}`,
          title: `ACI mounts Azure File Share: ${v.azureFile.shareName}`,
          details: `Storage account: ${v.azureFile.storageAccountName} — storage account key embedded in container group`,
          remediation: "Use managed identity for storage access instead of embedded keys",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}
