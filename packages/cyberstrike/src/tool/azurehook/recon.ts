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
          details: items
            .slice(0, 10)
            .map((i: Record<string, string>) => i.name)
            .join(", "),
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
      output.push(
        `      ${s.name}: ${s.addressPrefix} — NSG: ${nsg}${svcEndpoints ? `, SvcEndpoints: ${svcEndpoints}` : ""}`,
      )
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
          output.push(
            `      → ${remote} (${p.peeringState}) allowGateway: ${p.allowGatewayTransit}, useRemote: ${p.useRemoteGateways}`,
          )
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
        output.push(
          `    ${c.name} — provider: ${c.serviceProviderProperties?.serviceProviderName}, bandwidth: ${c.serviceProviderProperties?.bandwidthInMbps}Mbps`,
        )
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
  if (factories.exitCode !== 0)
    return {
      output:
        output.join("\n") +
        "[-] Cannot list Data Factories (extension may be needed: az extension add --name datafactory)",
      findings,
    }

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
          output.push(
            `      → ${b.address}:${b.httpPort}/${b.httpsPort} (priority: ${b.priority}, weight: ${b.weight})`,
          )
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
        const exclusions =
          p.managedRules?.managedRuleSets?.flatMap((r: Record<string, unknown[]>) => r.ruleGroupOverrides || []) || []
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
        output.push(
          `      Volume mounts: ${mounts.map((m: Record<string, string>) => `${m.name}→${m.mountPath}`).join(", ")}`,
        )
      }
    }

    const volumes = group.volumes || []
    for (const v of volumes) {
      if (v.azureFile) {
        output.push(
          `    Volume: ${v.name} → Azure File Share: ${v.azureFile.shareName} (account: ${v.azureFile.storageAccountName})`,
        )
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

// ── P0 recon handlers (apimEnum..purviewEnum) ──
// ── P2 recon handlers (subdomainTakeover..publicExposureScan) ──
// ── P3 niche handlers (databricksSecretDump..privateLinkAudit) ──
// Duplicate stubs removed — canonical implementations below.

// ── P0 Recon Handlers ──

export async function apimEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] API Management Enumeration\n"]
  const services = await az(["apim", "list", "--query", "[].{name:name,rg:resourceGroup,sku:sku.name,gateway:gatewayUrl,portal:developerPortalUrl}"], sub, timeout)
  if (services.exitCode !== 0) return { output: "[-] Cannot list APIM services", findings }
  const list = tryJson(services.stdout) || []
  output.push(`[+] API Management services: ${list.length}`)
  for (const s of list) {
    output.push(`    ${s.name} (${s.sku}) — rg: ${s.rg}`)
    output.push(`      Gateway: ${s.gateway || "N/A"}`)
    output.push(`      Dev Portal: ${s.portal || "N/A"}`)
    const apis = await az(["apim", "api", "list", "--service-name", s.name, "--resource-group", s.rg, "--query", "[].{name:displayName,path:path,protocols:protocols}"], sub, timeout)
    if (apis.exitCode === 0) {
      const apiList = tryJson(apis.stdout) || []
      output.push(`      APIs: ${apiList.length}`)
      for (const a of apiList) output.push(`        ${a.name} — /${a.path} [${(a.protocols || []).join(",")}]`)
    }
    findings.push({ checkId: "AZ-APIM-001", provider: "azure", severity: "medium", status: "INFO", resource: `apim://${s.name}`, title: `APIM service: ${s.name}`, details: `Gateway: ${s.gateway}. May expose internal APIs.`, remediation: "Review API access policies and subscription keys" })
  }
  return { output: output.join("\n"), findings }
}

export async function databricksEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Databricks enumeration...\n"]
  const workspaces = await az(["databricks", "workspace", "list", "--query", "[].{name:name,rg:resourceGroup,url:workspaceUrl,sku:sku.name,managedRg:managedResourceGroupId}"], sub, timeout)
  if (workspaces.exitCode !== 0) return { output: "[-] Cannot list Databricks workspaces", findings }
  const list = tryJson(workspaces.stdout) || []
  output.push(`[+] Databricks workspaces: ${list.length}`)
  for (const w of list) {
    output.push(`    ${w.name} (${w.sku}) — ${w.url || "N/A"}`)
    output.push(`      RG: ${w.rg}, Managed RG: ${w.managedRg?.split("/").pop() || "N/A"}`)
    findings.push({ checkId: "AZ-DBRICKS-001", provider: "azure", severity: "high", status: "INFO", resource: `databricks://${w.name}`, title: `Databricks workspace: ${w.name}`, details: `URL: ${w.url}. Contains notebooks, secrets, and compute. High-value target.`, remediation: "Review workspace access and token management" })
  }
  return { output: output.join("\n"), findings }
}

export async function appInsightsEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Application Insights enumeration...\n"]
  const apps = await az(["monitor", "app-insights", "component", "show", "--query", "{name:name,rg:resourceGroup,appId:appId,ikey:instrumentationKey,kind:kind,connStr:connectionString}"], sub, timeout)
  if (apps.exitCode !== 0) {
    const list = await az(["resource", "list", "--resource-type", "Microsoft.Insights/components", "--query", "[].{name:name,rg:resourceGroup}"], sub, timeout)
    if (list.exitCode === 0) {
      const components = tryJson(list.stdout) || []
      output.push(`[+] App Insights components: ${components.length}`)
      for (const c of components) output.push(`    ${c.name} — rg: ${c.rg}`)
    }
    return { output: output.join("\n"), findings }
  }
  const info = tryJson(apps.stdout)
  if (info) {
    output.push(`[+] App Insights: ${info.name}`)
    output.push(`    Instrumentation Key: ${info.ikey}`)
    output.push(`    App ID: ${info.appId}`)
    if (info.connStr) output.push(`    Connection String: ${String(info.connStr).substring(0, 80)}...`)
    findings.push({ checkId: "AZ-APPINS-001", provider: "azure", severity: "medium", status: "INFO", resource: `appinsights://${info.name}`, title: `App Insights: ${info.name}`, details: `Instrumentation key exposed. Query telemetry for app behavior, user data, errors.`, remediation: "Restrict API key access, use AAD-based auth" })
  }
  return { output: output.join("\n"), findings }
}

