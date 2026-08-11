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
      "--filter",
      "accountEnabled eq true",
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

// ── P0 recon handlers ──

export async function apimEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure API Management...\n"]

  const apims = await az(["apim", "list"], sub, timeout)
  if (apims.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list APIM instances", findings }

  const items = tryJson(apims.stdout) || []
  output.push(`[+] APIM instances: ${items.length}\n`)

  for (const apim of items) {
    output.push(`── ${apim.name} (${apim.resourceGroup}) ──`)
    output.push(`    Gateway URL: ${apim.gatewayUrl}`)
    output.push(`    SKU: ${apim.sku?.name}`)
    output.push(`    Public IP: ${apim.publicIpAddresses?.join(", ") || "none"}`)

    const apis = await az(
      ["apim", "api", "list", "--resource-group", apim.resourceGroup, "--service-name", apim.name],
      sub,
      30,
    )
    if (apis.exitCode === 0) {
      const apiList = tryJson(apis.stdout) || []
      output.push(`    APIs: ${apiList.length}`)
      for (const api of apiList) {
        output.push(
          `      ${api.displayName} (${api.path}) — auth: ${api.authenticationSettings ? "configured" : "NONE"}`,
        )
        if (!api.authenticationSettings || (!api.authenticationSettings.oAuth2 && !api.authenticationSettings.openid)) {
          findings.push({
            checkId: "AZ-APIM-001",
            provider: "azure",
            severity: "high",
            status: "FAIL",
            resource: `apim://${apim.name}/${api.name}`,
            title: `APIM API without auth: ${apim.name}/${api.displayName}`,
            details: `API "${api.displayName}" at path /${api.path} has no authentication policy`,
            remediation: "Configure OAuth2, OpenID Connect, or subscription key validation",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function databricksEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Databricks workspaces...\n"]

  const workspaces = await az(["databricks", "workspace", "list"], sub, timeout)
  if (workspaces.exitCode !== 0)
    return { output: output.join("\n") + "[-] Cannot list Databricks workspaces", findings }

  const items = tryJson(workspaces.stdout) || []
  output.push(`[+] Databricks workspaces: ${items.length}\n`)

  for (const ws of items) {
    output.push(`── ${ws.name} (${ws.resourceGroup}) ──`)
    output.push(`    URL: ${ws.workspaceUrl || "N/A"}`)
    output.push(`    SKU: ${ws.sku?.name}`)
    output.push(`    Managed RG: ${ws.managedResourceGroupId?.split("/").pop() || "N/A"}`)
    output.push(`    Public access: ${ws.publicNetworkAccess || "Enabled"}`)
    output.push(`    Identity: ${ws.identity?.type || "none"}`)

    const vnetInjection = ws.parameters?.customVirtualNetworkId?.value
    output.push(`    VNet injection: ${vnetInjection ? "YES" : "NO"}`)

    if (ws.publicNetworkAccess !== "Disabled") {
      findings.push({
        checkId: "AZ-DBR-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `databricks://${ws.name}`,
        title: `Databricks public access enabled: ${ws.name}`,
        details: `Workspace is publicly accessible${!vnetInjection ? " and not VNet-injected" : ""}`,
        remediation: "Disable public network access and enable VNet injection",
      })
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function appInsightsEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Application Insights...\n"]

  const components = await az(["monitor", "app-insights", "component", "list"], sub, timeout)
  if (components.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list App Insights", findings }

  const items = tryJson(components.stdout) || []
  output.push(`[+] App Insights components: ${items.length}\n`)

  for (const comp of items) {
    output.push(`── ${comp.name} (${comp.resourceGroup}) ──`)
    output.push(`    App ID: ${comp.appId}`)
    output.push(`    Instrumentation Key: ${comp.instrumentationKey || "N/A"}`)
    output.push(`    Connection String: ${comp.connectionString?.substring(0, 80) || "N/A"}...`)

    const apiKeys = await az(
      ["monitor", "app-insights", "api-key", "list", "--app", comp.name, "--resource-group", comp.resourceGroup],
      sub,
      15,
    )
    if (apiKeys.exitCode === 0) {
      const keys = tryJson(apiKeys.stdout) || []
      output.push(`    API keys: ${keys.length}`)
      if (keys.length > 0) {
        for (const k of keys)
          output.push(
            `      ${k.name} — permissions: ${(k.linkedReadProperties || []).length} read, ${(k.linkedWriteProperties || []).length} write`,
          )
        findings.push({
          checkId: "AZ-AI-001",
          provider: "azure",
          severity: "medium",
          status: "INFO",
          resource: `appinsights://${comp.name}`,
          title: `App Insights API keys exist: ${comp.name}`,
          details: `${keys.length} API key(s) found — can be used to read telemetry data`,
          remediation: "Rotate or remove unused API keys, prefer AAD authentication",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function monitorEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Monitor...\n"]

  const alerts = await az(["monitor", "metrics", "alert", "list"], sub, timeout)
  if (alerts.exitCode === 0) {
    const items = tryJson(alerts.stdout) || []
    output.push(`[+] Metric alert rules: ${items.length}`)
    for (const a of items.slice(0, 15)) output.push(`    ${a.name} — severity: ${a.severity}, enabled: ${a.enabled}`)
    if (items.length > 15) output.push(`    ... and ${items.length - 15} more`)
  }

  const actionGroups = await az(["monitor", "action-group", "list"], sub, timeout)
  if (actionGroups.exitCode === 0) {
    const items = tryJson(actionGroups.stdout) || []
    output.push(`\n[+] Action groups: ${items.length}`)
    for (const ag of items) {
      const receivers = [
        ...(ag.emailReceivers || []).map((r: Record<string, string>) => `email:${r.emailAddress}`),
        ...(ag.smsReceivers || []).map((r: Record<string, string>) => `sms:${r.phoneNumber}`),
        ...(ag.webhookReceivers || []).map((r: Record<string, string>) => `webhook:${r.serviceUri?.substring(0, 50)}`),
      ]
      output.push(`    ${ag.name}: ${receivers.join(", ") || "no receivers"}`)
    }
    if (items.length === 0) {
      findings.push({
        checkId: "AZ-MON-001",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: "azure://monitor/action-groups",
        title: "No action groups configured",
        details: "No alert action groups exist — security alerts have no notification target",
        remediation: "Create action groups with email/SMS/webhook receivers for security alerts",
      })
    }
  }

  const diagSettings = await az(["monitor", "diagnostic-settings", "subscription", "list"], sub, timeout)
  if (diagSettings.exitCode === 0) {
    const items = tryJson(diagSettings.stdout)
    const settings = items?.value || items || []
    output.push(`\n[+] Subscription diagnostic settings: ${Array.isArray(settings) ? settings.length : 0}`)
  }

  return { output: output.join("\n"), findings }
}

export async function recoveryVaultEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Recovery Services Vaults...\n"]

  const vaults = await az(["backup", "vault", "list"], sub, timeout)
  if (vaults.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Recovery vaults", findings }

  const items = tryJson(vaults.stdout) || []
  output.push(`[+] Recovery Services Vaults: ${items.length}\n`)

  for (const vault of items) {
    output.push(`── ${vault.name} (${vault.resourceGroup}) ──`)
    output.push(`    Location: ${vault.location}`)

    const policies = await az(
      ["backup", "policy", "list", "--vault-name", vault.name, "--resource-group", vault.resourceGroup],
      sub,
      15,
    )
    if (policies.exitCode === 0) {
      const policyList = tryJson(policies.stdout) || []
      output.push(`    Backup policies: ${policyList.length}`)
      for (const p of policyList) output.push(`      ${p.name} (${p.properties?.backupManagementType || "?"})`)
    }

    const props = await az(
      ["backup", "vault", "backup-properties", "show", "--name", vault.name, "--resource-group", vault.resourceGroup],
      sub,
      15,
    )
    if (props.exitCode === 0) {
      const bp = tryJson(props.stdout)
      if (bp) {
        const softDelete = bp.softDeleteFeatureState || "Unknown"
        output.push(`    Soft delete: ${softDelete}`)
        if (softDelete === "Disabled") {
          findings.push({
            checkId: "AZ-RSV-001",
            provider: "azure",
            severity: "high",
            status: "FAIL",
            resource: `rsv://${vault.name}`,
            title: `Soft delete disabled: ${vault.name}`,
            details: "Backup data can be permanently deleted without recovery period",
            remediation: "Enable soft delete for ransomware protection",
          })
        }
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function intuneEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Intune (via Graph API)...\n"]

  const compliance = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/deviceManagement/deviceCompliancePolicies",
      "--query",
      "value",
    ],
    timeout,
  )
  if (compliance.exitCode === 0) {
    const policies = tryJson(compliance.stdout) || []
    output.push(`[+] Compliance policies: ${policies.length}`)
    for (const p of policies) output.push(`    ${p.displayName} (${p["@odata.type"]?.split(".").pop()})`)
  }

  const configs = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations",
      "--query",
      "value",
    ],
    timeout,
  )
  if (configs.exitCode === 0) {
    const cfgList = tryJson(configs.stdout) || []
    output.push(`\n[+] Device configurations: ${cfgList.length}`)
    for (const c of cfgList) output.push(`    ${c.displayName} (${c["@odata.type"]?.split(".").pop()})`)
  }

  const scripts = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/beta/deviceManagement/deviceManagementScripts",
      "--query",
      "value",
    ],
    timeout,
  )
  if (scripts.exitCode === 0) {
    const scriptList = tryJson(scripts.stdout) || []
    output.push(`\n[+] Device management scripts: ${scriptList.length}`)
    for (const s of scriptList) {
      output.push(`    ${s.displayName} — runAs: ${s.runAsAccount}`)
      if (s.runAsAccount === "system") {
        findings.push({
          checkId: "AZ-INTUNE-001",
          provider: "azure",
          severity: "high",
          status: "INFO",
          resource: `intune://script/${s.id}`,
          title: `Intune script runs as SYSTEM: ${s.displayName}`,
          details: "Script executes with SYSTEM privileges on managed devices",
          remediation: "Review script content for sensitive operations, use least-privilege",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function graphUserEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure AD users via Graph...\n"]

  const users = await run(
    "az",
    [
      "ad",
      "user",
      "list",
      "--query",
      "[].{upn:userPrincipalName,type:userType,enabled:accountEnabled,displayName:displayName}",
      "-o",
      "json",
    ],
    timeout,
  )
  if (users.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot enumerate users", findings }

  const items = tryJson(users.stdout) || []
  output.push(`[+] Total users: ${items.length}\n`)

  const guests = items.filter((u: Record<string, string>) => u.type === "Guest")
  const members = items.filter((u: Record<string, string>) => u.type === "Member")
  const disabled = items.filter((u: Record<string, string>) => !u.enabled)

  output.push(`[+] Members: ${members.length}, Guests: ${guests.length}, Disabled: ${disabled.length}`)

  if (guests.length > 0) {
    output.push(`\n[+] Guest users:`)
    for (const g of guests.slice(0, 20)) output.push(`    ${g.upn} (${g.displayName})`)
    if (guests.length > 20) output.push(`    ... and ${guests.length - 20} more`)
    findings.push({
      checkId: "AZ-GRAPH-USER-001",
      provider: "azure",
      severity: "medium",
      status: "INFO",
      resource: "azure://ad/users/guests",
      title: `${guests.length} guest users in tenant`,
      details: `Guest accounts: ${guests
        .slice(0, 5)
        .map((g: Record<string, string>) => g.upn)
        .join(", ")}${guests.length > 5 ? "..." : ""}`,
      remediation: "Review guest access policies, ensure B2B guests have minimal permissions",
    })
  }

  if (disabled.length > 0) {
    output.push(`\n[+] Disabled accounts: ${disabled.length}`)
    for (const d of disabled.slice(0, 10)) output.push(`    ${d.upn}`)
  }

  return { output: output.join("\n"), findings }
}

export async function appRegistrationEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure AD App Registrations...\n"]

  const apps = await run(
    "az",
    [
      "ad",
      "app",
      "list",
      "--query",
      "[].{displayName:displayName,appId:appId,passwordCredentials:passwordCredentials,keyCredentials:keyCredentials,requiredResourceAccess:requiredResourceAccess}",
      "-o",
      "json",
    ],
    timeout,
  )
  if (apps.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list app registrations", findings }

  const items = tryJson(apps.stdout) || []
  output.push(`[+] App registrations: ${items.length}\n`)

  const dangerousPerms = [
    "Directory.ReadWrite.All",
    "RoleManagement.ReadWrite.Directory",
    "Application.ReadWrite.All",
    "Mail.ReadWrite",
    "Files.ReadWrite.All",
  ]
  const now = Date.now()

  for (const app of items) {
    output.push(`── ${app.displayName} (${app.appId}) ──`)

    const creds = app.passwordCredentials || []
    const certs = app.keyCredentials || []
    output.push(`    Secrets: ${creds.length}, Certificates: ${certs.length}`)

    for (const c of creds) {
      const expiry = c.endDateTime ? new Date(c.endDateTime).getTime() : 0
      if (expiry && expiry < now) {
        output.push(`    [!] Expired secret: ${c.displayName || c.keyId} (expired ${c.endDateTime})`)
      } else if (expiry && expiry - now < 30 * 86400000) {
        output.push(`    [!] Secret expiring soon: ${c.displayName || c.keyId} (${c.endDateTime})`)
      }
    }

    const reqPerms = app.requiredResourceAccess || []
    for (const rp of reqPerms) {
      for (const perm of rp.resourceAccess || []) {
        if (perm.type === "Role") {
          findings.push({
            checkId: "AZ-APPREG-001",
            provider: "azure",
            severity: "high",
            status: "FAIL",
            resource: `appreg://${app.appId}`,
            title: `App with application-level permission: ${app.displayName}`,
            details: `Permission ID: ${perm.id} (type: Role) — application permissions don't require user consent`,
            remediation: "Review if application permission is necessary, prefer delegated permissions",
          })
          break
        }
      }
    }

    const redirectUris = [
      ...(app.web?.redirectUris || []),
      ...(app.spa?.redirectUris || []),
      ...(app.publicClient?.redirectUris || []),
    ]
    if (redirectUris.length > 0) {
      const suspicious = redirectUris.filter(
        (u: string) => u.startsWith("http://") && !u.startsWith("http://localhost"),
      )
      if (suspicious.length > 0) {
        output.push(`    [!] Non-HTTPS redirect URIs: ${suspicious.join(", ")}`)
        findings.push({
          checkId: "AZ-APPREG-002",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: `appreg://${app.appId}/redirectUri`,
          title: `HTTP redirect URI: ${app.displayName}`,
          details: `Non-HTTPS redirect URIs: ${suspicious.join(", ")}`,
          remediation: "Use HTTPS redirect URIs to prevent token interception",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function logicAppConnectorEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Logic App API connections...\n"]

  const subId = sub || tryJson((await run("az", ["account", "show", "-o", "json"], 10)).stdout)?.id
  if (!subId) return { output: output.join("\n") + "[-] Cannot determine subscription ID", findings }

  const connections = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Web/connections?api-version=2016-06-01`,
    ],
    timeout,
  )
  if (connections.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list API connections", findings }

  const data = tryJson(connections.stdout)
  const items = data?.value || []
  output.push(`[+] API connections: ${items.length}\n`)

  const sensitiveTypes = ["sql", "keyvault", "azureblob", "azuread", "office365", "sharepoint", "dynamicscrmonline"]

  for (const conn of items) {
    const connType = conn.properties?.api?.name || "unknown"
    const status = conn.properties?.statuses?.[0]?.status || "Unknown"
    output.push(`    ${conn.name} — type: ${connType}, status: ${status}`)

    if (sensitiveTypes.some((t) => connType.toLowerCase().includes(t))) {
      findings.push({
        checkId: "AZ-LACONN-001",
        provider: "azure",
        severity: "medium",
        status: "INFO",
        resource: `logicapp-conn://${conn.name}`,
        title: `Sensitive API connection: ${conn.name} (${connType})`,
        details: `Logic App connection to ${connType} — may contain stored credentials`,
        remediation: "Use managed identity for Logic App connections where possible",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function automationRunbookEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Automation accounts & runbooks...\n"]

  const accounts = await az(["automation", "account", "list"], sub, timeout)
  if (accounts.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Automation accounts", findings }

  const items = tryJson(accounts.stdout) || []
  output.push(`[+] Automation accounts: ${items.length}\n`)

  for (const acct of items) {
    output.push(`── ${acct.name} (${acct.resourceGroup}) ──`)
    output.push(`    Identity: ${acct.identity?.type || "none"}`)

    const runbooks = await az(
      ["automation", "runbook", "list", "--automation-account-name", acct.name, "--resource-group", acct.resourceGroup],
      sub,
      30,
    )
    if (runbooks.exitCode === 0) {
      const rbList = tryJson(runbooks.stdout) || []
      output.push(`    Runbooks: ${rbList.length}`)
      for (const rb of rbList) output.push(`      ${rb.name} (${rb.runbookType}) — state: ${rb.state}`)
    }

    const schedules = await az(
      [
        "automation",
        "schedule",
        "list",
        "--automation-account-name",
        acct.name,
        "--resource-group",
        acct.resourceGroup,
      ],
      sub,
      15,
    )
    if (schedules.exitCode === 0) {
      const schedList = tryJson(schedules.stdout) || []
      output.push(`    Schedules: ${schedList.length}`)
      for (const s of schedList) output.push(`      ${s.name} — freq: ${s.frequency}, enabled: ${s.isEnabled}`)
    }

    const variables = await az(
      [
        "automation",
        "variable",
        "list",
        "--automation-account-name",
        acct.name,
        "--resource-group",
        acct.resourceGroup,
      ],
      sub,
      15,
    )
    if (variables.exitCode === 0) {
      const varList = tryJson(variables.stdout) || []
      output.push(`    Variables: ${varList.length}`)
      for (const v of varList) {
        const encrypted = v.isEncrypted ? "[encrypted]" : v.value?.substring(0, 60) || ""
        output.push(`      ${v.name}: ${encrypted}`)
        if (!v.isEncrypted && v.value) {
          findings.push({
            checkId: "AZ-AUTORUN-001",
            provider: "azure",
            severity: "medium",
            status: "INFO",
            resource: `automation://${acct.name}/var/${v.name}`,
            title: `Unencrypted automation variable: ${acct.name}/${v.name}`,
            details: `Variable stored in plaintext: ${v.value.substring(0, 100)}`,
            remediation: "Mark sensitive variables as encrypted",
          })
        }
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function synapseEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Synapse Analytics...\n"]

  const workspaces = await az(["synapse", "workspace", "list"], sub, timeout)
  if (workspaces.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Synapse workspaces", findings }

  const items = tryJson(workspaces.stdout) || []
  output.push(`[+] Synapse workspaces: ${items.length}\n`)

  for (const ws of items) {
    output.push(`── ${ws.name} (${ws.resourceGroup}) ──`)
    output.push(`    Dev endpoint: ${ws.connectivityEndpoints?.dev || "N/A"}`)
    output.push(`    SQL endpoint: ${ws.connectivityEndpoints?.sql || "N/A"}`)
    output.push(`    SQL admin: ${ws.sqlAdministratorLogin}`)
    output.push(`    Public access: ${ws.publicNetworkAccess || "Enabled"}`)
    output.push(`    Managed VNet: ${ws.managedVirtualNetwork ? "YES" : "NO"}`)
    output.push(`    Identity: ${ws.identity?.type || "none"}`)

    if (ws.publicNetworkAccess !== "Disabled") {
      findings.push({
        checkId: "AZ-SYNAPSE-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `synapse://${ws.name}`,
        title: `Synapse public access: ${ws.name}`,
        details: `Workspace is publicly accessible — SQL admin: ${ws.sqlAdministratorLogin}`,
        remediation: "Disable public network access, use managed VNet and private endpoints",
      })
    }

    const sqlPools = await az(
      ["synapse", "sql", "pool", "list", "--workspace-name", ws.name, "--resource-group", ws.resourceGroup],
      sub,
      15,
    )
    if (sqlPools.exitCode === 0) {
      const pools = tryJson(sqlPools.stdout) || []
      output.push(`    SQL pools: ${pools.length}`)
      for (const p of pools) output.push(`      ${p.name} (${p.sku?.name}) — status: ${p.status}`)
    }

    const sparkPools = await az(
      ["synapse", "spark", "pool", "list", "--workspace-name", ws.name, "--resource-group", ws.resourceGroup],
      sub,
      15,
    )
    if (sparkPools.exitCode === 0) {
      const pools = tryJson(sparkPools.stdout) || []
      output.push(`    Spark pools: ${pools.length}`)
      for (const p of pools) output.push(`      ${p.name} — nodes: ${p.nodeCount} x ${p.nodeSize}`)
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function purviewEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Microsoft Purview accounts...\n"]

  const accounts = await az(["purview", "account", "list"], sub, timeout)
  if (accounts.exitCode !== 0) {
    const subId = sub || tryJson((await run("az", ["account", "show", "-o", "json"], 10)).stdout)?.id
    if (subId) {
      const rest = await run(
        "az",
        [
          "rest",
          "--method",
          "GET",
          "--url",
          `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.Purview/accounts?api-version=2021-07-01`,
        ],
        timeout,
      )
      if (rest.exitCode === 0) {
        const data = tryJson(rest.stdout)
        const items = data?.value || []
        output.push(`[+] Purview accounts (via REST): ${items.length}`)
        for (const acct of items) {
          output.push(`    ${acct.name} (${acct.location}) — ${acct.properties?.publicNetworkAccess || "Enabled"}`)
          if (acct.properties?.publicNetworkAccess !== "Disabled") {
            findings.push({
              checkId: "AZ-PURVIEW-001",
              provider: "azure",
              severity: "medium",
              status: "FAIL",
              resource: `purview://${acct.name}`,
              title: `Purview public access: ${acct.name}`,
              details: "Data governance portal is publicly accessible",
              remediation: "Disable public network access for Purview account",
            })
          }
        }
        return { output: output.join("\n"), findings }
      }
    }
    return { output: output.join("\n") + "[-] Cannot list Purview accounts", findings }
  }

  const items = tryJson(accounts.stdout) || []
  output.push(`[+] Purview accounts: ${items.length}\n`)

  for (const acct of items) {
    output.push(`── ${acct.name} (${acct.resourceGroup || acct.location}) ──`)
    output.push(`    Public access: ${acct.properties?.publicNetworkAccess || "Enabled"}`)
    output.push(`    Identity: ${acct.identity?.type || "none"}`)

    if (acct.properties?.publicNetworkAccess !== "Disabled") {
      findings.push({
        checkId: "AZ-PURVIEW-002",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `purview://${acct.name}`,
        title: `Purview public access: ${acct.name}`,
        details: "Data governance portal is publicly accessible",
        remediation: "Disable public network access for Purview account",
      })
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

// ── P2 recon handlers ──

export async function subdomainTakeover(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Checking for subdomain takeover via dangling CNAMEs...\n"]

  const danglingPatterns = [
    ".azurewebsites.net",
    ".trafficmanager.net",
    ".cloudapp.azure.com",
    ".blob.core.windows.net",
    ".azureedge.net",
    ".azure-api.net",
    ".azurefd.net",
    ".azurecontainer.io",
    ".database.windows.net",
    ".azurecr.io",
  ]

  const zones = await az(["network", "dns", "zone", "list"], sub, timeout)
  if (zones.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list DNS zones", findings }

  const zoneList = tryJson(zones.stdout) || []
  output.push(`[+] DNS zones to check: ${zoneList.length}\n`)

  for (const zone of zoneList) {
    const records = await az(
      [
        "network",
        "dns",
        "record-set",
        "cname",
        "list",
        "--zone-name",
        zone.name,
        "--resource-group",
        zone.resourceGroup,
      ],
      sub,
      30,
    )
    if (records.exitCode !== 0) continue

    const cnames = tryJson(records.stdout) || []
    for (const cn of cnames) {
      const target = cn.cnameRecord?.cname || cn.CNAMERecord?.cname || ""
      if (!target) continue

      const isDangling = danglingPatterns.some((p) => target.endsWith(p))
      if (!isDangling) continue

      output.push(`[!] ${cn.fqdn || cn.name + "." + zone.name} → ${target}`)

      const dig = await run("dig", ["+short", target], 10)
      const resolved = dig.exitCode === 0 && dig.stdout.trim().length > 0

      if (!resolved) {
        output.push(`    STATUS: NXDOMAIN — likely takeover candidate`)
        findings.push({
          checkId: "AZ-SUBDOMAIN-001",
          provider: "azure",
          severity: "critical",
          status: "FAIL",
          resource: `dns://${zone.name}/${cn.name}`,
          title: `Subdomain takeover: ${cn.name}.${zone.name}`,
          details: `CNAME → ${target} does not resolve — attacker can claim this resource`,
          remediation: "Remove dangling CNAME record or reclaim the Azure resource",
        })
      } else {
        output.push(`    STATUS: Resolves — not currently vulnerable`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function stalePermissionAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing stale role assignments...\n"]

  const assignments = await az(["role", "assignment", "list", "--all", "--include-inherited"], sub, timeout)
  if (assignments.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list role assignments", findings }

  const items = tryJson(assignments.stdout) || []
  output.push(`[+] Total role assignments: ${items.length}\n`)

  const spAssignments = items.filter((a: Record<string, string>) => a.principalType === "ServicePrincipal")
  output.push(`[+] Service Principal assignments: ${spAssignments.length}`)

  for (const sp of spAssignments) {
    const spShow = await run("az", ["ad", "sp", "show", "--id", sp.principalId, "-o", "json"], 10)
    if (spShow.exitCode !== 0) {
      output.push(`    [!] Orphaned assignment: ${sp.principalId} → ${sp.roleDefinitionName} (principal not found)`)
      findings.push({
        checkId: "AZ-STALE-001",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `rbac://${sp.principalId}`,
        title: `Orphaned role assignment: ${sp.roleDefinitionName}`,
        details: `Principal ${sp.principalId} no longer exists but has ${sp.roleDefinitionName} at ${sp.scope}`,
        remediation: "Remove orphaned role assignment: az role assignment delete --ids <assignment-id>",
      })
      continue
    }

    const spData = tryJson(spShow.stdout)
    if (spData) output.push(`    ${spData.displayName} → ${sp.roleDefinitionName}`)
  }

  const unknownPrincipals = items.filter(
    (a: Record<string, string>) => a.principalType === "Unknown" || !a.principalName,
  )
  if (unknownPrincipals.length > 0) {
    output.push(`\n[!] Assignments with unknown/deleted principals: ${unknownPrincipals.length}`)
    for (const u of unknownPrincipals) {
      output.push(`    ${u.principalId} → ${u.roleDefinitionName} at ${u.scope?.split("/").pop()}`)
      findings.push({
        checkId: "AZ-STALE-002",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `rbac://${u.principalId}`,
        title: `Orphaned role assignment: deleted principal`,
        details: `Deleted principal ${u.principalId} retains ${u.roleDefinitionName} at ${u.scope}`,
        remediation: "Remove orphaned role assignment",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function publicExposureScan(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Full public exposure scan...\n"]

  const pips = await az(["network", "public-ip", "list"], sub, timeout)
  if (pips.exitCode === 0) {
    const items = tryJson(pips.stdout) || []
    output.push(`[+] Public IPs: ${items.length}`)
    for (const ip of items) {
      const addr = ip.ipAddress || "unallocated"
      const assoc = ip.ipConfiguration?.id?.split("/").slice(-3).join("/") || "unassociated"
      output.push(`    ${ip.name}: ${addr} → ${assoc}`)
    }
    findings.push({
      checkId: "AZ-EXPOSURE-001",
      provider: "azure",
      severity: items.length > 10 ? "high" : "medium",
      status: "INFO",
      resource: "azure://public-ips",
      title: `${items.length} public IP addresses`,
      details: items.map((i: Record<string, string>) => `${i.name}:${i.ipAddress || "unallocated"}`).join(", "),
      remediation: "Remove unnecessary public IPs, use Azure Bastion/Private Link",
    })
  }

  const nsgs = await az(["network", "nsg", "list"], sub, timeout)
  if (nsgs.exitCode === 0) {
    const nsgItems = tryJson(nsgs.stdout) || []
    let openCount = 0
    for (const nsg of nsgItems) {
      const rules = nsg.securityRules || []
      for (const rule of rules) {
        if (
          rule.direction === "Inbound" &&
          rule.access === "Allow" &&
          (rule.sourceAddressPrefix === "*" || rule.sourceAddressPrefix === "0.0.0.0/0") &&
          rule.destinationPortRange === "*"
        ) {
          openCount++
          output.push(`    [!] Open NSG: ${nsg.name}/${rule.name} — all ports from Internet`)
        }
      }
    }
    if (openCount > 0) {
      findings.push({
        checkId: "AZ-EXPOSURE-002",
        provider: "azure",
        severity: "critical",
        status: "FAIL",
        resource: "azure://nsg/open-rules",
        title: `${openCount} NSG rules allow all inbound from Internet`,
        details: "NSG rules with source 0.0.0.0/0 and destination port * found",
        remediation: "Restrict NSG rules to specific ports and source IPs",
      })
    }
  }

  const storage = await az(
    [
      "storage",
      "account",
      "list",
      "--query",
      "[].{name:name,rg:resourceGroup,allowBlobPublicAccess:allowBlobPublicAccess}",
    ],
    sub,
    timeout,
  )
  if (storage.exitCode === 0) {
    const items = tryJson(storage.stdout) || []
    const publicAccounts = items.filter((s: Record<string, boolean>) => s.allowBlobPublicAccess)
    output.push(`\n[+] Storage accounts with public blob access: ${publicAccounts.length}/${items.length}`)
    for (const s of publicAccounts) {
      output.push(`    [!] ${s.name} — anonymous blob access allowed`)
      findings.push({
        checkId: "AZ-EXPOSURE-003",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `storage://${s.name}`,
        title: `Public blob access: ${s.name}`,
        details: "Storage account allows anonymous public blob access",
        remediation: "Disable allowBlobPublicAccess on storage account",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

// ── P3 niche handlers ──

export async function databricksSecretDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Databricks secret scopes...\n"]

  const workspaces = await az(["databricks", "workspace", "list"], sub, timeout)
  if (workspaces.exitCode !== 0)
    return { output: output.join("\n") + "[-] Cannot list Databricks workspaces", findings }

  const items = tryJson(workspaces.stdout) || []
  output.push(`[+] Databricks workspaces: ${items.length}\n`)

  for (const ws of items) {
    output.push(`── ${ws.name} ──`)
    const wsUrl = ws.workspaceUrl
    if (!wsUrl) {
      output.push("    [!] No workspace URL — cannot query secret scopes")
      continue
    }

    const scopes = await run(
      "az",
      [
        "rest",
        "--method",
        "GET",
        "--url",
        `https://${wsUrl}/api/2.0/secrets/scopes/list`,
        "--resource",
        "2ff814a6-3304-4ab8-85cb-cd0e6f879c1d",
      ],
      timeout,
    )
    if (scopes.exitCode === 0) {
      const data = tryJson(scopes.stdout)
      const scopeList = data?.scopes || []
      output.push(`    Secret scopes: ${scopeList.length}`)
      for (const scope of scopeList) {
        output.push(`      ${scope.name} (backend: ${scope.backend_type})`)
        findings.push({
          checkId: "AZ-DBR-SECRET-001",
          provider: "azure",
          severity: "medium",
          status: "INFO",
          resource: `databricks://${ws.name}/secrets/${scope.name}`,
          title: `Databricks secret scope: ${ws.name}/${scope.name}`,
          details: `Backend: ${scope.backend_type} — enumerate secrets with list API`,
          remediation: "Ensure secret ACLs restrict access to authorized principals",
        })
      }
    } else {
      output.push("    [!] Cannot access secrets API (auth or permission issue)")
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function cognitiveServicesEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Cognitive Services...\n"]

  const accounts = await az(["cognitiveservices", "account", "list"], sub, timeout)
  if (accounts.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Cognitive Services", findings }

  const items = tryJson(accounts.stdout) || []
  output.push(`[+] Cognitive Services accounts: ${items.length}\n`)

  for (const acct of items) {
    output.push(`── ${acct.name} (${acct.kind}) ──`)
    output.push(`    SKU: ${acct.sku?.name}`)
    output.push(`    Endpoint: ${acct.properties?.endpoint || "N/A"}`)
    output.push(`    Public access: ${acct.properties?.publicNetworkAccess || "Enabled"}`)
    output.push(`    Network rules: ${acct.properties?.networkAcls?.defaultAction || "Allow"}`)

    if (acct.properties?.publicNetworkAccess !== "Disabled" && acct.properties?.networkAcls?.defaultAction !== "Deny") {
      findings.push({
        checkId: "AZ-COG-001",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `cognitive://${acct.name}`,
        title: `Cognitive Services publicly accessible: ${acct.name}`,
        details: `${acct.kind} endpoint open to public — API key auth only`,
        remediation: "Restrict network access and use AAD authentication",
      })
    }

    const keys = await az(
      ["cognitiveservices", "account", "keys", "list", "--name", acct.name, "--resource-group", acct.resourceGroup],
      sub,
      15,
    )
    if (keys.exitCode === 0) {
      const keyData = tryJson(keys.stdout)
      if (keyData) {
        output.push(`    [!] Key1: ${keyData.key1?.substring(0, 16)}...`)
        findings.push({
          checkId: "AZ-COG-002",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `cognitive://${acct.name}/keys`,
          title: `Cognitive Services keys extracted: ${acct.name}`,
          details: `API keys for ${acct.kind} — endpoint: ${acct.properties?.endpoint}`,
          remediation: "Rotate keys, use managed identity authentication",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function iotHubEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure IoT Hubs...\n"]

  const hubs = await az(["iot", "hub", "list"], sub, timeout)
  if (hubs.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list IoT Hubs", findings }

  const items = tryJson(hubs.stdout) || []
  output.push(`[+] IoT Hubs: ${items.length}\n`)

  for (const hub of items) {
    output.push(`── ${hub.name} (${hub.resourcegroup || hub.resourceGroup}) ──`)
    output.push(`    Hostname: ${hub.properties?.hostName}`)
    output.push(`    SKU: ${hub.sku?.name} (${hub.sku?.capacity} units)`)
    output.push(`    State: ${hub.properties?.state}`)
    output.push(`    Public access: ${hub.properties?.publicNetworkAccess || "Enabled"}`)

    const policies = hub.properties?.authorizationPolicies || []
    output.push(`    Shared access policies: ${policies.length}`)
    for (const p of policies) {
      output.push(`      ${p.keyName} — rights: ${p.rights}`)
      if (p.rights?.includes("RegistryWrite") || p.rights?.includes("ServiceConnect")) {
        findings.push({
          checkId: "AZ-IOT-001",
          provider: "azure",
          severity: "high",
          status: "INFO",
          resource: `iothub://${hub.name}/${p.keyName}`,
          title: `IoT Hub privileged policy: ${hub.name}/${p.keyName}`,
          details: `Policy "${p.keyName}" has ${p.rights} — high-privilege access`,
          remediation: "Use per-device SAS tokens, limit shared access policies",
        })
      }
    }

    const routing = hub.properties?.routing?.endpoints || {}
    const endpoints = [
      ...(routing.eventHubs || []),
      ...(routing.serviceBusQueues || []),
      ...(routing.serviceBusTopics || []),
      ...(routing.storageContainers || []),
    ]
    if (endpoints.length > 0) {
      output.push(`    Routing endpoints: ${endpoints.length}`)
      for (const ep of endpoints) output.push(`      ${ep.name} (${ep.resourceGroup || "?"})`)
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function signalrEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure SignalR Service...\n"]

  const instances = await az(["signalr", "list"], sub, timeout)
  if (instances.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list SignalR instances", findings }

  const items = tryJson(instances.stdout) || []
  output.push(`[+] SignalR instances: ${items.length}\n`)

  for (const sr of items) {
    output.push(`── ${sr.name} (${sr.resourceGroup}) ──`)
    output.push(`    Hostname: ${sr.hostName}`)
    output.push(`    SKU: ${sr.sku?.name} (${sr.sku?.capacity} units)`)
    output.push(`    Public access: ${sr.publicNetworkAccess || "Enabled"}`)
    output.push(`    Network ACLs: default=${sr.networkACLs?.defaultAction || "Allow"}`)

    if (sr.publicNetworkAccess !== "Disabled") {
      findings.push({
        checkId: "AZ-SIGNALR-001",
        provider: "azure",
        severity: "medium",
        status: "FAIL",
        resource: `signalr://${sr.name}`,
        title: `SignalR public access: ${sr.name}`,
        details: `SignalR Service is publicly accessible at ${sr.hostName}`,
        remediation: "Disable public network access, use private endpoints",
      })
    }

    const keys = await az(["signalr", "key", "list", "--name", sr.name, "--resource-group", sr.resourceGroup], sub, 15)
    if (keys.exitCode === 0) {
      const keyData = tryJson(keys.stdout)
      if (keyData) {
        output.push(`    [!] Primary key: ${keyData.primaryKey?.substring(0, 16)}...`)
        findings.push({
          checkId: "AZ-SIGNALR-002",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `signalr://${sr.name}/keys`,
          title: `SignalR keys extracted: ${sr.name}`,
          details: `Connection string available — full service access`,
          remediation: "Rotate keys, use AAD authentication",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function eventGridEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Event Grid...\n"]

  const topics = await az(["eventgrid", "topic", "list"], sub, timeout)
  if (topics.exitCode === 0) {
    const items = tryJson(topics.stdout) || []
    output.push(`[+] Event Grid topics: ${items.length}`)
    for (const t of items) {
      output.push(`    ${t.name} — endpoint: ${t.endpoint?.substring(0, 60)}`)
      output.push(`      Public access: ${t.publicNetworkAccess || "Enabled"}`)

      const subs = await az(
        ["eventgrid", "event-subscription", "list", "--topic-name", t.name, "--resource-group", t.resourceGroup],
        sub,
        15,
      )
      if (subs.exitCode === 0) {
        const subList = tryJson(subs.stdout) || []
        output.push(`      Subscriptions: ${subList.length}`)
        for (const s of subList) {
          output.push(`        ${s.name} → ${s.destination?.endpointType || "?"}`)
          if (s.deadLetterDestination) output.push(`        Dead-letter: configured`)
        }
      }

      const keys = await az(
        ["eventgrid", "topic", "key", "list", "--name", t.name, "--resource-group", t.resourceGroup],
        sub,
        10,
      )
      if (keys.exitCode === 0) {
        const keyData = tryJson(keys.stdout)
        if (keyData) {
          output.push(`      [!] Key1: ${keyData.key1?.substring(0, 16)}...`)
          findings.push({
            checkId: "AZ-EG-001",
            provider: "azure",
            severity: "high",
            status: "EXTRACTED",
            resource: `eventgrid://${t.name}/keys`,
            title: `Event Grid keys extracted: ${t.name}`,
            details: `Access keys retrieved — can publish events to topic`,
            remediation: "Rotate keys, use AAD authentication for publishers",
          })
        }
      }
    }
  }

  const domains = await az(["eventgrid", "domain", "list"], sub, timeout)
  if (domains.exitCode === 0) {
    const items = tryJson(domains.stdout) || []
    if (items.length > 0) {
      output.push(`\n[+] Event Grid domains: ${items.length}`)
      for (const d of items) output.push(`    ${d.name} — endpoint: ${d.endpoint?.substring(0, 60)}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function batchEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Batch accounts...\n"]

  const accounts = await az(["batch", "account", "list"], sub, timeout)
  if (accounts.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Batch accounts", findings }

  const items = tryJson(accounts.stdout) || []
  output.push(`[+] Batch accounts: ${items.length}\n`)

  for (const acct of items) {
    output.push(`── ${acct.name} (${acct.resourceGroup}) ──`)
    output.push(`    Endpoint: ${acct.accountEndpoint}`)
    output.push(`    Pool allocation: ${acct.poolAllocationMode}`)
    output.push(`    Public access: ${acct.publicNetworkAccess || "Enabled"}`)
    output.push(`    Auto-storage: ${acct.autoStorage?.storageAccountId?.split("/").pop() || "none"}`)

    if (acct.autoStorage?.storageAccountId) {
      findings.push({
        checkId: "AZ-BATCH-001",
        provider: "azure",
        severity: "medium",
        status: "INFO",
        resource: `batch://${acct.name}`,
        title: `Batch auto-storage account: ${acct.name}`,
        details: `Auto-storage: ${acct.autoStorage.storageAccountId.split("/").pop()} — may contain task data`,
        remediation: "Ensure auto-storage account has proper access controls",
      })
    }

    const keys = await az(
      ["batch", "account", "keys", "list", "--name", acct.name, "--resource-group", acct.resourceGroup],
      sub,
      15,
    )
    if (keys.exitCode === 0) {
      const keyData = tryJson(keys.stdout)
      if (keyData) {
        output.push(`    [!] Primary key: ${keyData.primary?.substring(0, 16)}...`)
        findings.push({
          checkId: "AZ-BATCH-004",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `batch://${acct.name}/keys`,
          title: `Batch account keys extracted: ${acct.name}`,
          details: `Full account keys — can submit jobs, access pools`,
          remediation: "Rotate keys, use AAD authentication",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function mapsSearchEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Maps accounts...\n"]

  const accounts = await az(["maps", "account", "list"], sub, timeout)
  if (accounts.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Maps accounts", findings }

  const items = tryJson(accounts.stdout) || []
  output.push(`[+] Maps accounts: ${items.length}\n`)

  for (const acct of items) {
    output.push(`── ${acct.name} (${acct.resourceGroup || "?"}) ──`)
    output.push(`    SKU: ${acct.sku?.name}`)
    output.push(`    Kind: ${acct.kind || "Gen1"}`)

    const keys = await az(
      [
        "maps",
        "account",
        "keys",
        "list",
        "--name",
        acct.name,
        "--resource-group",
        acct.resourceGroup || argVal(args, "--resource-group") || "",
      ],
      sub,
      15,
    )
    if (keys.exitCode === 0) {
      const keyData = tryJson(keys.stdout)
      if (keyData) {
        output.push(`    [!] Primary key: ${keyData.primaryKey?.substring(0, 16)}...`)
        output.push(`    [!] Secondary key: ${keyData.secondaryKey?.substring(0, 16)}...`)
        findings.push({
          checkId: "AZ-MAPS-001",
          provider: "azure",
          severity: "medium",
          status: "EXTRACTED",
          resource: `maps://${acct.name}/keys`,
          title: `Maps keys extracted: ${acct.name}`,
          details: "Primary and secondary keys — can be used for Maps API requests (cost impact)",
          remediation: "Rotate keys, use AAD authentication, restrict with CORS",
        })
      }
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
  const output: string[] = ["[*] Enumerating Microsoft Sentinel...\n"]

  if (!workspace || !rg) {
    const workspaces = await az(["monitor", "log-analytics", "workspace", "list"], sub, timeout)
    if (workspaces.exitCode === 0) {
      const wsList = tryJson(workspaces.stdout) || []
      output.push(`[+] Log Analytics workspaces: ${wsList.length}`)
      for (const ws of wsList) output.push(`    ${ws.name} (${ws.resourceGroup}) — sku: ${ws.sku?.name}`)

      for (const ws of wsList) {
        const alertRules = await az(
          ["sentinel", "alert-rule", "list", "--workspace-name", ws.name, "--resource-group", ws.resourceGroup],
          sub,
          30,
        )
        if (alertRules.exitCode === 0) {
          const rules = tryJson(alertRules.stdout) || []
          output.push(`\n[+] Sentinel alert rules (${ws.name}): ${rules.length}`)
          for (const r of rules.slice(0, 15))
            output.push(`    ${r.name} — kind: ${r.kind}, enabled: ${r.properties?.enabled ?? "?"}`)
          if (rules.length > 15) output.push(`    ... and ${rules.length - 15} more`)
          findings.push({
            checkId: "AZ-SENTINEL-ENUM-001",
            provider: "azure",
            severity: "info",
            status: "ENUMERATED",
            resource: `sentinel://${ws.name}`,
            title: `Sentinel rules on ${ws.name}: ${rules.length}`,
            details: rules
              .slice(0, 5)
              .map((r: Record<string, string>) => r.name)
              .join(", "),
            remediation: "Review detection coverage for gaps in MITRE ATT&CK matrix",
          })
        }
      }
    }
    return { output: output.join("\n"), findings }
  }

  const alertRules = await az(
    ["sentinel", "alert-rule", "list", "--workspace-name", workspace, "--resource-group", rg],
    sub,
    timeout,
  )
  if (alertRules.exitCode === 0) {
    const rules = tryJson(alertRules.stdout) || []
    output.push(`[+] Alert rules: ${rules.length}`)
    for (const r of rules) output.push(`    ${r.name} — kind: ${r.kind}`)
  }

  const incidents = await az(
    ["sentinel", "incident", "list", "--workspace-name", workspace, "--resource-group", rg],
    sub,
    timeout,
  )
  if (incidents.exitCode === 0) {
    const items = tryJson(incidents.stdout) || []
    output.push(`\n[+] Incidents: ${items.length}`)
    for (const i of items.slice(0, 10))
      output.push(`    ${i.properties?.title} — severity: ${i.properties?.severity}, status: ${i.properties?.status}`)
  }

  return { output: output.join("\n"), findings }
}

export async function vpnGatewayEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating VPN Gateways...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const gateways = await az(["network", "vnet-gateway", "list", ...rgArgs], sub, timeout)
  if (gateways.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list VPN gateways", findings }

  const items = tryJson(gateways.stdout) || []
  output.push(`[+] VPN Gateways: ${items.length}\n`)

  for (const gw of items) {
    output.push(`── ${gw.name} (${gw.resourceGroup}) ──`)
    output.push(`    Type: ${gw.gatewayType}/${gw.vpnType}`)
    output.push(`    SKU: ${gw.sku?.name}`)
    output.push(`    Active-active: ${gw.activeActive}`)
    output.push(`    BGP: ${gw.enableBgp}`)
    if (gw.bgpSettings) output.push(`    BGP ASN: ${gw.bgpSettings.asn}`)

    const connections = await az(
      ["network", "vpn-connection", "list", "--vnet-gateway", gw.name, "--resource-group", gw.resourceGroup],
      sub,
      30,
    )
    if (connections.exitCode === 0) {
      const conns = tryJson(connections.stdout) || []
      output.push(`    Connections: ${conns.length}`)
      for (const c of conns) {
        output.push(`      ${c.name} — type: ${c.connectionType}, status: ${c.connectionStatus}`)
        if (c.sharedKey) {
          output.push(`      [!] Shared key: ${c.sharedKey.substring(0, 12)}...`)
          findings.push({
            checkId: "AZ-VPN-001",
            provider: "azure",
            severity: "critical",
            status: "EXTRACTED",
            resource: `vpn://${gw.name}/${c.name}`,
            title: `VPN shared key extracted: ${c.name}`,
            details: `IPsec shared key for connection "${c.name}" — can connect to on-premises network`,
            remediation: "Rotate VPN shared key, use certificate-based authentication",
          })
        }
      }
    }

    const ipConfigs = gw.ipConfigurations || []
    for (const ip of ipConfigs) {
      const pubIp = ip.publicIpAddress?.id?.split("/").pop() || "none"
      output.push(`    Public IP: ${pubIp}`)
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function expressRouteEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating ExpressRoute circuits...\n"]

  const circuits = await az(["network", "express-route", "list"], sub, timeout)
  if (circuits.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list ExpressRoute circuits", findings }

  const items = tryJson(circuits.stdout) || []
  output.push(`[+] ExpressRoute circuits: ${items.length}\n`)

  for (const er of items) {
    output.push(`── ${er.name} (${er.resourceGroup}) ──`)
    output.push(`    Provider: ${er.serviceProviderProperties?.serviceProviderName}`)
    output.push(`    Bandwidth: ${er.serviceProviderProperties?.bandwidthInMbps} Mbps`)
    output.push(`    SKU: ${er.sku?.tier}/${er.sku?.family}`)
    output.push(`    Status: ${er.circuitProvisioningState} / ${er.serviceProviderProvisioningState}`)

    if (er.serviceKey) {
      output.push(`    [!] Service key: ${er.serviceKey.substring(0, 12)}...`)
      findings.push({
        checkId: "AZ-ER-001",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: `expressroute://${er.name}`,
        title: `ExpressRoute service key extracted: ${er.name}`,
        details: `Service key provides circuit access — can be used to configure peering`,
        remediation: "Restrict who can view ExpressRoute circuit details",
      })
    }

    const peerings = await az(
      ["network", "express-route", "peering", "list", "--circuit-name", er.name, "--resource-group", er.resourceGroup],
      sub,
      15,
    )
    if (peerings.exitCode === 0) {
      const peerList = tryJson(peerings.stdout) || []
      output.push(`    Peerings: ${peerList.length}`)
      for (const p of peerList) {
        output.push(`      ${p.peeringType} — state: ${p.state}, vlanId: ${p.vlanId}`)
        output.push(`        Primary peer: ${p.primaryPeerAddressPrefix || "N/A"}`)
        output.push(`        Secondary peer: ${p.secondaryPeerAddressPrefix || "N/A"}`)
        findings.push({
          checkId: "AZ-ER-002",
          provider: "azure",
          severity: "high",
          status: "INFO",
          resource: `expressroute://${er.name}/${p.peeringType}`,
          title: `ExpressRoute peering: ${er.name} (${p.peeringType})`,
          details: `Direct connection to on-premises — VLAN ${p.vlanId}`,
          remediation: "Ensure route filters are configured, review advertised routes",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function privateLinkAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Private Link / Private Endpoints...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const endpoints = await az(["network", "private-endpoint", "list", ...rgArgs], sub, timeout)
  if (endpoints.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list private endpoints", findings }

  const items = tryJson(endpoints.stdout) || []
  output.push(`[+] Private endpoints: ${items.length}\n`)

  const coveredResources = new Set<string>()
  for (const ep of items) {
    output.push(`── ${ep.name} (${ep.resourceGroup}) ──`)
    output.push(`    Subnet: ${ep.subnet?.id?.split("/").pop() || "?"}`)

    const connections = ep.privateLinkServiceConnections || ep.manualPrivateLinkServiceConnections || []
    for (const conn of connections) {
      const resourceId = conn.privateLinkServiceId || ""
      const resourceName = resourceId.split("/").pop() || "?"
      const resourceType = resourceId.split("/").slice(-2, -1)[0] || "?"
      output.push(`    → ${resourceName} (${resourceType}) — status: ${conn.privateLinkServiceConnectionState?.status}`)
      coveredResources.add(resourceType.toLowerCase())
    }

    const dnsConfigs = ep.customDnsConfigs || []
    for (const dns of dnsConfigs) output.push(`      DNS: ${dns.fqdn} → ${(dns.ipAddresses || []).join(", ")}`)
    output.push("")
  }

  const serviceTypes = ["storageAccounts", "vaults", "sites", "servers", "namespaces", "registries"]
  const uncovered = serviceTypes.filter((t) => !coveredResources.has(t.toLowerCase()))
  if (uncovered.length > 0) {
    output.push(`\n[!] Service types without private endpoints: ${uncovered.join(", ")}`)
    findings.push({
      checkId: "AZ-PL-001",
      provider: "azure",
      severity: "medium",
      status: "INFO",
      resource: "azure://private-endpoints",
      title: `Services without private endpoints: ${uncovered.length} types`,
      details: `Missing private endpoint coverage for: ${uncovered.join(", ")}`,
      remediation: "Deploy private endpoints for sensitive services (storage, key vault, SQL, etc.)",
    })
  }

  findings.push({
    checkId: "AZ-PL-002",
    provider: "azure",
    severity: "info",
    status: "ENUMERATED",
    resource: "azure://private-endpoints",
    title: `Private endpoints: ${items.length} deployed`,
    details: `Covered resource types: ${[...coveredResources].join(", ") || "none"}`,
    remediation: "Ensure all data-plane services use private endpoints",
  })

  return { output: output.join("\n"), findings }
}

export async function serviceFabricEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Service Fabric clusters...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const clusters = await az(["sf", "cluster", "list", ...rgArgs], sub, timeout)
  if (clusters.exitCode !== 0)
    return { output: output.join("\n") + "[-] Cannot list Service Fabric clusters", findings }

  const items = tryJson(clusters.stdout) || []
  output.push(`[+] Service Fabric clusters: ${items.length}\n`)

  for (const c of items) {
    output.push(`── ${c.name} (${c.resourceGroup}) ──`)
    output.push(`    Endpoint: ${c.managementEndpoint || "N/A"}`)
    output.push(`    Reliability: ${c.reliabilityLevel}`)
    output.push(`    Upgrade mode: ${c.upgradeMode}`)
    output.push(`    VM image: ${c.vmImage}`)

    const nodeTypes = c.nodeTypes || []
    output.push(`    Node types: ${nodeTypes.length}`)
    for (const nt of nodeTypes) {
      output.push(`      ${nt.name} — instances: ${nt.vmInstanceCount}, primary: ${nt.isPrimary}`)
      if (nt.httpGatewayEndpointPort) output.push(`        HTTP gateway port: ${nt.httpGatewayEndpointPort}`)
    }

    if (c.certificate) {
      output.push(`    [!] Cluster cert thumbprint: ${c.certificate.thumbprint}`)
    }

    findings.push({
      checkId: "AZ-SF-001",
      provider: "azure",
      severity: "info",
      status: "ENUMERATED",
      resource: `sf://${c.name}`,
      title: `Service Fabric cluster: ${c.name}`,
      details: `Management endpoint: ${c.managementEndpoint}, ${nodeTypes.length} node types`,
      remediation: "Ensure cluster certificate is stored in Key Vault, enable AAD authentication",
    })
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function batchAccountEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure Batch accounts...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const accounts = await az(["batch", "account", "list", ...rgArgs], sub, timeout)
  if (accounts.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Batch accounts", findings }

  const items = tryJson(accounts.stdout) || []
  output.push(`[+] Batch accounts: ${items.length}\n`)

  for (const acct of items) {
    output.push(`── ${acct.name} (${acct.resourceGroup}) ──`)
    output.push(`    Endpoint: ${acct.accountEndpoint}`)
    output.push(`    Pool allocation: ${acct.poolAllocationMode}`)
    output.push(`    Auth mode: ${acct.allowedAuthenticationModes?.join(", ") || "default"}`)
    output.push(`    Public access: ${acct.publicNetworkAccess || "enabled"}`)

    if (acct.publicNetworkAccess !== "Disabled") {
      findings.push({
        checkId: "AZ-BATCH-003",
        provider: "azure",
        severity: "medium",
        status: "WARN",
        resource: `batch://${acct.name}`,
        title: `Batch account public access enabled: ${acct.name}`,
        details: `Pool allocation: ${acct.poolAllocationMode}, endpoint: ${acct.accountEndpoint}`,
        remediation: "Disable public network access, use private endpoints",
      })
    }

    const keys = await az(
      ["batch", "account", "keys", "list", "--name", acct.name, "--resource-group", acct.resourceGroup || rg || ""],
      sub,
      15,
    )
    if (keys.exitCode === 0) {
      const keyData = tryJson(keys.stdout)
      if (keyData) {
        output.push(`    [!] Primary key: ${keyData.primary?.substring(0, 16)}...`)
        findings.push({
          checkId: "AZ-BATCH-002",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `batch://${acct.name}/keys`,
          title: `Batch account keys extracted: ${acct.name}`,
          details: "Shared key authentication — full account access",
          remediation: "Rotate keys, use AAD authentication, disable shared key auth",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function managedEnvEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Container Apps managed environments...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const envs = await az(["containerapp", "env", "list", ...rgArgs], sub, timeout)
  if (envs.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list managed environments", findings }

  const items = tryJson(envs.stdout) || []
  output.push(`[+] Managed environments: ${items.length}\n`)

  for (const env of items) {
    output.push(`── ${env.name} (${env.resourceGroup}) ──`)
    output.push(`    Default domain: ${env.properties?.defaultDomain || env.defaultDomain || "N/A"}`)
    output.push(`    Static IP: ${env.properties?.staticIp || env.staticIp || "N/A"}`)
    output.push(`    Internal: ${env.properties?.vnetConfiguration?.internal || false}`)
    output.push(`    Zone redundant: ${env.properties?.zoneRedundant || false}`)

    const apps = await az(["containerapp", "list", "--environment", env.id || env.name, ...rgArgs], sub, 30)
    if (apps.exitCode === 0) {
      const appList = tryJson(apps.stdout) || []
      output.push(`    Container apps: ${appList.length}`)
      for (const app of appList.slice(0, 10)) {
        const ingress = app.properties?.configuration?.ingress || app.configuration?.ingress
        output.push(
          `      ${app.name} — external: ${ingress?.external || false}, target: ${ingress?.targetPort || "?"}`,
        )
        if (ingress?.external) {
          findings.push({
            checkId: "AZ-CAPP-001",
            provider: "azure",
            severity: "medium",
            status: "INFO",
            resource: `containerapp://${app.name}`,
            title: `External container app: ${app.name}`,
            details: `Publicly accessible on port ${ingress.targetPort}`,
            remediation: "Review if external access is required, configure IP restrictions",
          })
        }
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function staticWebAppEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Static Web Apps...\n"]

  const rgArgs = rg ? ["--resource-group", rg] : []
  const apps = await az(["staticwebapp", "list", ...rgArgs], sub, timeout)
  if (apps.exitCode !== 0) return { output: output.join("\n") + "[-] Cannot list Static Web Apps", findings }

  const items = tryJson(apps.stdout) || []
  output.push(`[+] Static Web Apps: ${items.length}\n`)

  for (const app of items) {
    output.push(`── ${app.name} (${app.resourceGroup}) ──`)
    output.push(`    URL: ${app.defaultHostname || "N/A"}`)
    output.push(`    SKU: ${app.sku?.name || "Free"}`)
    output.push(`    Repo: ${app.repositoryUrl || "N/A"}`)
    output.push(`    Branch: ${app.branch || "N/A"}`)
    output.push(`    Custom domains: ${app.customDomains?.length || 0}`)

    if (app.repositoryUrl) {
      findings.push({
        checkId: "AZ-SWA-001",
        provider: "azure",
        severity: "info",
        status: "ENUMERATED",
        resource: `swa://${app.name}`,
        title: `Static Web App: ${app.name}`,
        details: `Hosted at ${app.defaultHostname}, source: ${app.repositoryUrl} (${app.branch})`,
        remediation: "Ensure auth is configured, review linked backends",
      })
    }

    const secrets = await az(["staticwebapp", "secrets", "list", "--name", app.name], sub, 15)
    if (secrets.exitCode === 0) {
      const secretData = tryJson(secrets.stdout)
      if (secretData?.properties?.apiKey) {
        output.push(`    [!] Deployment token: ${secretData.properties.apiKey.substring(0, 16)}...`)
        findings.push({
          checkId: "AZ-SWA-002",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `swa://${app.name}/secrets`,
          title: `Static Web App deployment token extracted: ${app.name}`,
          details: "Deployment token allows publishing content to the app",
          remediation: "Rotate deployment token, restrict access to deployment pipeline",
        })
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}