export async function monitorEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Monitor & Log Analytics enumeration...\n"]
  const workspaces = await az(["monitor", "log-analytics", "workspace", "list", "--query", "[].{name:name,rg:resourceGroup,retention:retentionInDays,sku:sku.name,id:customerId}"], sub, timeout)
  if (workspaces.exitCode !== 0) return { output: "[-] Cannot list Log Analytics workspaces", findings }
  const list = tryJson(workspaces.stdout) || []
  output.push(`[+] Log Analytics workspaces: ${list.length}`)
  for (const ws of list) {
    output.push(`    ${ws.name} (${ws.sku}) — retention: ${ws.retention}d, rg: ${ws.rg}`)
    output.push(`      Customer ID: ${ws.id}`)
    const solutions = await az(["monitor", "log-analytics", "solution", "list", "--resource-group", ws.rg, "--query", "[].{name:name,plan:plan.product}"], sub, timeout)
    if (solutions.exitCode === 0) {
      const solList = tryJson(solutions.stdout) || []
      if (solList.length > 0) {
        output.push(`      Solutions: ${solList.map((s: Record<string, string>) => s.plan || s.name).join(", ")}`)
      }
    }
    findings.push({ checkId: "AZ-MONITOR-001", provider: "azure", severity: "info", status: "INFO", resource: `log-analytics://${ws.name}`, title: `Log Analytics workspace: ${ws.name}`, details: `Retention: ${ws.retention}d. Query for security events, sign-in logs.`, remediation: "Restrict workspace access, review shared keys" })
  }
  return { output: output.join("\n"), findings }
}

export async function recoveryVaultEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Recovery Services vault enumeration...\n"]
  const vaults = await az(["backup", "vault", "list", "--query", "[].{name:name,rg:resourceGroup,location:location}"], sub, timeout)
  if (vaults.exitCode !== 0) return { output: "[-] Cannot list Recovery Services vaults", findings }
  const list = tryJson(vaults.stdout) || []
  output.push(`[+] Recovery Services vaults: ${list.length}`)
  for (const v of list) {
    output.push(`    ${v.name} (${v.rg}) — ${v.location}`)
    const items = await az(["backup", "item", "list", "--vault-name", v.name, "--resource-group", v.rg, "--query", "[].{name:name,type:workloadType,status:protectionStatus,state:protectionState}"], sub, timeout)
    if (items.exitCode === 0) {
      const itemList = tryJson(items.stdout) || []
      output.push(`      Backup items: ${itemList.length}`)
      for (const i of itemList) output.push(`        ${i.name} (${i.type}) — ${i.status}/${i.state}`)
    }
    findings.push({ checkId: "AZ-VAULT-001", provider: "azure", severity: "medium", status: "INFO", resource: `recovery-vault://${v.name}`, title: `Recovery vault: ${v.name}`, details: `${v.location}. Contains VM/SQL/file backups — data exfil or ransomware target.`, remediation: "Enable soft delete, MUA, and resource locks on vaults" })
  }
  return { output: output.join("\n"), findings }
}

export async function intuneEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Microsoft Intune / Endpoint Manager enumeration...\n"]
  const devices = await run("az", ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=100&$select=deviceName,operatingSystem,complianceState,managementAgent,userPrincipalName", "-o", "json"], timeout)
  if (devices.exitCode !== 0) {
    output.push(`[-] Cannot enumerate Intune (needs DeviceManagementManagedDevices.Read.All): ${devices.stderr.slice(0, 200)}`)
    return { output: output.join("\n"), findings }
  }
  const list = tryJson(devices.stdout)?.value || []
  output.push(`[+] Intune managed devices: ${list.length}`)
  const osCounts: Record<string, number> = {}
  for (const d of list) {
    const os = d.operatingSystem || "unknown"
    osCounts[os] = (osCounts[os] || 0) + 1
    output.push(`    ${d.deviceName} — ${os} (${d.managementAgent}) user: ${d.userPrincipalName || "N/A"} compliance: ${d.complianceState}`)
  }
  output.push(`\n[+] OS distribution: ${Object.entries(osCounts).map(([k, v]) => `${k}:${v}`).join(", ")}`)
  if (list.length > 0) findings.push({ checkId: "AZ-INTUNE-ENUM-001", provider: "azure", severity: "high", status: "ENUMERATED", resource: "intune://devices", title: `${list.length} Intune managed devices`, details: `OS: ${Object.entries(osCounts).map(([k, v]) => `${k}(${v})`).join(", ")}`, remediation: "Review Intune RBAC and device compliance policies" })
  return { output: output.join("\n"), findings }
}

export async function graphUserEnum(args: string[], timeout: number): Promise<HookResult> {
  const search = argVal(args, "--search")
  const role = argVal(args, "--role")
  const findings: Finding[] = []
  const output: string[] = ["[*] Microsoft Graph user enumeration...\n"]
  const filter = search ? `&$search="displayName:${search}"` : ""
  const headers = search ? `--headers "ConsistencyLevel=eventual"` : ""
  const cmdArgs = ["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/users?$top=100&$select=displayName,userPrincipalName,mail,jobTitle,department,accountEnabled,userType,createdDateTime${filter}`, "-o", "json"]
  if (search) cmdArgs.push("--headers", "ConsistencyLevel=eventual")
  const users = await run("az", cmdArgs, timeout)
  if (users.exitCode !== 0) return { output: `[-] Cannot list users: ${users.stderr.slice(0, 200)}`, findings }
  const list = tryJson(users.stdout)?.value || []
  output.push(`[+] Users: ${list.length}`)
  const admins: string[] = []
  const guests: string[] = []
  for (const u of list) {
    const type = u.userType === "Guest" ? " [GUEST]" : ""
    output.push(`    ${u.displayName} — ${u.userPrincipalName}${type}`)
    output.push(`      Title: ${u.jobTitle || "N/A"}, Dept: ${u.department || "N/A"}, Enabled: ${u.accountEnabled}`)
    if (u.userType === "Guest") guests.push(u.userPrincipalName)
  }
  if (guests.length > 0) findings.push({ checkId: "AZ-GRAPH-USER-001", provider: "azure", severity: "medium", status: "INFO", resource: "graph://users/guests", title: `${guests.length} guest users found`, details: "Guest users from external organizations", remediation: "Review guest access and enable access reviews" })
  const dirRoles = await run("az", ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/directoryRoles?$select=displayName,id", "-o", "json"], timeout)
  if (dirRoles.exitCode === 0) {
    const roles = tryJson(dirRoles.stdout)?.value || []
    output.push(`\n[+] Active directory roles: ${roles.length}`)
    for (const r of roles) {
      output.push(`    ${r.displayName}`)
      const members = await run("az", ["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/directoryRoles/${r.id}/members?$select=displayName,userPrincipalName`, "-o", "json"], timeout)
      if (members.exitCode === 0) {
        const mList = tryJson(members.stdout)?.value || []
        for (const m of mList) output.push(`      ${m.displayName} (${m.userPrincipalName})`)
      }
    }
  }
  findings.push({ checkId: "AZ-GRAPH-USER-002", provider: "azure", severity: "high", status: "ENUMERATED", resource: "graph://users", title: `${list.length} users enumerated via Graph`, details: "Full user directory with roles and metadata", remediation: "Restrict User.Read.All and Directory.Read.All permissions" })
  return { output: output.join("\n"), findings }
}

export async function appRegistrationEnum(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure AD app registration enumeration...\n"]
  const apps = await az(["ad", "app", "list", "--all", "--query", "[].{name:displayName,appId:appId,signIn:signInAudience,creds:passwordCredentials[].endDateTime,keys:keyCredentials[].endDateTime}"], undefined, timeout)
  if (apps.exitCode !== 0) return { output: `[-] Cannot list apps: ${apps.stderr.slice(0, 200)}`, findings }
  const list = tryJson(apps.stdout) || []
  output.push(`[+] App registrations: ${list.length}`)
  const expiredCreds: string[] = []
  const multiTenant: string[] = []
  for (const a of list) {
    const credCount = (a.creds?.length || 0) + (a.keys?.length || 0)
    output.push(`    ${a.name} (${a.appId}) — audience: ${a.signIn}, credentials: ${credCount}`)
    if (a.signIn === "AzureADMultipleOrgs" || a.signIn === "AzureADandPersonalMicrosoftAccount") multiTenant.push(a.name)
  }
  if (multiTenant.length > 0) {
    output.push(`\n[!] Multi-tenant apps: ${multiTenant.length}`)
    findings.push({ checkId: "AZ-APPREG-001", provider: "azure", severity: "high", status: "FAIL", resource: "azure-ad://apps/multi-tenant", title: `${multiTenant.length} multi-tenant app(s)`, details: `${multiTenant.join(", ")}. Can authenticate users from any tenant.`, remediation: "Review if multi-tenant access is required" })
  }
  findings.push({ checkId: "AZ-APPREG-002", provider: "azure", severity: "medium", status: "ENUMERATED", resource: "azure-ad://apps", title: `${list.length} app registrations enumerated`, details: "App registrations with credentials may have privileged access", remediation: "Audit app permissions and credential expiry" })
  return { output: output.join("\n"), findings }
}

export async function logicAppConnectorEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Logic App connector enumeration...\n"]
  const logicApps = await az(["logic", "workflow", "list", "--query", "[].{name:name,rg:resourceGroup,state:state,sku:sku.name,endpoint:accessEndpoint}"], sub, timeout)
  if (logicApps.exitCode !== 0) return { output: "[-] Cannot list Logic Apps", findings }
  const list = tryJson(logicApps.stdout) || []
  output.push(`[+] Logic Apps: ${list.length}`)
  for (const la of list) {
    output.push(`    ${la.name} (${la.rg}) — state: ${la.state}`)
    if (la.endpoint) output.push(`      Endpoint: ${la.endpoint}`)
    const connections = await az(["resource", "list", "--resource-type", "Microsoft.Web/connections", "--resource-group", la.rg, "--query", "[].{name:name,type:kind}"], sub, timeout)
    if (connections.exitCode === 0) {
      const connList = tryJson(connections.stdout) || []
      if (connList.length > 0) {
        output.push(`      API connections: ${connList.length}`)
        for (const c of connList) output.push(`        ${c.name} (${c.type || "managed"})`)
      }
    }
  }
  const enabled = list.filter((l: Record<string, string>) => l.state === "Enabled")
  if (enabled.length > 0) findings.push({ checkId: "AZ-LOGICCONN-001", provider: "azure", severity: "medium", status: "INFO", resource: "logic-app://connectors", title: `${enabled.length} active Logic Apps with connectors`, details: "Connectors may have stored credentials for O365, SQL, SFTP, etc.", remediation: "Audit Logic App connectors for excessive permissions" })
  return { output: output.join("\n"), findings }
}

export async function automationRunbookEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Automation runbook enumeration...\n"]
  const accounts = await az(["automation", "account", "list", "--query", "[].{name:name,rg:resourceGroup,state:state,identity:identity.type}"], sub, timeout)
  if (accounts.exitCode !== 0) return { output: "[-] Cannot list Automation accounts", findings }
  const list = tryJson(accounts.stdout) || []
  output.push(`[+] Automation accounts: ${list.length}`)
  for (const a of list) {
    output.push(`    ${a.name} (${a.rg}) — state: ${a.state}, identity: ${a.identity || "none"}`)
    const runbooks = await az(["automation", "runbook", "list", "--automation-account-name", a.name, "--resource-group", a.rg, "--query", "[].{name:name,type:runbookType,state:state,lastModified:lastModifiedTime}"], sub, timeout)
    if (runbooks.exitCode === 0) {
      const rbList = tryJson(runbooks.stdout) || []
      output.push(`      Runbooks: ${rbList.length}`)
      for (const rb of rbList) output.push(`        ${rb.name} (${rb.type}) — ${rb.state}`)
    }
    const variables = await az(["automation", "variable", "list", "--automation-account-name", a.name, "--resource-group", a.rg, "--query", "[].{name:name,encrypted:isEncrypted}"], sub, timeout)
    if (variables.exitCode === 0) {
      const varList = tryJson(variables.stdout) || []
      if (varList.length > 0) {
        output.push(`      Variables: ${varList.length}`)
        for (const v of varList) output.push(`        ${v.name} (encrypted: ${v.encrypted})`)
      }
    }
    if (a.identity) findings.push({ checkId: "AZ-AUTORUN-001", provider: "azure", severity: "high", status: "INFO", resource: `automation://${a.name}`, title: `Automation account with managed identity: ${a.name}`, details: `Identity: ${a.identity}. Runbooks run with this identity's permissions.`, remediation: "Review managed identity role assignments" })
  }
  return { output: output.join("\n"), findings }
}

export async function synapseEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Synapse Analytics enumeration...\n"]
  const workspaces = await az(["synapse", "workspace", "list", "--query", "[].{name:name,rg:resourceGroup,endpoint:connectivityEndpoints.web,sqlAdmin:sqlAdministratorLogin,managedRg:managedResourceGroupName}"], sub, timeout)
  if (workspaces.exitCode !== 0) return { output: "[-] Cannot list Synapse workspaces (extension may not be installed)", findings }
  const list = tryJson(workspaces.stdout) || []
  output.push(`[+] Synapse workspaces: ${list.length}`)
  for (const w of list) {
    output.push(`    ${w.name} (${w.rg})`)
    output.push(`      SQL admin: ${w.sqlAdmin || "N/A"}`)
    output.push(`      Web endpoint: ${w.endpoint || "N/A"}`)
    const pools = await az(["synapse", "sql", "pool", "list", "--workspace-name", w.name, "--resource-group", w.rg, "--query", "[].{name:name,sku:sku.name,status:status}"], sub, timeout)
    if (pools.exitCode === 0) {
      const poolList = tryJson(pools.stdout) || []
      output.push(`      SQL pools: ${poolList.length}`)
      for (const p of poolList) output.push(`        ${p.name} (${p.sku}) — ${p.status}`)
    }
    findings.push({ checkId: "AZ-SYNAPSE-001", provider: "azure", severity: "high", status: "INFO", resource: `synapse://${w.name}`, title: `Synapse workspace: ${w.name}`, details: `SQL admin: ${w.sqlAdmin}. Contains data pipelines, notebooks, SQL pools.`, remediation: "Review Synapse RBAC and network access" })
  }
  return { output: output.join("\n"), findings }
}

export async function purviewEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Microsoft Purview / Data Governance enumeration...\n"]
  const accounts = await az(["purview", "account", "list", "--query", "[].{name:name,rg:resourceGroup,endpoint:endpoints.catalog,identity:identity.type}"], sub, timeout)
  if (accounts.exitCode !== 0) {
    const resources = await az(["resource", "list", "--resource-type", "Microsoft.Purview/accounts", "--query", "[].{name:name,rg:resourceGroup}"], sub, timeout)
    if (resources.exitCode === 0) {
      const list = tryJson(resources.stdout) || []
      output.push(`[+] Purview accounts: ${list.length}`)
      for (const p of list) output.push(`    ${p.name} — rg: ${p.rg}`)
    }
    return { output: output.join("\n"), findings }
  }
  const list = tryJson(accounts.stdout) || []
  output.push(`[+] Purview accounts: ${list.length}`)
  for (const p of list) {
    output.push(`    ${p.name} (${p.rg})`)
    if (p.endpoint) output.push(`      Catalog endpoint: ${p.endpoint}`)
    output.push(`      Identity: ${p.identity || "none"}`)
    findings.push({ checkId: "AZ-PURVIEW-001", provider: "azure", severity: "medium", status: "INFO", resource: `purview://${p.name}`, title: `Purview account: ${p.name}`, details: "Data catalog contains metadata about all sensitive data sources. High recon value.", remediation: "Restrict Purview access, review data source connections" })
  }
  return { output: output.join("\n"), findings }
}

export async function subdomainTakeover(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure subdomain takeover check...\n"]
  const cnames = await az(["network", "dns", "record-set", "cname", "list", "--zone-name", argVal(args, "--zone") || "", "--resource-group", argVal(args, "--resource-group") || ""], sub, timeout)
  if (cnames.exitCode !== 0) {
    const zones = await az(["network", "dns", "zone", "list", "--query", "[].{name:name,rg:resourceGroup,records:numberOfRecordSets}"], sub, timeout)
    if (zones.exitCode === 0) {
      const zoneList = tryJson(zones.stdout) || []
      output.push(`[+] DNS zones: ${zoneList.length}`)
      for (const z of zoneList) {
        output.push(`    ${z.name} (${z.rg}) — ${z.records} record sets`)
        const records = await az(["network", "dns", "record-set", "cname", "list", "--zone-name", z.name, "--resource-group", z.rg], sub, timeout)
        if (records.exitCode === 0) {
          const cnameList = tryJson(records.stdout) || []
          const azureTargets = cnameList.filter((r: Record<string, Record<string, string>>) => {
            const target = r.cnameRecord?.cname || r.CNAMERecord?.cname || ""
            return target.includes(".azurewebsites.net") || target.includes(".cloudapp.azure.com") || target.includes(".trafficmanager.net") || target.includes(".blob.core.windows.net") || target.includes(".azureedge.net") || target.includes(".azure-api.net")
          })
          if (azureTargets.length > 0) {
            output.push(`      [!] CNAME records pointing to Azure services: ${azureTargets.length}`)
            for (const r of azureTargets) {
              const target = r.cnameRecord?.cname || r.CNAMERecord?.cname || ""
              output.push(`        ${r.name}.${z.name} → ${target}`)
              findings.push({ checkId: "AZ-TAKEOVER-001", provider: "azure", severity: "high", status: "FAIL", resource: `dns://${z.name}/${r.name}`, title: `Potential subdomain takeover: ${r.name}.${z.name}`, details: `CNAME → ${target}. If Azure resource is deleted, domain can be claimed.`, remediation: "Verify Azure resource exists, remove stale CNAME records" })
            }
          }
        }
      }
    }
    return { output: output.join("\n"), findings }
  }
  return { output: output.join("\n"), findings }
}

export async function stalePermissionAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure stale permission audit...\n"]
  const assignments = await az(["role", "assignment", "list", "--all", "--query", "[].{principal:principalName,principalType:principalType,role:roleDefinitionName,scope:scope}"], sub, timeout)
  if (assignments.exitCode !== 0) return { output: "[-] Cannot list role assignments", findings }
  const list = tryJson(assignments.stdout) || []
  output.push(`[+] Role assignments: ${list.length}`)
  const byType: Record<string, number> = {}
  const orphaned: string[] = []
  for (const a of list) {
    const type = a.principalType || "Unknown"
    byType[type] = (byType[type] || 0) + 1
    if (!a.principal || a.principal === "") {
      orphaned.push(`${a.role} at ${a.scope}`)
    }
  }
  output.push(`    By type: ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(", ")}`)
  if (orphaned.length > 0) {
    output.push(`\n[!] Orphaned assignments (deleted principals): ${orphaned.length}`)
    for (const o of orphaned) output.push(`    ${o}`)
    findings.push({ checkId: "AZ-STALE-001", provider: "azure", severity: "high", status: "FAIL", resource: "subscription://role-assignments/orphaned", title: `${orphaned.length} orphaned role assignments`, details: "Assignments for deleted users/SPs — can be claimed by recreating the principal", remediation: "Remove orphaned role assignments" })
  }
  const ownerAssignments = list.filter((a: Record<string, string>) => a.role === "Owner" || a.role === "Contributor")
  if (ownerAssignments.length > 0) {
    output.push(`\n[+] High-privilege assignments: ${ownerAssignments.length}`)
    for (const a of ownerAssignments.slice(0, 20)) output.push(`    ${a.principal || "(orphaned)"} — ${a.role} at ${a.scope?.substring(0, 60)}`)
    findings.push({ checkId: "AZ-STALE-002", provider: "azure", severity: "high", status: "INFO", resource: "subscription://role-assignments/high-priv", title: `${ownerAssignments.length} Owner/Contributor assignments`, details: "Review for excessive permissions and unused accounts", remediation: "Implement least-privilege, use PIM for just-in-time access" })
  }
  return { output: output.join("\n"), findings }
}

export async function publicExposureScan(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure public exposure scan...\n"]
  const publicIps = await az(["network", "public-ip", "list", "--query", "[].{name:name,rg:resourceGroup,ip:ipAddress,allocation:publicIpAllocationMethod,associated:ipConfiguration.id}"], sub, timeout)
  if (publicIps.exitCode === 0) {
    const ipList = tryJson(publicIps.stdout) || []
    const assigned = ipList.filter((ip: Record<string, string>) => ip.ip)
    const unassociated = ipList.filter((ip: Record<string, string | undefined>) => !ip.associated)
    output.push(`[+] Public IPs: ${ipList.length} (${assigned.length} with address, ${unassociated.length} unassociated)`)
    for (const ip of assigned) output.push(`    ${ip.name} — ${ip.ip} (${ip.allocation}) rg: ${ip.rg}`)
    if (unassociated.length > 0) {
      output.push(`\n[!] Unassociated public IPs (cost + takeover risk):`)
      for (const ip of unassociated) output.push(`    ${ip.name} — ${ip.ip || "no address"} rg: ${ip.rg}`)
      findings.push({ checkId: "AZ-PUBEXP-001", provider: "azure", severity: "medium", status: "FAIL", resource: "subscription://public-ips/unassociated", title: `${unassociated.length} unassociated public IP(s)`, details: "Unused public IPs incur cost and may be reclaimable", remediation: "Delete unassociated public IPs" })
    }
  }
  const storageAccts = await az(["storage", "account", "list", "--query", "[?networkRuleSet.defaultAction=='Allow'].{name:name,rg:resourceGroup,https:supportsHttpsTrafficOnly}"], sub, timeout)
  if (storageAccts.exitCode === 0) {
    const openStorage = tryJson(storageAccts.stdout) || []
    if (openStorage.length > 0) {
      output.push(`\n[!] Storage accounts with public network access: ${openStorage.length}`)
      for (const s of openStorage) output.push(`    ${s.name} (${s.rg}) https-only: ${s.https}`)
      findings.push({ checkId: "AZ-PUBEXP-002", provider: "azure", severity: "high", status: "FAIL", resource: "subscription://storage/public", title: `${openStorage.length} storage account(s) publicly accessible`, details: "Default network rule is Allow — accessible from any network", remediation: "Set default network rule to Deny, add specific network rules" })
    }
  }
  const sqlServers = await az(["sql", "server", "list", "--query", "[].{name:name,rg:resourceGroup,admin:administratorLogin}"], sub, timeout)
  if (sqlServers.exitCode === 0) {
    const servers = tryJson(sqlServers.stdout) || []
    for (const s of servers) {
      const fwRules = await az(["sql", "server", "firewall-rule", "list", "--server", s.name, "--resource-group", s.rg, "--query", "[].{name:name,start:startIpAddress,end:endIpAddress}"], sub, timeout)
      if (fwRules.exitCode === 0) {
        const rules = tryJson(fwRules.stdout) || []
        const allowAll = rules.filter((r: Record<string, string>) => r.start === "0.0.0.0" && r.end === "255.255.255.255")
        if (allowAll.length > 0) {
          output.push(`\n[!] SQL server ${s.name} allows all IPs (0.0.0.0 - 255.255.255.255)`)
          findings.push({ checkId: "AZ-PUBEXP-003", provider: "azure", severity: "critical", status: "FAIL", resource: `sql://${s.name}`, title: `SQL server publicly accessible: ${s.name}`, details: "Firewall allows all IP addresses", remediation: "Restrict SQL Server firewall rules to specific IPs" })
        }
      }
    }
  }
  return { output: output.join("\n"), findings }
}

export async function eventGridEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Event Grid enumeration...\n"]
  const topics = await az(["eventgrid", "topic", "list", "--query", "[].{name:name,rg:resourceGroup,endpoint:endpoint,status:provisioningState}"], sub, timeout)
  if (topics.exitCode === 0) {
    const topicList = tryJson(topics.stdout) || []
    output.push(`[+] Custom topics: ${topicList.length}`)
    for (const t of topicList) output.push(`    ${t.name} (${t.rg}) — ${t.endpoint}`)
  }
  const systemTopics = await az(["eventgrid", "system-topic", "list", "--query", "[].{name:name,rg:resourceGroup,type:topicType,source:source}"], sub, timeout)
  if (systemTopics.exitCode === 0) {
    const stList = tryJson(systemTopics.stdout) || []
    output.push(`\n[+] System topics: ${stList.length}`)
    for (const st of stList) output.push(`    ${st.name} (${st.type}) — source: ${st.source}`)
  }
  const subs = await az(["eventgrid", "event-subscription", "list", "--location", "global", "--query", "[].{name:name,endpoint:destination.endpointUrl,type:destination.endpointType}"], sub, timeout)
  if (subs.exitCode === 0) {
    const subList = tryJson(subs.stdout) || []
    output.push(`\n[+] Global event subscriptions: ${subList.length}`)
    for (const s of subList) {
      output.push(`    ${s.name} → ${s.type || "unknown"}: ${s.endpoint || "hidden"}`)
      if (s.type === "WebHook") findings.push({ checkId: "AZ-EVGRID-001", provider: "azure", severity: "medium", status: "INFO", resource: `eventgrid://subscription/${s.name}`, title: `Event Grid webhook subscription: ${s.name}`, details: `External endpoint receives Azure events — potential data leak or persistence`, remediation: "Review Event Grid subscriptions and webhook endpoints" })
    }
  }
  return { output: output.join("\n"), findings }
}

export async function serviceFabricEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Service Fabric enumeration...\n"]
  const clusters = await az(["sf", "cluster", "list", "--query", "[].{name:name,rg:resourceGroup,state:clusterState,endpoint:managementEndpoint,nodes:nodeTypes[0].vmInstanceCount}"], sub, timeout)
  if (clusters.exitCode !== 0) {
    const resources = await az(["resource", "list", "--resource-type", "Microsoft.ServiceFabric/clusters", "--query", "[].{name:name,rg:resourceGroup}"], sub, timeout)
    if (resources.exitCode === 0) {
      const list = tryJson(resources.stdout) || []
      output.push(`[+] Service Fabric clusters: ${list.length}`)
      for (const c of list) output.push(`    ${c.name} — rg: ${c.rg}`)
    }
    return { output: output.join("\n"), findings }
  }
  const list = tryJson(clusters.stdout) || []
  output.push(`[+] Service Fabric clusters: ${list.length}`)
  for (const c of list) {
    output.push(`    ${c.name} (${c.rg}) — state: ${c.state}, nodes: ${c.nodes || "?"}`)
    if (c.endpoint) output.push(`      Management: ${c.endpoint}`)
    findings.push({ checkId: "AZ-SF-001", provider: "azure", severity: "medium", status: "INFO", resource: `service-fabric://${c.name}`, title: `Service Fabric cluster: ${c.name}`, details: `State: ${c.state}, nodes: ${c.nodes || "?"}. Microservices platform — may host internal services.`, remediation: "Review cluster security settings and certificate rotation" })
  }
  return { output: output.join("\n"), findings }
}

export async function batchAccountEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Batch account enumeration...\n"]
  const accounts = await az(["batch", "account", "list", "--query", "[].{name:name,rg:resourceGroup,location:location,endpoint:accountEndpoint,pool:poolAllocationMode}"], sub, timeout)
  if (accounts.exitCode !== 0) return { output: "[-] Cannot list Batch accounts", findings }
  const list = tryJson(accounts.stdout) || []
  output.push(`[+] Batch accounts: ${list.length}`)
  for (const a of list) {
    output.push(`    ${a.name} (${a.rg}) — ${a.location}, pool: ${a.pool}`)
    if (a.endpoint) output.push(`      Endpoint: ${a.endpoint}`)
    findings.push({ checkId: "AZ-BATCH-001", provider: "azure", severity: "medium", status: "INFO", resource: `batch://${a.name}`, title: `Batch account: ${a.name}`, details: `Pool allocation: ${a.pool}. Can run arbitrary code on compute nodes.`, remediation: "Review Batch account access keys and pool configurations" })
  }
  return { output: output.join("\n"), findings }
}

export async function cognitiveServicesEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Cognitive Services / AI Services enumeration...\n"]
  const services = await az(["cognitiveservices", "account", "list", "--query", "[].{name:name,rg:resourceGroup,kind:kind,sku:sku.name,endpoint:properties.endpoint,publicAccess:properties.publicNetworkAccess}"], sub, timeout)
  if (services.exitCode !== 0) return { output: "[-] Cannot list Cognitive Services", findings }
  const list = tryJson(services.stdout) || []
  output.push(`[+] Cognitive Services accounts: ${list.length}`)
  for (const s of list) {
    output.push(`    ${s.name} (${s.kind}, ${s.sku}) — public: ${s.publicAccess || "?"}`)
    if (s.endpoint) output.push(`      Endpoint: ${s.endpoint}`)
    const keys = await az(["cognitiveservices", "account", "keys", "list", "--name", s.name, "--resource-group", s.rg], sub, timeout)
    if (keys.exitCode === 0) {
      const k = tryJson(keys.stdout)
      if (k?.key1) {
        output.push(`      Key1: ${String(k.key1).substring(0, 15)}...`)
        findings.push({ checkId: "AZ-COGNITIVE-001", provider: "azure", severity: "high", status: "EXTRACTED", resource: `cognitive://${s.name}`, title: `Cognitive Services key extracted: ${s.name} (${s.kind})`, details: `API keys accessible. Can use ${s.kind} service — data, models, and billing.`, remediation: "Rotate keys, use managed identity for access" })
      }
    }
  }
  return { output: output.join("\n"), findings }
}

export async function signalrEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure SignalR / Web PubSub enumeration...\n"]
  const signalr = await az(["signalr", "list", "--query", "[].{name:name,rg:resourceGroup,sku:sku.name,hostName:hostName,publicAccess:publicNetworkAccess}"], sub, timeout)
  if (signalr.exitCode === 0) {
    const list = tryJson(signalr.stdout) || []
    output.push(`[+] SignalR services: ${list.length}`)
    for (const s of list) {
      output.push(`    ${s.name} (${s.sku}) — host: ${s.hostName || "N/A"}, public: ${s.publicAccess || "?"}`)
      const keys = await az(["signalr", "key", "list", "--name", s.name, "--resource-group", s.rg], sub, timeout)
      if (keys.exitCode === 0) {
        const k = tryJson(keys.stdout)
        if (k?.primaryConnectionString) {
          output.push(`      Connection: ${String(k.primaryConnectionString).substring(0, 60)}...`)
          findings.push({ checkId: "AZ-SIGNALR-001", provider: "azure", severity: "high", status: "EXTRACTED", resource: `signalr://${s.name}`, title: `SignalR connection string extracted: ${s.name}`, details: "Full access to real-time messaging service", remediation: "Rotate SignalR keys" })
        }
      }
    }
  }
  const pubsub = await az(["webpubsub", "list", "--query", "[].{name:name,rg:resourceGroup,sku:sku.name}"], sub, timeout)
  if (pubsub.exitCode === 0) {
    const list = tryJson(pubsub.stdout) || []
    if (list.length > 0) {
      output.push(`\n[+] Web PubSub services: ${list.length}`)
      for (const s of list) output.push(`    ${s.name} (${s.sku}) — rg: ${s.rg}`)
    }
  }
  return { output: output.join("\n"), findings }
}

export async function iotHubEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure IoT Hub enumeration...\n"]
  const hubs = await az(["iot", "hub", "list", "--query", "[].{name:name,rg:resourceGroup,sku:sku.name,state:state,hostname:properties.hostName,devices:properties.deviceCount}"], sub, timeout)
  if (hubs.exitCode !== 0) {
    const resources = await az(["resource", "list", "--resource-type", "Microsoft.Devices/IotHubs", "--query", "[].{name:name,rg:resourceGroup}"], sub, timeout)
    if (resources.exitCode === 0) {
      const list = tryJson(resources.stdout) || []
      output.push(`[+] IoT Hubs: ${list.length}`)
      for (const h of list) output.push(`    ${h.name} — rg: ${h.rg}`)
    }
    return { output: output.join("\n"), findings }
  }
  const list = tryJson(hubs.stdout) || []
  output.push(`[+] IoT Hubs: ${list.length}`)
  for (const h of list) {
    output.push(`    ${h.name} (${h.sku}) — state: ${h.state}, devices: ${h.devices || "?"}`)
    if (h.hostname) output.push(`      Hostname: ${h.hostname}`)
    findings.push({ checkId: "AZ-IOT-001", provider: "azure", severity: "high", status: "INFO", resource: `iothub://${h.name}`, title: `IoT Hub: ${h.name} (${h.devices || "?"} devices)`, details: "IoT Hub manages device connections — compromise enables device control and data interception", remediation: "Review IoT Hub shared access policies and device identities" })
  }
  return { output: output.join("\n"), findings }
}

export async function managedEnvEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Container Apps managed environment enumeration...\n"]
  const envs = await az(["containerapp", "env", "list", "--query", "[].{name:name,rg:resourceGroup,location:location,vnet:vnetConfiguration.infrastructureSubnetId}"], sub, timeout)
  if (envs.exitCode !== 0) return { output: "[-] Cannot list Container App environments", findings }
  const list = tryJson(envs.stdout) || []
  output.push(`[+] Container App environments: ${list.length}`)
  for (const e of list) {
    output.push(`    ${e.name} (${e.rg}) — ${e.location}`)
    if (e.vnet) output.push(`      VNet: ${e.vnet}`)
    const apps = await az(["containerapp", "list", "--environment", e.name, "--resource-group", e.rg, "--query", "[].{name:name,image:properties.template.containers[0].image,ingress:properties.configuration.ingress.fqdn}"], sub, timeout)
    if (apps.exitCode === 0) {
      const appList = tryJson(apps.stdout) || []
      output.push(`      Apps: ${appList.length}`)
      for (const a of appList) {
        output.push(`        ${a.name} — image: ${a.image || "?"}`)
        if (a.ingress) output.push(`          FQDN: ${a.ingress}`)
      }
    }
  }
  if (list.length > 0) findings.push({ checkId: "AZ-CAPP-001", provider: "azure", severity: "medium", status: "INFO", resource: "container-apps://environments", title: `${list.length} Container App environment(s)`, details: "Container Apps may run with managed identity and access other Azure resources", remediation: "Review Container App identity bindings and secrets" })
  return { output: output.join("\n"), findings }
}

export async function staticWebAppEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Static Web App enumeration...\n"]
  const apps = await az(["staticwebapp", "list", "--query", "[].{name:name,rg:resourceGroup,url:defaultHostname,sku:sku.name,branch:branch,repo:repositoryUrl}"], sub, timeout)
  if (apps.exitCode !== 0) return { output: "[-] Cannot list Static Web Apps", findings }
  const list = tryJson(apps.stdout) || []
  output.push(`[+] Static Web Apps: ${list.length}`)
  for (const a of list) {
    output.push(`    ${a.name} (${a.sku || "Free"}) — ${a.url}`)
    if (a.repo) output.push(`      Repo: ${a.repo} (branch: ${a.branch || "main"})`)
    const customs = await az(["staticwebapp", "hostname", "list", "--name", a.name, "--resource-group", a.rg, "--query", "[].{domain:domainName,status:status}"], sub, timeout)
    if (customs.exitCode === 0) {
      const customList = tryJson(customs.stdout) || []
      if (customList.length > 0) {
        output.push(`      Custom domains: ${customList.length}`)
        for (const c of customList) output.push(`        ${c.domain} (${c.status})`)
      }
    }
  }
  if (list.length > 0) findings.push({ checkId: "AZ-SWA-001", provider: "azure", severity: "low", status: "INFO", resource: "static-web-app://apps", title: `${list.length} Static Web App(s)`, details: "Check for linked API backends and authentication settings", remediation: "Review Static Web App auth config and API routes" })
  return { output: output.join("\n"), findings }
}

export async function mapsSearchEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Maps Enumeration\n"]

  const r = await az(["maps", "account", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list Maps accounts: ${r.stderr.trim()}`, findings }
  const accounts = tryJson(r.stdout) || []
  output.push(`[+] Maps accounts: ${accounts.length}\n`)

  for (const acct of accounts) {
    output.push(`[+] ${acct.name} — ${acct.location}, RG: ${acct.resourceGroup}`)
    output.push(`    SKU: ${acct.sku?.name || "unknown"}`)
    output.push(`    Kind: ${acct.kind || "Gen2"}`)

    const keys = await az(["maps", "account", "keys", "list", "--name", acct.name, "--resource-group", acct.resourceGroup], sub, timeout)
    const keyData = tryJson(keys.stdout)
    if (keyData) {
      output.push(`    Primary key: ${keyData.primaryKey?.substring(0, 8)}...`)
      findings.push({
        checkId: "AZ-MAPS-001",
        provider: "azure",
        severity: "low",
        status: "INFO",
        resource: `maps://${acct.name}`,
        title: `Maps account keys accessible: ${acct.name}`,
        details: `Shared keys provide access to Maps REST APIs — potential cost abuse`,
        remediation: "Use Entra ID authentication and disable shared key access",
      })
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function sentinelEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const workspace = argVal(args, "--workspace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Microsoft Sentinel Enumeration\n"]

  const workspaces = await az(["monitor", "log-analytics", "workspace", "list"], sub, timeout)
  const wsList = tryJson(workspaces.stdout) || []
  output.push(`[+] Log Analytics workspaces: ${wsList.length}\n`)

  for (const ws of wsList) {
    if (workspace && ws.name !== workspace) continue
    if (rg && ws.resourceGroup !== rg) continue

    output.push(`[+] Workspace: ${ws.name} — ${ws.location}`)
    output.push(`    SKU: ${ws.sku?.name}, Retention: ${ws.retentionInDays} days`)

    const rules = await run("az", ["rest", "--method", "GET", "--url", `https://management.azure.com${ws.id}/providers/Microsoft.SecurityInsights/alertRules?api-version=2023-11-01`, "-o", "json"], timeout)
    const ruleList = (tryJson(rules.stdout) || {}).value || []
    output.push(`    Analytics rules: ${ruleList.length}`)
    const enabled = ruleList.filter((r: Record<string, Record<string, boolean>>) => r.properties?.enabled)
    const disabled = ruleList.filter((r: Record<string, Record<string, boolean>>) => !r.properties?.enabled)
    output.push(`      Enabled: ${enabled.length}, Disabled: ${disabled.length}`)

    if (disabled.length > 0) {
      findings.push({
        checkId: "AZ-SENTINEL-ENUM-001",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `sentinel://${ws.name}`,
        title: `${disabled.length} Sentinel analytics rules disabled`,
        details: `Disabled rules: ${disabled.slice(0, 5).map((r: Record<string, Record<string, string>>) => r.properties?.displayName).join(", ")}`,
        remediation: "Review and enable disabled analytics rules or remove if not needed",
      })
    }

    const connectors = await run("az", ["rest", "--method", "GET", "--url", `https://management.azure.com${ws.id}/providers/Microsoft.SecurityInsights/dataConnectors?api-version=2023-11-01`, "-o", "json"], timeout)
    const connList = (tryJson(connectors.stdout) || {}).value || []
    output.push(`    Data connectors: ${connList.length}`)
    for (const c of connList) {
      output.push(`      ${c.kind || c.properties?.connectorDefinitionName || "unknown"} — ${c.name}`)
    }

    const incidents = await run("az", ["rest", "--method", "GET", "--url", `https://management.azure.com${ws.id}/providers/Microsoft.SecurityInsights/incidents?api-version=2023-11-01&$top=10&$orderby=properties/createdTimeUtc desc`, "-o", "json"], timeout)
    const incidentList = (tryJson(incidents.stdout) || {}).value || []
    output.push(`    Recent incidents: ${incidentList.length}`)
    for (const inc of incidentList) {
      output.push(`      [${inc.properties?.severity}] ${inc.properties?.title} — ${inc.properties?.status} (${inc.properties?.createdTimeUtc})`)
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function vpnGatewayEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] VPN Gateway Enumeration\n"]

  const gateways = await az(["network", "vnet-gateway", "list"], sub, timeout)
  if (gateways.exitCode !== 0) return { output: `[-] Failed to list VPN gateways: ${gateways.stderr.trim()}`, findings }
  const gwList = tryJson(gateways.stdout) || []
  output.push(`[+] VPN gateways: ${gwList.length}\n`)

  for (const gw of gwList) {
    output.push(`[+] ${gw.name} — ${gw.location}, RG: ${gw.resourceGroup}`)
    output.push(`    Type: ${gw.gatewayType}, VPN type: ${gw.vpnType}`)
    output.push(`    SKU: ${gw.sku?.name} (${gw.sku?.tier})`)
    output.push(`    Active-active: ${gw.activeActive ? "Yes" : "No"}`)
    output.push(`    BGP: ${gw.enableBgp ? `Yes (ASN: ${gw.bgpSettings?.asn})` : "No"}`)
    const publicIps = (gw.ipConfigurations || []).map((ip: Record<string, Record<string, string>>) => ip.publicIpAddress?.id?.split("/").pop()).filter(Boolean)
    output.push(`    Public IPs: ${publicIps.join(", ") || "none"}`)
  }

  const connections = await az(["network", "vpn-connection", "list"], sub, timeout)
  const connList = tryJson(connections.stdout) || []
  output.push(`\n[+] VPN connections: ${connList.length}`)

  for (const conn of connList) {
    output.push(`  ${conn.name} — type: ${conn.connectionType}, status: ${conn.connectionStatus || "unknown"}`)
    output.push(`    Protocol: ${conn.connectionProtocol || "IKEv2"}`)
    if (conn.sharedKey) {
      output.push(`    [!] Shared key accessible`)
      findings.push({
        checkId: "AZ-VPN-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `vpn://${conn.name}`,
        title: `VPN connection shared key accessible: ${conn.name}`,
        details: `VPN shared key is readable — can be used to establish unauthorized tunnels`,
        remediation: "Rotate VPN shared key and restrict read access via RBAC",
      })
    }
    if (conn.connectionProtocol === "IKEv1") {
      findings.push({
        checkId: "AZ-VPN-002",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `vpn://${conn.name}`,
        title: `VPN connection uses IKEv1: ${conn.name}`,
        details: "IKEv1 has known vulnerabilities — IKEv2 is recommended",
        remediation: "Upgrade connection protocol to IKEv2",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function expressRouteEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] ExpressRoute Enumeration\n"]

  const circuits = await az(["network", "express-route", "list"], sub, timeout)
  if (circuits.exitCode !== 0) return { output: `[-] Failed to list ExpressRoute: ${circuits.stderr.trim()}`, findings }
  const circuitList = tryJson(circuits.stdout) || []
  output.push(`[+] ExpressRoute circuits: ${circuitList.length}\n`)

  for (const circuit of circuitList) {
    output.push(`[+] ${circuit.name} — ${circuit.location}`)
    output.push(`    Provider: ${circuit.serviceProviderProperties?.serviceProviderName || "unknown"}`)
    output.push(`    Bandwidth: ${circuit.serviceProviderProperties?.bandwidthInMbps || "unknown"} Mbps`)
    output.push(`    SKU: ${circuit.sku?.name} (${circuit.sku?.tier}, ${circuit.sku?.family})`)
    output.push(`    Circuit state: ${circuit.circuitProvisioningState || "unknown"}`)
    output.push(`    Service key: ${circuit.serviceKey ? circuit.serviceKey.substring(0, 8) + "..." : "none"}`)

    if (circuit.serviceKey) {
      findings.push({
        checkId: "AZ-ER-001",
        provider: "azure",
        severity: "high",
        status: "INFO",
        resource: `expressroute://${circuit.name}`,
        title: `ExpressRoute service key accessible: ${circuit.name}`,
        details: `Service key provides circuit identification — should be protected`,
        remediation: "Restrict access to the ExpressRoute circuit resource",
      })
    }

    const peerings = await az(["network", "express-route", "peering", "list", "--circuit-name", circuit.name, "--resource-group", circuit.resourceGroup], sub, timeout)
    const peerList = tryJson(peerings.stdout) || []
    output.push(`    Peerings: ${peerList.length}`)
    for (const p of peerList) {
      output.push(`      ${p.name} — type: ${p.peeringType}, state: ${p.state}`)
      output.push(`        Peer ASN: ${p.peerASN || "none"}, VLAN: ${p.vlanId || "none"}`)
      if (p.microsoftPeeringConfig) {
        output.push(`        Microsoft peering: ${(p.microsoftPeeringConfig.advertisedPublicPrefixes || []).join(", ")}`)
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function privateLinkAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Private Link / Private Endpoint Audit\n"]

  const endpoints = await az(["network", "private-endpoint", "list"], sub, timeout)
  if (endpoints.exitCode !== 0) return { output: `[-] Failed to list private endpoints: ${endpoints.stderr.trim()}`, findings }
  const peList = tryJson(endpoints.stdout) || []
  output.push(`[+] Private endpoints: ${peList.length}\n`)

  const connectedResources = new Set<string>()
  for (const pe of peList) {
    const connections = pe.privateLinkServiceConnections || pe.manualPrivateLinkServiceConnections || []
    for (const conn of connections) {
      const resourceId = conn.privateLinkServiceId || conn.groupIds?.[0] || ""
      connectedResources.add(resourceId)
      output.push(`[+] ${pe.name} → ${resourceId.split("/").pop() || "unknown"} (${conn.groupIds?.join(",") || "all"})`)
      output.push(`    Status: ${conn.privateLinkServiceConnectionState?.status || "unknown"}`)
    }
  }

  const plServices = await az(["network", "private-link-service", "list"], sub, timeout)
  const plsList = tryJson(plServices.stdout) || []
  output.push(`\n[+] Private Link services: ${plsList.length}`)
  for (const pls of plsList) {
    output.push(`  ${pls.name} — visibility: ${pls.visibility?.subscriptions?.length || 0} subs, auto-approve: ${pls.autoApproval?.subscriptions?.length || 0} subs`)
  }

  const criticalTypes = [
    { type: "storage", cmd: ["storage", "account", "list", "--query", "[?publicNetworkAccess!='Disabled'].{name:name,id:id}"] },
    { type: "sql", cmd: ["sql", "server", "list", "--query", "[?publicNetworkAccess!='Disabled'].{name:name,id:id}"] },
    { type: "keyvault", cmd: ["keyvault", "list", "--query", "[?properties.publicNetworkAccess!='Disabled'].{name:name,id:id}"] },
  ]

  output.push("\n[*] Services without private endpoints:")
  for (const check of criticalTypes) {
    const r = await az(check.cmd, sub, timeout)
    const resources = tryJson(r.stdout) || []
    const withoutPe = resources.filter((res: Record<string, string>) => !connectedResources.has(res.id))
    if (withoutPe.length > 0) {
      output.push(`  ${check.type}: ${withoutPe.length} without private endpoint`)
      for (const res of withoutPe.slice(0, 5)) {
        output.push(`    ${res.name}`)
      }
      findings.push({
        checkId: "AZ-PL-001",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `privatelink://${check.type}`,
        title: `${withoutPe.length} ${check.type} resources without private endpoints`,
        details: `Public network access enabled without private endpoint protection`,
        remediation: `Create private endpoints for ${check.type} resources and disable public access`,
      })
    }
  }

  return { output: output.join("\n"), findings }
}
