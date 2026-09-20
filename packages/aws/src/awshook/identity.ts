import { aws, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

function extractPrincipals(principal: unknown): string[] {
  if (!principal) return []
  if (typeof principal === "string") return [principal]
  if (typeof principal === "object" && principal !== null) {
    const result: string[] = []
    for (const v of Object.values(principal)) {
      if (typeof v === "string") result.push(v)
      if (Array.isArray(v)) result.push(...v.filter((s): s is string => typeof s === "string"))
    }
    return result
  }
  return []
}

export async function iamDeepAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Deep IAM audit — inline policies, wildcards, unused...\n"]

  const users = await aws(["iam", "list-users", "--query", "Users[].[UserName,CreateDate,PasswordLastUsed]"], profile, region, timeout)
  const userList = tryJson(users.stdout) || []
  output.push(`[+] IAM Users: ${userList.length}`)

  for (const u of userList) {
    const name = u[0]

    const inline = await aws(["iam", "list-user-policies", "--user-name", name, "--query", "PolicyNames"], profile, region, timeout)
    const inlinePolicies = tryJson(inline.stdout) || []
    if (inlinePolicies.length > 0) {
      output.push(`[!] ${name}: ${inlinePolicies.length} inline policies (should use managed)`)
      for (const pName of inlinePolicies) {
        const pol = await aws(["iam", "get-user-policy", "--user-name", name, "--policy-name", pName], profile, region, timeout)
        const doc = tryJson(pol.stdout)?.PolicyDocument || {}
        const stmts = doc.Statement || []
        for (const s of stmts) {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
          const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource]
          if (s.Effect === "Allow" && actions.includes("*") && resources.includes("*")) {
            findings.push({ checkId: "AWS-IAM-DEEP-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://user/${name}/policy/${pName}`, title: `User ${name} has inline policy with Action:* Resource:*`, details: `Policy ${pName} grants full admin via inline policy`, remediation: `Remove inline policy ${pName} from user ${name}` })
          }
        }
      }
    }

    const keys = await aws(["iam", "list-access-keys", "--user-name", name, "--query", "AccessKeyMetadata[?Status=='Active']"], profile, region, timeout)
    const activeKeys = tryJson(keys.stdout) || []
    for (const k of activeKeys) {
      const created = new Date(k.CreateDate).getTime()
      const age = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24))
      if (age > 90) {
        findings.push({ checkId: "CIS-AWS-1.14", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `iam://user/${name}/key/${k.AccessKeyId}`, title: `Access key ${k.AccessKeyId.slice(0, 8)}... is ${age} days old`, details: `User: ${name}, created: ${k.CreateDate}`, remediation: "Rotate access keys older than 90 days" })
      }

      const lastUsed = await aws(["iam", "get-access-key-last-used", "--access-key-id", k.AccessKeyId], profile, region, timeout)
      const lu = tryJson(lastUsed.stdout)?.AccessKeyLastUsed || {}
      if (!lu.LastUsedDate) {
        findings.push({ checkId: "AWS-IAM-DEEP-002", provider: "aws", severity: "medium", status: "FAIL", resource: `iam://user/${name}/key/${k.AccessKeyId}`, title: `Access key ${k.AccessKeyId.slice(0, 8)}... has never been used`, details: `User: ${name}, age: ${age} days — likely forgotten`, remediation: `Deactivate: aws iam update-access-key --user-name ${name} --access-key-id ${k.AccessKeyId} --status Inactive` })
      }
    }

    if (u[2] === null && activeKeys.length === 0) {
      findings.push({ checkId: "AWS-IAM-DEEP-003", provider: "aws", severity: "low", status: "FAIL", resource: `iam://user/${name}`, title: `User ${name} has no console or API access`, details: "No password, no active keys — orphaned account", remediation: `Delete unused user: aws iam delete-user --user-name ${name}` })
    }
  }

  // ── Role deep analysis ──
  const id = await aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile, region, timeout)
  const ownAccount = id.stdout.trim()
  const rolesRes = await aws(["iam", "list-roles", "--max-items", "200"], profile, region, timeout)
  const roleList = tryJson(rolesRes.stdout)?.Roles || []
  output.push(`\n[*] IAM Roles: ${roleList.length}`)

  let adminRoles = 0
  let unusedRoles = 0
  let dangerousTrust = 0

  for (const role of roleList) {
    const rName = role.RoleName as string
    if ((role.Path as string || "").startsWith("/aws-service-role/")) continue

    // Inline policies — check for Action:* Resource:*
    const inlineRes = await aws(["iam", "list-role-policies", "--role-name", rName, "--query", "PolicyNames"], profile, region, timeout)
    const inlinePols = tryJson(inlineRes.stdout) || []
    for (const pName of inlinePols) {
      const pol = await aws(["iam", "get-role-policy", "--role-name", rName, "--policy-name", pName as string], profile, region, timeout)
      const doc = tryJson(pol.stdout)?.PolicyDocument || {}
      const stmts = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement].filter(Boolean)
      for (const s of stmts) {
        if (s.Effect !== "Allow") continue
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
        const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource]
        if (actions.includes("*") && resources.includes("*")) {
          adminRoles++
          output.push(`[!] ${rName}: inline policy ${pName} grants Action:* Resource:*`)
          findings.push({ checkId: "AWS-IDENTITY-ROLE-DEEP-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://role/${rName}/inline/${pName}`, title: `Role ${rName} has admin-level inline policy ${pName}`, details: `Inline policy with Action:* Resource:* — full account admin`, remediation: `Replace inline policy with least-privilege managed policy` })
        }
      }
    }

    // Managed policies — inspect actual policy document for wildcards
    const attachedRes = await aws(["iam", "list-attached-role-policies", "--role-name", rName, "--query", "AttachedPolicies[].[PolicyName,PolicyArn]"], profile, region, timeout)
    const attachedPols = tryJson(attachedRes.stdout) || []
    for (const ap of attachedPols) {
      const polArn = ap[1] as string
      const polName = ap[0] as string
      // Skip AWS-managed AdministratorAccess — already obvious
      if (polArn.startsWith("arn:aws:iam::aws:policy/AdministratorAccess")) {
        adminRoles++
        output.push(`[!] ${rName}: AdministratorAccess managed policy attached`)
        findings.push({ checkId: "AWS-IDENTITY-ROLE-DEEP-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://role/${rName}`, title: `Role ${rName} has AdministratorAccess`, details: `AWS-managed AdministratorAccess attached — full account admin`, remediation: `Detach AdministratorAccess and replace with scoped policy` })
        continue
      }
      // Check customer-managed policies for hidden admin
      if (!polArn.startsWith("arn:aws:iam::aws:policy/")) {
        const verRes = await aws(["iam", "get-policy", "--policy-arn", polArn, "--query", "Policy.DefaultVersionId", "--output", "text"], profile, region, timeout)
        const verId = verRes.stdout.trim()
        if (verId) {
          const polDoc = await aws(["iam", "get-policy-version", "--policy-arn", polArn, "--version-id", verId, "--query", "PolicyVersion.Document"], profile, region, timeout)
          const doc = tryJson(polDoc.stdout) || {}
          const stmts = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement].filter(Boolean)
          for (const s of stmts) {
            if (s.Effect !== "Allow") continue
            const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
            const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource]
            if (actions.includes("*") && resources.includes("*")) {
              adminRoles++
              output.push(`[!] ${rName}: managed policy ${polName} grants Action:* Resource:*`)
              findings.push({ checkId: "AWS-IDENTITY-ROLE-DEEP-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://role/${rName}/managed/${polName}`, title: `Role ${rName}: policy ${polName} grants full admin`, details: `Customer-managed policy with Action:* Resource:* — hidden admin`, remediation: `Audit and scope down policy ${polName}` })
            }
          }
        }
      }
    }

    // Trust policy — wildcard or cross-account without ExternalId
    const stmts = role.AssumeRolePolicyDocument?.Statement || []
    for (const stmt of stmts) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      for (const p of principals) {
        if (p === "*") {
          dangerousTrust++
          findings.push({ checkId: "AWS-IDENTITY-ROLE-DEEP-003", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://role/${rName}`, title: `Role ${rName} trust policy has Principal:*`, details: `Any entity can assume this role — wildcard trust`, remediation: `Restrict trust policy to specific accounts/services` })
        }
        const acctMatch = p.match(/^arn:aws:iam::(\d+):/)
        if (acctMatch && acctMatch[1] !== ownAccount) {
          const hasExtId = stmt.Condition?.StringEquals?.["sts:ExternalId"]
          if (!hasExtId) {
            dangerousTrust++
            findings.push({ checkId: "AWS-IDENTITY-ROLE-DEEP-003", provider: "aws", severity: "high", status: "FAIL", resource: `iam://role/${rName}`, title: `Role ${rName} cross-account trust (${acctMatch[1]}) without ExternalId`, details: `Trusted account ${acctMatch[1]} can assume without ExternalId — confused deputy`, remediation: `Add sts:ExternalId condition to trust policy` })
          }
        }
      }
    }

    // Last used — flag roles unused >90 days
    const lastUsed = role.RoleLastUsed as Record<string, unknown> | undefined
    if (lastUsed?.LastUsedDate) {
      const lastDate = new Date(lastUsed.LastUsedDate as string).getTime()
      const age = Math.floor((Date.now() - lastDate) / (1000 * 60 * 60 * 24))
      if (age > 90) {
        unusedRoles++
        findings.push({ checkId: "AWS-IDENTITY-ROLE-DEEP-002", provider: "aws", severity: "medium", status: "FAIL", resource: `iam://role/${rName}`, title: `Role ${rName} unused for ${age} days`, details: `Last used: ${lastUsed.LastUsedDate} in ${lastUsed.LastUsedRegion || "unknown"} — stale role with active permissions`, remediation: `Review and delete unused role: aws iam delete-role --role-name ${rName}` })
      }
    } else {
      const created = new Date(role.CreateDate as string).getTime()
      const roleAge = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24))
      if (roleAge > 90) {
        unusedRoles++
        findings.push({ checkId: "AWS-IDENTITY-ROLE-DEEP-002", provider: "aws", severity: "medium", status: "FAIL", resource: `iam://role/${rName}`, title: `Role ${rName} never used (${roleAge} days old)`, details: `Created ${role.CreateDate}, never assumed — orphaned role`, remediation: `Delete unused role: aws iam delete-role --role-name ${rName}` })
      }
    }
  }

  output.push(`[+] Admin-level roles: ${adminRoles}`)
  output.push(`[+] Unused roles (>90d): ${unusedRoles}`)
  output.push(`[+] Dangerous trust policies: ${dangerousTrust}`)
  output.push(`\n[*] Summary: ${findings.length} IAM issues found (users + roles)`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListUsers, ListUserPolicies, ListAttachedUserPolicies, ListAccessKeys, GetAccessKeyLastUsed`)
  output.push(`  CloudTrail: ListRoles, ListRolePolicies, ListAttachedRolePolicies, ListPolicyVersions, GetPolicyVersion`)
  output.push(`  OPSEC: high-volume IAM enumeration — generates many events per user/role; unusual outside audit contexts`)

  return { output: output.join("\n"), findings }
}

export async function cognitoSecurityAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Cognito security configuration...\n"]

  const pools = await aws(["cognito-idp", "list-user-pools", "--max-results", "60"], profile, region, timeout)
  if (pools.exitCode !== 0) return { output: `[-] Failed to list Cognito pools: ${pools.stderr.trim()}`, findings }
  const poolList = tryJson(pools.stdout)?.UserPools || []
  output.push(`[+] User pools: ${poolList.length}`)

  for (const pool of poolList) {
    const detail = await aws(["cognito-idp", "describe-user-pool", "--user-pool-id", pool.Id], profile, region, timeout)
    const d = tryJson(detail.stdout)?.UserPool || {}
    output.push(`\n  Pool: ${d.Name} (${d.Id})`)
    output.push(`    MFA: ${d.MfaConfiguration}, Status: ${d.Status}`)
    output.push(`    PasswordPolicy: min=${d.Policies?.PasswordPolicy?.MinimumLength}, requireUpper=${d.Policies?.PasswordPolicy?.RequireUppercase}`)

    if (d.MfaConfiguration === "OFF") {
      findings.push({ checkId: "AWS-COGN-001", provider: "aws", severity: "high", status: "FAIL", resource: `cognito://${d.Id}`, title: `Cognito pool ${d.Name} has MFA disabled`, details: "No MFA requirement — account takeover risk", remediation: "Enable MFA: OPTIONAL at minimum, REQUIRED preferred" })
    }

    if ((d.Policies?.PasswordPolicy?.MinimumLength || 0) < 12) {
      findings.push({ checkId: "AWS-COGN-002", provider: "aws", severity: "medium", status: "FAIL", resource: `cognito://${d.Id}`, title: `Cognito pool ${d.Name} password minimum length ${d.Policies?.PasswordPolicy?.MinimumLength} < 12`, details: "Weak password policy", remediation: "Increase minimum password length to 12+" })
    }

    const clients = await aws(["cognito-idp", "list-user-pool-clients", "--user-pool-id", pool.Id, "--max-results", "20"], profile, region, timeout)
    const clientList = tryJson(clients.stdout)?.UserPoolClients || []
    for (const c of clientList) {
      const cd = await aws(["cognito-idp", "describe-user-pool-client", "--user-pool-id", pool.Id, "--client-id", c.ClientId], profile, region, timeout)
      const client = tryJson(cd.stdout)?.UserPoolClient || {}
      if (client.ExplicitAuthFlows?.includes("ALLOW_ADMIN_USER_PASSWORD_AUTH")) {
        findings.push({ checkId: "AWS-COGN-003", provider: "aws", severity: "medium", status: "FAIL", resource: `cognito://${d.Id}/client/${c.ClientId}`, title: `Client ${client.ClientName} allows admin password auth`, details: "ALLOW_ADMIN_USER_PASSWORD_AUTH enables server-side password auth without SRP", remediation: "Use ALLOW_USER_SRP_AUTH instead" })
      }
      if (!client.TokenValidityUnits && (client.AccessTokenValidity || 3600) > 3600) {
        findings.push({ checkId: "AWS-COGN-004", provider: "aws", severity: "low", status: "FAIL", resource: `cognito://${d.Id}/client/${c.ClientId}`, title: `Client ${client.ClientName} access token validity > 1 hour`, details: `Validity: ${client.AccessTokenValidity || "default"}`, remediation: "Reduce token validity to 1 hour or less" })
      }
    }
  }

  const idPools = await aws(["cognito-identity", "list-identity-pools", "--max-results", "60"], profile, region, timeout)
  const idPoolList = tryJson(idPools.stdout)?.IdentityPools || []
  output.push(`\n[+] Identity pools: ${idPoolList.length}`)

  for (const idPool of idPoolList) {
    const detail = await aws(["cognito-identity", "describe-identity-pool", "--identity-pool-id", idPool.IdentityPoolId], profile, region, timeout)
    const d = tryJson(detail.stdout) || {}
    output.push(`\n  Pool: ${d.IdentityPoolName} (${d.IdentityPoolId})`)
    output.push(`    AllowUnauthenticated: ${d.AllowUnauthenticatedIdentities}`)
    output.push(`    Providers: ${(d.CognitoIdentityProviders || []).length}, OIDC: ${Object.keys(d.OpenIdConnectProviderARNs || {}).length}, SAML: ${(d.SamlProviderARNs || []).length}`)

    if (d.AllowUnauthenticatedIdentities) {
      findings.push({ checkId: "AWS-COGN-005", provider: "aws", severity: "high", status: "FAIL", resource: `cognito-identity://${d.IdentityPoolId}`, title: `Identity pool ${d.IdentityPoolName} allows unauthenticated identities`, details: "Unauthenticated users can obtain AWS credentials — check role permissions", remediation: "Disable AllowUnauthenticatedIdentities or restrict unauth role to minimal permissions" })

      const roles = await aws(["cognito-identity", "get-identity-pool-roles", "--identity-pool-id", idPool.IdentityPoolId], profile, region, timeout)
      const roleData = tryJson(roles.stdout) || {}
      const unauthRoleArn = roleData.Roles?.unauthenticated
      if (unauthRoleArn) {
        const roleName = unauthRoleArn.split("/").pop() || ""
        output.push(`    Unauth role: ${roleName}`)

        const attached = await aws(["iam", "list-attached-role-policies", "--role-name", roleName, "--query", "AttachedPolicies[].PolicyName"], profile, region, timeout)
        const attachedPolicies = tryJson(attached.stdout) || []
        output.push(`    Unauth policies: ${attachedPolicies.join(", ") || "none"}`)

        const dangerousPolicies = ["AdministratorAccess", "PowerUserAccess", "AmazonS3FullAccess", "AmazonDynamoDBFullAccess"]
        for (const pol of attachedPolicies) {
          if (dangerousPolicies.includes(pol)) {
            findings.push({ checkId: "AWS-COGN-006", provider: "aws", severity: "critical", status: "FAIL", resource: `cognito-identity://${d.IdentityPoolId}/unauth-role`, title: `Unauth role for ${d.IdentityPoolName} has ${pol}`, details: `Unauthenticated users get ${pol} — full access without login`, remediation: `Remove ${pol} from unauthenticated role ${roleName}` })
          }
        }

        const inlinePolicies = await aws(["iam", "list-role-policies", "--role-name", roleName, "--query", "PolicyNames"], profile, region, timeout)
        const inlineList = tryJson(inlinePolicies.stdout) || []
        for (const polName of inlineList) {
          const polDoc = await aws(["iam", "get-role-policy", "--role-name", roleName, "--policy-name", polName], profile, region, timeout)
          const doc = tryJson(polDoc.stdout)?.PolicyDocument || {}
          const stmts = doc.Statement || []
          for (const s of stmts) {
            const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
            if (s.Effect === "Allow" && actions.includes("*")) {
              findings.push({ checkId: "AWS-COGN-006", provider: "aws", severity: "critical", status: "FAIL", resource: `cognito-identity://${d.IdentityPoolId}/unauth-role`, title: `Unauth role inline policy has Action:*`, details: `Inline policy ${polName} on unauth role grants full access`, remediation: `Scope down inline policy ${polName} on role ${roleName}` })
            }
          }
        }
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} Cognito issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListUserPools, DescribeUserPool, ListUserPoolClients, DescribeUserPoolClient`)
  output.push(`  CloudTrail: ListIdentityPools, DescribeIdentityPool, GetIdentityPoolRoles`)
  output.push(`  CloudTrail: ListAttachedRolePolicies, ListRolePolicies, GetRolePolicy (role enumeration)`)
  output.push(`  OPSEC: Cognito enumeration is low-signal in isolation but correlates with identity attack patterns`)

  return { output: output.join("\n"), findings }
}

export async function organizationPolicyEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Organization SCPs and policies...\n"]

  const org = await aws(["organizations", "describe-organization"], profile, region, timeout)
  if (org.exitCode !== 0) {
    output.push("[-] Not in an Organization or no access")
    return { output: output.join("\n"), findings }
  }
  const orgInfo = tryJson(org.stdout)?.Organization || {}
  output.push(`[+] Organization: ${orgInfo.Id}`)
  output.push(`    Master: ${orgInfo.MasterAccountId}`)
  output.push(`    FeatureSet: ${orgInfo.FeatureSet}`)

  if (orgInfo.FeatureSet !== "ALL") {
    findings.push({ checkId: "AWS-ORG-001", provider: "aws", severity: "medium", status: "FAIL", resource: `org://${orgInfo.Id}`, title: "Organization using consolidated billing only", details: "SCPs and other policy types are not available", remediation: "Enable all features in AWS Organizations" })
  }

  const policies = await aws(["organizations", "list-policies", "--filter", "SERVICE_CONTROL_POLICY"], profile, region, timeout)
  const scps = tryJson(policies.stdout)?.Policies || []
  output.push(`\n[+] SCPs: ${scps.length}`)

  for (const scp of scps) {
    output.push(`  ${scp.Name} (${scp.Id}) — ${scp.Description || "no description"}`)
    const content = await aws(["organizations", "describe-policy", "--policy-id", scp.Id, "--query", "Policy.Content"], profile, region, timeout)
    const doc = tryJson(tryJson(content.stdout) || "{}") || {}
    const stmts = doc.Statement || []
    const denyAll = stmts.some((s: Record<string, unknown>) => s.Effect === "Deny" && JSON.stringify(s.Action) === '"*"')
    if (denyAll) {
      output.push(`    [!] Contains Deny * statement`)
    }

    const targets = await aws(["organizations", "list-targets-for-policy", "--policy-id", scp.Id, "--query", "Targets[].[Name,TargetId,Type]"], profile, region, timeout)
    const targetList = tryJson(targets.stdout) || []
    output.push(`    Attached to: ${targetList.map((t: string[]) => `${t[0]} (${t[2]})`).join(", ") || "none"}`)
  }

  if (scps.length <= 1) {
    findings.push({ checkId: "AWS-ORG-002", provider: "aws", severity: "medium", status: "FAIL", resource: `org://${orgInfo.Id}`, title: "Only default SCP policy exists", details: "No guardrails beyond FullAWSAccess — member accounts are unrestricted", remediation: "Create SCPs to restrict dangerous actions (e.g., deny disabling CloudTrail, leaving org)" })
  }

  output.push(`\n[*] Summary: ${findings.length} organization issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeOrganization, ListPolicies, DescribePolicy, ListTargetsForPolicy`)
  output.push(`  GuardDuty: Recon:IAMUser/MaliciousIPCaller.Custom (Organizations enumeration from unusual source)`)
  output.push(`  OPSEC: Organizations API calls are management-account level — unusual from member accounts`)
  output.push(`  OPSEC: SCP enumeration reveals org security posture — high-value intel for attackers`)

  return { output: output.join("\n"), findings }
}

export async function passwordSprayAws(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] AWS IAM password spray assessment (non-destructive)...\n"]

  const users = await aws(["iam", "list-users", "--query", "Users[].UserName"], profile, region, timeout)
  const userList = tryJson(users.stdout) || []
  output.push(`[+] Total IAM users: ${userList.length}`)

  let consoleUsers = 0
  const consoleUserNames: string[] = []
  for (const user of userList) {
    const login = await aws(["iam", "get-login-profile", "--user-name", user], profile, region, timeout)
    if (login.exitCode === 0) {
      consoleUsers++
      consoleUserNames.push(user)
      const profile_ = tryJson(login.stdout)?.LoginProfile || {}
      if (profile_.PasswordResetRequired) {
        output.push(`[!] ${user}: password reset required (temporary password may be predictable)`)
        findings.push({ checkId: "AWS-SPRAY-001", provider: "aws", severity: "medium", status: "FAIL", resource: `iam://user/${user}`, title: `User ${user} has pending password reset`, details: "Temporary passwords are often weak or follow patterns", remediation: "Ensure user completes password reset with strong password" })
      }
    }
  }

  output.push(`\n[+] Console-enabled users: ${consoleUsers}/${userList.length}`)
  if (consoleUsers > 0) {
    output.push(`[*] Console users: ${consoleUserNames.slice(0, 20).join(", ")}${consoleUserNames.length > 20 ? "..." : ""}`)
  }

  output.push(`\n[*] Note: Actual password spraying requires explicit authorization`)
  output.push(`[*] Common patterns to test: CompanyName2024!, Welcome1, Password123, Seasonal+Year`)
  output.push(`[*] Console login URL: https://<account-id>.signin.aws.amazon.com/console`)

  output.push(`\n[*] Summary: ${consoleUsers} targets identified, ${findings.length} issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListUsers, GetLoginProfile (per user — N events for N users)`)
  output.push(`  GuardDuty: UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B (brute force/spray detection)`)
  output.push(`  OPSEC: GetLoginProfile per-user enumeration is HIGH signal — bulk enumeration unusual outside audit`)
  output.push(`  OPSEC: actual password spray generates many failed ConsoleLogin events in us-east-1 CloudTrail — trivially detectable`)

  return { output: output.join("\n"), findings }
}

// ── New Identity Analysis Functions ──

export async function identitySummary(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Identity landscape summary...\n"]

  const summary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  if (summary.exitCode !== 0) return { output: `[-] Failed to get account summary: ${summary.stderr.trim()}`, findings }
  const sum = tryJson(summary.stdout)?.SummaryMap || {}
  output.push("[+] Account Summary:")
  output.push(`    Users: ${sum.Users || 0}, Groups: ${sum.Groups || 0}, Roles: ${sum.Roles || 0}`)
  output.push(`    Policies: ${sum.Policies || 0}, InstanceProfiles: ${sum.InstanceProfiles || 0}`)
  output.push(`    MFADevices: ${sum.MFADevicesInUse || 0}, AccountMFA: ${sum.AccountMFAEnabled === 1 ? "enabled" : "DISABLED"}`)
  output.push(`    ServerCertificates: ${sum.ServerCertificates || 0}`)

  const users = await aws(["iam", "list-users", "--query", "Users[].[UserName,CreateDate,PasswordLastUsed]"], profile, region, timeout)
  const userList = tryJson(users.stdout) || []
  output.push(`\n[+] IAM Users: ${userList.length}`)
  for (const u of userList.slice(0, 15)) {
    output.push(`  ${u[0]} — created: ${u[1]}, lastLogin: ${u[2] || "never"}`)
  }
  if (userList.length > 15) output.push(`  ... and ${userList.length - 15} more`)

  const roles = await aws(["iam", "list-roles", "--query", "Roles[].RoleName"], profile, region, timeout)
  const roleList = tryJson(roles.stdout) || []
  output.push(`\n[+] IAM Roles: ${roleList.length}`)

  const groups = await aws(["iam", "list-groups", "--query", "Groups[].GroupName"], profile, region, timeout)
  const groupList = tryJson(groups.stdout) || []
  output.push(`[+] IAM Groups: ${groupList.length}`)

  const oidc = await aws(["iam", "list-open-id-connect-providers", "--query", "OpenIDConnectProviderList[].Arn"], profile, region, timeout)
  const oidcList = tryJson(oidc.stdout) || []
  output.push(`[+] OIDC Providers: ${oidcList.length}`)

  const saml = await aws(["iam", "list-saml-providers", "--query", "SAMLProviderList[].Arn"], profile, region, timeout)
  const samlList = tryJson(saml.stdout) || []
  output.push(`[+] SAML Providers: ${samlList.length}`)

  const sso = await aws(["sso-admin", "list-instances"], profile, region, timeout)
  const ssoInstances = tryJson(sso.stdout)?.Instances || []
  output.push(`[+] SSO Instances: ${ssoInstances.length}`)

  if (sum.AccountMFAEnabled !== 1) {
    findings.push({ checkId: "AWS-IDENT-001", provider: "aws", severity: "critical", status: "FAIL", resource: "iam://root", title: "Root account MFA not enabled", details: "Root has unrestricted access — MFA is mandatory", remediation: "Enable hardware MFA for root account" })
  }

  const noMfaCount = (sum.Users || 0) - (sum.MFADevicesInUse || 0)
  if (noMfaCount > 0) {
    findings.push({ checkId: "AWS-IDENT-001", provider: "aws", severity: "high", status: "FAIL", resource: "iam://users/mfa", title: `${noMfaCount} users potentially without MFA`, details: `${sum.Users} users, ${sum.MFADevicesInUse || 0} MFA devices in use`, remediation: "Enable MFA for all IAM users with console access" })
  }

  output.push(`\n[*] Landscape: ${userList.length} users, ${roleList.length} roles, ${groupList.length} groups, ${oidcList.length} OIDC, ${samlList.length} SAML, ${ssoInstances.length} SSO`)
  output.push(`[*] Summary: ${findings.length} identity issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetAccountSummary, ListUsers, ListRoles, ListGroups, ListOpenIDConnectProviders, ListSAMLProviders`)
  output.push(`  CloudTrail: ListInstances (SSO)`)
  output.push(`  OPSEC: broad IAM enumeration — generates events across multiple IAM subsystems in a single sweep`)

  return { output: output.join("\n"), findings }
}

export async function roleTrustAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing IAM role trust policies...\n"]

  const id = await aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile, region, timeout)
  const ownAccount = id.stdout.trim()

  const roles = await aws(["iam", "list-roles", "--max-items", "200"], profile, region, timeout)
  if (roles.exitCode !== 0) return { output: `[-] Failed to list roles: ${roles.stderr.trim()}`, findings }
  const roleList = tryJson(roles.stdout)?.Roles || []
  output.push(`[+] Total roles: ${roleList.length}`)

  let wildcardCount = 0
  let crossAccountCount = 0
  let unusualServiceCount = 0
  let confusedDeputyCount = 0
  const knownServices = new Set([
    "ec2.amazonaws.com", "lambda.amazonaws.com", "ecs-tasks.amazonaws.com", "eks.amazonaws.com",
    "rds.amazonaws.com", "s3.amazonaws.com", "cloudformation.amazonaws.com", "codebuild.amazonaws.com",
    "codepipeline.amazonaws.com", "glue.amazonaws.com", "sagemaker.amazonaws.com", "states.amazonaws.com",
    "events.amazonaws.com", "ssm.amazonaws.com", "elasticmapreduce.amazonaws.com", "firehose.amazonaws.com",
    "logs.amazonaws.com", "monitoring.amazonaws.com", "autoscaling.amazonaws.com", "application-autoscaling.amazonaws.com",
    "elasticloadbalancing.amazonaws.com", "config.amazonaws.com", "guardduty.amazonaws.com",
  ])

  for (const role of roleList) {
    if (role.Path === "/aws-service-role/") continue
    const statements = role.AssumeRolePolicyDocument?.Statement || []
    for (const stmt of statements) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)

      for (const p of principals) {
        if (p === "*") {
          wildcardCount++
          output.push(`[!] ${role.RoleName}: Principal:* — any entity can assume`)
          findings.push({ checkId: "AWS-RTRUST-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://role/${role.RoleName}`, title: `Role ${role.RoleName} has wildcard trust (Principal:*)`, details: "Any AWS principal can assume this role — extremely dangerous", remediation: "Restrict AssumeRolePolicyDocument to specific accounts/services/users" })
        }

        const acctMatch = p.match(/^arn:aws:iam::(\d+):/)
        if (acctMatch && acctMatch[1] !== ownAccount) {
          crossAccountCount++
          const hasExternalId = stmt.Condition?.StringEquals?.["sts:ExternalId"]
          output.push(`[!] ${role.RoleName}: cross-account trust to ${acctMatch[1]}${hasExternalId ? " (ExternalId)" : " (NO ExternalId)"}`)
          findings.push({ checkId: "AWS-RTRUST-002", provider: "aws", severity: "high", status: "FAIL", resource: `iam://role/${role.RoleName}`, title: `Role ${role.RoleName} trusts external account ${acctMatch[1]}`, details: `Cross-account trust${hasExternalId ? " with ExternalId condition" : " WITHOUT ExternalId — confused deputy risk"}`, remediation: hasExternalId ? "Verify external account ownership" : "Add sts:ExternalId condition to trust policy" })
        }

        if (p.endsWith(".amazonaws.com")) {
          if (!knownServices.has(p)) {
            unusualServiceCount++
            output.push(`[?] ${role.RoleName}: unusual service principal ${p}`)
            findings.push({ checkId: "AWS-RTRUST-003", provider: "aws", severity: "low", status: "FAIL", resource: `iam://role/${role.RoleName}`, title: `Role ${role.RoleName} trusts unusual service: ${p}`, details: "Service principal not in common set — verify legitimacy", remediation: "Review if this service principal is expected" })
          }

          const conditions = stmt.Condition || {}
          const conditionKeys = new Set<string>()
          for (const op of Object.values(conditions) as Record<string, unknown>[]) {
            for (const key of Object.keys(op)) conditionKeys.add(key)
          }
          const hasSourceGuard = conditionKeys.has("aws:SourceAccount") || conditionKeys.has("aws:SourceArn") || conditionKeys.has("aws:SourceOrgID") || conditionKeys.has("aws:CalledVia") || conditionKeys.has("aws:ViaAWSService")
          if (!hasSourceGuard) {
            confusedDeputyCount++
            const attached = await aws(["iam", "list-attached-role-policies", "--role-name", role.RoleName, "--query", "AttachedPolicies[].PolicyName"], profile, region, timeout)
            const policies = tryJson(attached.stdout) || []
            const isHighPriv = policies.some((pol: string) => /AdministratorAccess|PowerUserAccess|FullAccess/.test(pol))
            const severity = isHighPriv ? "critical" : "high"
            output.push(`[!] ${role.RoleName}: confused deputy — trusts ${p} without source conditions${isHighPriv ? " [HIGH-PRIV]" : ""}`)
            findings.push({ checkId: "AWS-RTRUST-004", provider: "aws", severity, status: "FAIL", resource: `iam://role/${role.RoleName}`, title: `Role ${role.RoleName} vulnerable to confused deputy (${p})`, details: `Service ${p} trusted without aws:SourceAccount/SourceArn/SourceOrgID. Policies: ${policies.join(", ") || "none"}.${isHighPriv ? " HIGH-PRIVILEGE — attacker in another account can exploit." : ""}`, remediation: `Add Condition: {"StringEquals": {"aws:SourceAccount": "${ownAccount}"}} to trust policy`, cwe: "CWE-441" })
          }
        }
      }
    }
  }

  output.push(`\n[+] Wildcard: ${wildcardCount}, Cross-account: ${crossAccountCount}, Unusual services: ${unusualServiceCount}, Confused deputy: ${confusedDeputyCount}`)
  output.push(`[*] Summary: ${findings.length} trust policy issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetCallerIdentity, ListRoles, ListAttachedRolePolicies`)
  output.push(`  OPSEC: ListRoles + per-role policy enumeration generates many events — correlates with privilege escalation recon`)

  return { output: output.join("\n"), findings }
}

export async function serviceLinkedRoles(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Analyzing service-linked roles...\n"]

  const roles = await aws(["iam", "list-roles", "--path-prefix", "/aws-service-role/"], profile, region, timeout)
  if (roles.exitCode !== 0) return { output: `[-] Failed to list roles: ${roles.stderr.trim()}`, findings }
  const roleList = tryJson(roles.stdout)?.Roles || []
  output.push(`[+] Service-linked roles: ${roleList.length}`)

  const serviceMap = new Map<string, string[]>()
  for (const role of roleList) {
    const pathParts = role.Path.split("/").filter(Boolean)
    const svcName = pathParts.length >= 2 ? pathParts[1] : "unknown"
    if (!serviceMap.has(svcName)) serviceMap.set(svcName, [])
    serviceMap.get(svcName)!.push(role.RoleName)
  }

  output.push(`\n[+] Services using linked roles: ${serviceMap.size}`)
  for (const [svc, names] of serviceMap) {
    output.push(`  ${svc}: ${names.join(", ")}`)
  }

  let unusedCount = 0
  for (const role of roleList.slice(0, 30)) {
    const detail = await aws(["iam", "get-role", "--role-name", role.RoleName, "--query", "Role.{LastUsed:RoleLastUsed,MaxSession:MaxSessionDuration}"], profile, region, timeout)
    const d = tryJson(detail.stdout) || {}
    const lastUsed = d.LastUsed?.LastUsedDate
    if (!lastUsed) {
      unusedCount++
      if (unusedCount <= 5) output.push(`[?] ${role.RoleName}: never used`)
    } else {
      const age = Math.floor((Date.now() - new Date(lastUsed).getTime()) / (1000 * 60 * 60 * 24))
      if (age > 180) {
        unusedCount++
        if (unusedCount <= 10) output.push(`[?] ${role.RoleName}: last used ${age} days ago`)
      }
    }

    const attached = await aws(["iam", "list-attached-role-policies", "--role-name", role.RoleName, "--query", "AttachedPolicies[].PolicyName"], profile, region, timeout)
    const policies = tryJson(attached.stdout) || []
    if (policies.length > 0) {
      output.push(`    Policies: ${policies.join(", ")}`)
    }
  }

  if (unusedCount > 0) {
    findings.push({ checkId: "AWS-SLR-001", provider: "aws", severity: "low", status: "FAIL", resource: "iam://service-linked-roles", title: `${unusedCount} service-linked roles unused or stale`, details: "Service-linked roles not used in 180+ days may indicate disabled services", remediation: "Review and delete unused service-linked roles via their owning service" })
  }

  output.push(`\n[*] Summary: ${roleList.length} SLRs, ${unusedCount} stale, ${findings.length} issues`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListRoles, GetRole, ListAttachedRolePolicies`)
  output.push(`  OPSEC: SLR enumeration is low-signal — looks like routine compliance scanning`)

  return { output: output.join("\n"), findings }
}

export async function iamAccessLastUsed(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Analyzing IAM service last accessed details...\n"]

  const roles = await aws(["iam", "list-roles", "--query", "Roles[?Path!='/aws-service-role/'].[RoleName,Arn]", "--max-items", "50"], profile, region, timeout)
  if (roles.exitCode !== 0) return { output: `[-] Failed to list roles: ${roles.stderr.trim()}`, findings }
  const roleList = tryJson(roles.stdout) || []
  output.push(`[+] Analyzing top ${Math.min(roleList.length, 15)} non-service-linked roles...\n`)

  for (const role of roleList.slice(0, 15)) {
    const roleName = role[0]
    const roleArn = role[1]

    const gen = await aws(["iam", "generate-service-last-accessed-details", "--arn", roleArn], profile, region, timeout)
    if (gen.exitCode !== 0) continue
    const jobId = tryJson(gen.stdout)?.JobId
    if (!jobId) continue

    // Wait briefly for job completion
    let details = null
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise((r) => setTimeout(r, 1000))
      const result = await aws(["iam", "get-service-last-accessed-details", "--job-id", jobId], profile, region, timeout)
      const parsed = tryJson(result.stdout)
      if (parsed?.JobStatus === "COMPLETED") {
        details = parsed
        break
      }
    }
    if (!details) continue

    const services = details.ServicesLastAccessed || []
    const neverAccessed = services.filter((s: Record<string, unknown>) => !s.LastAuthenticated)
    const totalServices = services.length

    output.push(`[+] ${roleName}: ${totalServices} service permissions, ${neverAccessed.length} never accessed`)

    if (neverAccessed.length > totalServices * 0.7 && totalServices > 5) {
      findings.push({ checkId: "AWS-ACCESSLAST-001", provider: "aws", severity: "medium", status: "FAIL", resource: `iam://role/${roleName}`, title: `Role ${roleName} has ${neverAccessed.length}/${totalServices} unused service permissions`, details: `${Math.round((neverAccessed.length / totalServices) * 100)}% of granted services never accessed — overprivileged`, remediation: `Scope down role ${roleName} to only used services: ${services.filter((s: Record<string, unknown>) => s.LastAuthenticated).map((s: Record<string, string>) => s.ServiceNamespace).slice(0, 10).join(", ")}` })
    }

    if (neverAccessed.length > 5) {
      const neverList = neverAccessed.slice(0, 8).map((s: Record<string, string>) => s.ServiceNamespace)
      output.push(`    Never accessed: ${neverList.join(", ")}${neverAccessed.length > 8 ? "..." : ""}`)
    }
  }

  output.push(`\n[*] Summary: ${findings.length} overprivileged roles found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListRoles, GenerateServiceLastAccessedDetails, GetServiceLastAccessedDetails`)
  output.push(`  OPSEC: GenerateServiceLastAccessedDetails is moderate signal — per-role access analysis unusual outside compliance tools`)

  return { output: output.join("\n"), findings }
}

export async function identityProviderEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating identity providers (OIDC + SAML)...\n"]

  // OIDC providers
  const oidc = await aws(["iam", "list-open-id-connect-providers"], profile, region, timeout)
  const oidcList = tryJson(oidc.stdout)?.OpenIDConnectProviderList || []
  output.push(`[+] OIDC Providers: ${oidcList.length}`)

  for (const provider of oidcList) {
    const detail = await aws(["iam", "get-open-id-connect-provider", "--open-id-connect-provider-arn", provider.Arn], profile, region, timeout)
    const d = tryJson(detail.stdout) || {}
    output.push(`\n  OIDC: ${provider.Arn}`)
    output.push(`    URL: ${d.Url}`)
    output.push(`    ClientIDs: ${(d.ClientIDList || []).join(", ") || "none"}`)
    output.push(`    Thumbprints: ${(d.ThumbprintList || []).length}`)
    output.push(`    Created: ${d.CreateDate}`)

    if ((d.ThumbprintList || []).length === 0) {
      findings.push({ checkId: "AWS-IDP-001", provider: "aws", severity: "medium", status: "FAIL", resource: `oidc://${d.Url || provider.Arn}`, title: `OIDC provider ${d.Url || "unknown"} has no thumbprints`, details: "Missing certificate thumbprint validation", remediation: "Add valid thumbprint for the OIDC provider's TLS certificate" })
    }
  }

  // SAML providers
  const saml = await aws(["iam", "list-saml-providers"], profile, region, timeout)
  const samlList = tryJson(saml.stdout)?.SAMLProviderList || []
  output.push(`\n[+] SAML Providers: ${samlList.length}`)

  for (const provider of samlList) {
    const detail = await aws(["iam", "get-saml-provider", "--saml-provider-arn", provider.Arn], profile, region, timeout)
    const d = tryJson(detail.stdout) || {}
    const name = provider.Arn.split("/").pop() || "unknown"
    output.push(`\n  SAML: ${name}`)
    output.push(`    ARN: ${provider.Arn}`)
    output.push(`    Created: ${d.CreateDate}, ValidUntil: ${d.ValidUntil || "unknown"}`)

    if (d.ValidUntil) {
      const expiry = new Date(d.ValidUntil).getTime()
      const daysUntilExpiry = Math.floor((expiry - Date.now()) / (1000 * 60 * 60 * 24))
      if (daysUntilExpiry < 0) {
        findings.push({ checkId: "AWS-IDP-002", provider: "aws", severity: "high", status: "FAIL", resource: `saml://${name}`, title: `SAML provider ${name} certificate EXPIRED (${Math.abs(daysUntilExpiry)} days ago)`, details: `ValidUntil: ${d.ValidUntil} — federation login will fail`, remediation: "Update SAML metadata with renewed certificate" })
      } else if (daysUntilExpiry < 30) {
        findings.push({ checkId: "AWS-IDP-002", provider: "aws", severity: "medium", status: "FAIL", resource: `saml://${name}`, title: `SAML provider ${name} certificate expires in ${daysUntilExpiry} days`, details: `ValidUntil: ${d.ValidUntil}`, remediation: "Renew SAML certificate before expiry" })
      }
      output.push(`    Expires in: ${daysUntilExpiry} days${daysUntilExpiry < 0 ? " (EXPIRED!)" : ""}`)
    }
  }

  output.push(`\n[*] Summary: ${oidcList.length} OIDC, ${samlList.length} SAML, ${findings.length} issues`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListOpenIDConnectProviders, GetOpenIDConnectProvider, ListSAMLProviders, GetSAMLProvider`)
  output.push(`  OPSEC: IdP enumeration is low-signal — standard audit activity; but reveals federation configuration for token forging attacks`)

  return { output: output.join("\n"), findings }
}

export async function ssoPermissionAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing SSO permission sets for excessive privileges...\n"]

  const instances = await aws(["sso-admin", "list-instances"], profile, region, timeout)
  if (instances.exitCode !== 0) return { output: `[-] SSO not configured or no access: ${instances.stderr.trim()}`, findings }
  const instList = tryJson(instances.stdout)?.Instances || []
  if (instList.length === 0) return { output: "[-] No SSO instances found", findings }

  for (const inst of instList) {
    const arn = inst.InstanceArn
    output.push(`[+] SSO Instance: ${arn}`)

    const permSets = await aws(["sso-admin", "list-permission-sets", "--instance-arn", arn, "--max-results", "100"], profile, region, timeout)
    const psArns = tryJson(permSets.stdout)?.PermissionSets || []
    output.push(`[+] Permission sets: ${psArns.length}`)

    const dangerousPolicies = ["AdministratorAccess", "PowerUserAccess", "IAMFullAccess", "AmazonS3FullAccess"]

    for (const psArn of psArns) {
      const ps = await aws(["sso-admin", "describe-permission-set", "--instance-arn", arn, "--permission-set-arn", psArn], profile, region, timeout)
      const detail = tryJson(ps.stdout)?.PermissionSet || {}
      output.push(`\n  PermissionSet: ${detail.Name} (${detail.Description || "no description"})`)
      output.push(`    Session: ${detail.SessionDuration || "PT1H"}`)

      const managed = await aws(["sso-admin", "list-managed-policies-in-permission-set", "--instance-arn", arn, "--permission-set-arn", psArn], profile, region, timeout)
      const managedPolicies = tryJson(managed.stdout)?.AttachedManagedPolicies || []
      const policyNames = managedPolicies.map((p: Record<string, string>) => p.Name)
      output.push(`    Managed policies: ${policyNames.join(", ") || "none"}`)

      for (const dangerous of dangerousPolicies) {
        if (policyNames.includes(dangerous)) {
          const severity = dangerous === "AdministratorAccess" ? "critical" : "high"
          findings.push({ checkId: "AWS-SSOPERM-001", provider: "aws", severity, status: "FAIL", resource: `sso://permission-set/${detail.Name}`, title: `SSO permission set ${detail.Name} has ${dangerous}`, details: `Managed policy ${dangerous} attached — grants extensive AWS access`, remediation: `Replace ${dangerous} with least-privilege custom policy` })
        }
      }

      const customerManaged = await aws(["sso-admin", "list-customer-managed-policy-references-in-permission-set", "--instance-arn", arn, "--permission-set-arn", psArn], profile, region, timeout)
      const custPolicies = tryJson(customerManaged.stdout)?.CustomerManagedPolicyReferences || []
      if (custPolicies.length > 0) {
        output.push(`    Customer managed: ${custPolicies.map((p: Record<string, string>) => p.Name).join(", ")}`)
      }

      const inline = await aws(["sso-admin", "get-inline-policy-for-permission-set", "--instance-arn", arn, "--permission-set-arn", psArn], profile, region, timeout)
      const inlinePolicy = tryJson(inline.stdout)?.InlinePolicy
      if (inlinePolicy) {
        const doc = tryJson(inlinePolicy) || {}
        const stmts = doc.Statement || []
        for (const s of stmts) {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
          if (s.Effect === "Allow" && actions.includes("*")) {
            findings.push({ checkId: "AWS-SSOPERM-002", provider: "aws", severity: "critical", status: "FAIL", resource: `sso://permission-set/${detail.Name}`, title: `SSO ${detail.Name} inline policy grants Action:*`, details: "Inline policy with full admin — review if intentional", remediation: "Replace wildcard inline policy with scoped permissions" })
          }
        }
        output.push(`    Inline policy: yes (${stmts.length} statements)`)
      }
    }

    const storeId = inst.IdentityStoreId
    if (storeId) {
      const users = await aws(["identitystore", "list-users", "--identity-store-id", storeId, "--max-results", "100"], profile, region, timeout)
      const userList = tryJson(users.stdout)?.Users || []
      output.push(`\n  Identity Store users: ${userList.length}`)
      for (const u of userList.slice(0, 10)) {
        output.push(`    ${u.UserName || u.DisplayName} (${u.UserId})`)
      }

      const groups = await aws(["identitystore", "list-groups", "--identity-store-id", storeId, "--max-results", "100"], profile, region, timeout)
      const groupList = tryJson(groups.stdout)?.Groups || []
      output.push(`  Identity Store groups: ${groupList.length}`)
    }
  }

  output.push(`\n[*] Summary: ${findings.length} SSO permission issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListInstances, ListPermissionSets, DescribePermissionSet, ListManagedPoliciesInPermissionSet`)
  output.push(`  CloudTrail: GetInlinePolicyForPermissionSet, ListCustomerManagedPolicyReferencesInPermissionSet`)
  output.push(`  CloudTrail: ListUsers, ListGroups (Identity Store)`)
  output.push(`  GuardDuty: Recon:IAMUser/MaliciousIPCaller.Custom (SSO enumeration may trigger IAM recon alerts)`)
  output.push(`  OPSEC: SSO enumeration is moderate signal — reveals org-wide access structure; unusual from non-admin identities`)

  return { output: output.join("\n"), findings }
}

export async function stsSessionAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing STS session configuration...\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout) || {}
  output.push(`[+] Current identity: ${identity.Arn}`)
  output.push(`    Account: ${identity.Account}`)

  // Check MaxSessionDuration on all roles
  const roles = await aws(["iam", "list-roles", "--query", "Roles[?Path!='/aws-service-role/'].[RoleName,Arn]", "--max-items", "100"], profile, region, timeout)
  const roleList = tryJson(roles.stdout) || []
  output.push(`\n[+] Checking MaxSessionDuration on ${Math.min(roleList.length, 50)} roles...\n`)

  let longSessionCount = 0
  for (const role of roleList.slice(0, 50)) {
    const detail = await aws(["iam", "get-role", "--role-name", role[0], "--query", "Role.{Max:MaxSessionDuration,LastUsed:RoleLastUsed}"], profile, region, timeout)
    const d = tryJson(detail.stdout) || {}
    const maxDuration = d.Max || 3600
    const maxHours = maxDuration / 3600

    if (maxDuration > 14400) { // > 4 hours
      longSessionCount++
      output.push(`[!] ${role[0]}: MaxSession=${maxHours}h`)
      findings.push({ checkId: "AWS-STSSESS-001", provider: "aws", severity: "medium", status: "FAIL", resource: `iam://role/${role[0]}`, title: `Role ${role[0]} allows sessions up to ${maxHours} hours`, details: `MaxSessionDuration: ${maxDuration}s (${maxHours}h) — exceeds 4h threshold`, remediation: `Reduce: aws iam update-role --role-name ${role[0]} --max-session-duration 3600` })
    }
  }

  output.push(`\n[+] Roles with > 4h max session: ${longSessionCount}/${Math.min(roleList.length, 50)}`)

  const isRole = (identity.Arn || "").includes(":assumed-role/")
  const isUser = (identity.Arn || "").includes(":user/")
  if (isRole) {
    const roleName = (identity.Arn || "").split("/")[1] || ""
    const sessionToken = await aws(["sts", "get-session-token", "--duration-seconds", "900"], profile, region, timeout)
    if (sessionToken.exitCode === 0) {
      output.push("[!] Can generate session tokens from assumed role session")
    }
    output.push(`[+] Current role: ${roleName}`)
  }

  if (isUser) {
    const userName = (identity.Arn || "").split("/").pop() || ""
    const fedToken = await aws(["sts", "get-federation-token", "--name", "audit-test", "--duration-seconds", "900", "--policy", '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sts:GetCallerIdentity","Resource":"*"}]}'], profile, region, timeout)
    if (fedToken.exitCode === 0) {
      output.push(`\n[!] Can generate federation tokens (console access without MFA)`)
      findings.push({ checkId: "AWS-STSSESS-002", provider: "aws", severity: "high", status: "FAIL", resource: `iam://user/${userName}`, title: `User ${userName} can generate federation tokens`, details: "Federation tokens enable AWS Console access without MFA — persistence vector", remediation: "Add IAM policy denying sts:GetFederationToken or require MFA condition" })
    }
  }

  output.push(`\n[*] Summary: ${findings.length} session issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetCallerIdentity, ListRoles, GetRole, GetSessionToken, GetFederationToken`)
  output.push(`  GuardDuty: UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS (if credentials used externally)`)
  output.push(`  OPSEC: GetFederationToken is HIGH signal — rarely used legitimately; enables console access without MFA`)
  output.push(`  OPSEC: GetSessionToken with long duration is moderate signal — persistence indicator`)

  return { output: output.join("\n"), findings }
}

export async function groupMembershipAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing IAM group memberships...\n"]

  const groups = await aws(["iam", "list-groups", "--query", "Groups[].[GroupName,Arn,CreateDate]"], profile, region, timeout)
  if (groups.exitCode !== 0) return { output: `[-] Failed to list groups: ${groups.stderr.trim()}`, findings }
  const groupList = tryJson(groups.stdout) || []
  output.push(`[+] IAM Groups: ${groupList.length}`)

  const emptyGroups: string[] = []
  const adminGroups: string[] = []

  for (const group of groupList) {
    const name = group[0]

    const members = await aws(["iam", "get-group", "--group-name", name, "--query", "Users[].UserName"], profile, region, timeout)
    const memberList = tryJson(members.stdout) || []
    output.push(`\n  ${name}: ${memberList.length} members`)
    if (memberList.length > 0) output.push(`    Members: ${memberList.join(", ")}`)

    if (memberList.length === 0) {
      emptyGroups.push(name)
    }

    // Check group policies
    const inline = await aws(["iam", "list-group-policies", "--group-name", name, "--query", "PolicyNames"], profile, region, timeout)
    const inlinePolicies = tryJson(inline.stdout) || []

    const attached = await aws(["iam", "list-attached-group-policies", "--group-name", name, "--query", "AttachedPolicies[].PolicyName"], profile, region, timeout)
    const attachedPolicies = tryJson(attached.stdout) || []

    output.push(`    Inline: ${inlinePolicies.length}, Attached: ${attachedPolicies.join(", ") || "none"}`)

    const adminPolicyNames = ["AdministratorAccess", "PowerUserAccess", "IAMFullAccess"]
    for (const pol of attachedPolicies) {
      if (adminPolicyNames.includes(pol)) {
        adminGroups.push(name)
        findings.push({ checkId: "AWS-GRPMEM-001", provider: "aws", severity: "high", status: "FAIL", resource: `iam://group/${name}`, title: `Group ${name} has ${pol} (${memberList.length} members)`, details: `Members: ${memberList.join(", ") || "none"} — all inherit ${pol}`, remediation: `Review if all ${memberList.length} members need ${pol}` })
      }
    }

    for (const polName of inlinePolicies) {
      const pol = await aws(["iam", "get-group-policy", "--group-name", name, "--policy-name", polName], profile, region, timeout)
      const doc = tryJson(pol.stdout)?.PolicyDocument || {}
      const stmts = doc.Statement || []
      for (const s of stmts) {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
        const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource]
        if (s.Effect === "Allow" && actions.includes("*") && resources.includes("*")) {
          adminGroups.push(name)
          findings.push({ checkId: "AWS-GRPMEM-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://group/${name}`, title: `Group ${name} inline policy grants Action:* Resource:*`, details: `Full admin via inline policy ${polName}`, remediation: `Remove or scope down inline policy ${polName}` })
        }
      }
    }
  }

  if (emptyGroups.length > 0) {
    findings.push({ checkId: "AWS-GRPMEM-002", provider: "aws", severity: "low", status: "FAIL", resource: "iam://groups/empty", title: `${emptyGroups.length} empty IAM groups`, details: `Empty groups: ${emptyGroups.join(", ")}`, remediation: "Delete unused empty groups to reduce clutter" })
  }

  // Check users not in any group
  const users = await aws(["iam", "list-users", "--query", "Users[].UserName"], profile, region, timeout)
  const userList = tryJson(users.stdout) || []
  let ungrouped = 0
  for (const user of userList) {
    const userGroups = await aws(["iam", "list-groups-for-user", "--user-name", user, "--query", "Groups[].GroupName"], profile, region, timeout)
    const ug = tryJson(userGroups.stdout) || []
    if (ug.length === 0) {
      ungrouped++
      if (ungrouped <= 5) output.push(`[!] ${user}: not in any group (direct policy attachment)`)
    }
  }
  if (ungrouped > 0) {
    findings.push({ checkId: "AWS-GRPMEM-003", provider: "aws", severity: "medium", status: "FAIL", resource: "iam://users/ungrouped", title: `${ungrouped} users not in any IAM group`, details: "Users with direct policy attachments instead of group-based access — harder to manage", remediation: "Organize users into groups for centralized permission management" })
  }

  output.push(`\n[+] Empty groups: ${emptyGroups.length}, Admin groups: ${adminGroups.length}, Ungrouped users: ${ungrouped}`)
  output.push(`[*] Summary: ${findings.length} group membership issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListGroups, GetGroup, ListGroupPolicies, ListAttachedGroupPolicies, GetPolicy`)
  output.push(`  CloudTrail: ListUsers, ListGroupsForUser`)
  output.push(`  OPSEC: group+user enumeration is low-signal — standard IAM audit pattern`)

  return { output: output.join("\n"), findings }
}

export async function permissionBoundaryAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing IAM permission boundaries...\n"]

  // Check users
  const users = await aws(["iam", "list-users"], profile, region, timeout)
  if (users.exitCode !== 0) return { output: `[-] Failed to list users: ${users.stderr.trim()}`, findings }
  const userList = tryJson(users.stdout)?.Users || []
  let usersNoBoundary = 0
  let usersWithBoundary = 0
  const boundaryPolicies = new Map<string, number>()

  output.push(`[+] IAM Users: ${userList.length}`)
  for (const user of userList) {
    if (user.PermissionsBoundary) {
      usersWithBoundary++
      const policyName = user.PermissionsBoundary.PermissionsBoundaryArn.split("/").pop() || "unknown"
      boundaryPolicies.set(policyName, (boundaryPolicies.get(policyName) || 0) + 1)
    } else {
      usersNoBoundary++
    }
  }

  // Check roles (exclude service-linked)
  const roles = await aws(["iam", "list-roles", "--query", "Roles[?Path!='/aws-service-role/']"], profile, region, timeout)
  const roleList = tryJson(roles.stdout) || []
  let rolesNoBoundary = 0
  let rolesWithBoundary = 0

  output.push(`[+] IAM Roles (non-SLR): ${roleList.length}`)
  for (const role of roleList) {
    if (role.PermissionsBoundary) {
      rolesWithBoundary++
      const policyName = role.PermissionsBoundary.PermissionsBoundaryArn.split("/").pop() || "unknown"
      boundaryPolicies.set(policyName, (boundaryPolicies.get(policyName) || 0) + 1)
    } else {
      rolesNoBoundary++
    }
  }

  output.push(`\n[+] Users with boundary: ${usersWithBoundary}, without: ${usersNoBoundary}`)
  output.push(`[+] Roles with boundary: ${rolesWithBoundary}, without: ${rolesNoBoundary}`)

  if (boundaryPolicies.size > 0) {
    output.push(`\n[+] Boundary policies in use:`)
    for (const [name, count] of boundaryPolicies) {
      output.push(`  ${name}: ${count} entities`)
    }
  }

  const totalEntities = userList.length + roleList.length
  const totalNoBoundary = usersNoBoundary + rolesNoBoundary
  if (totalNoBoundary > totalEntities * 0.8 && totalEntities > 5) {
    findings.push({ checkId: "AWS-PERMBND-001", provider: "aws", severity: "medium", status: "FAIL", resource: "iam://permission-boundaries", title: `${totalNoBoundary}/${totalEntities} IAM entities lack permission boundaries`, details: `${usersNoBoundary} users and ${rolesNoBoundary} roles without boundaries — no ceiling on delegated permissions`, remediation: "Apply permission boundaries to limit the maximum permissions of IAM entities" })
  }

  // Analyze boundary policy contents
  for (const [policyName] of boundaryPolicies) {
    const policyArn = `arn:aws:iam::${(tryJson((await aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile, region, timeout)).stdout) || "").trim()}:policy/${policyName}`
    const versions = await aws(["iam", "list-policy-versions", "--policy-arn", policyArn, "--query", "Versions[?IsDefaultVersion==`true`].VersionId"], profile, region, timeout)
    const versionId = (tryJson(versions.stdout) || [])[0]
    if (!versionId) continue

    const polDoc = await aws(["iam", "get-policy-version", "--policy-arn", policyArn, "--version-id", versionId], profile, region, timeout)
    const doc = tryJson(polDoc.stdout)?.PolicyVersion?.Document || {}
    const stmts = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement].filter(Boolean)

    for (const s of stmts) {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource]
      if (s.Effect === "Allow" && actions.includes("*") && resources.includes("*")) {
        findings.push({ checkId: "AWS-PERMBND-002", provider: "aws", severity: "high", status: "FAIL", resource: `iam://policy/${policyName}`, title: `Permission boundary ${policyName} grants Action:* Resource:*`, details: "Boundary is ineffective — it allows everything", remediation: "Scope down the permission boundary to meaningful limits" })
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} permission boundary issues found`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListUsers, ListRoles, GetCallerIdentity, ListPolicyVersions, GetPolicyVersion`)
  output.push(`  OPSEC: permission boundary analysis is low-signal — looks like compliance scanning; reveals where guardrails are weak`)

  return { output: output.join("\n"), findings }
}

const DANGEROUS_ACTIONS: Record<string, string[]> = {
  "Data Access": [
    "s3:GetObject", "s3:ListBucket", "s3:GetBucketPolicy",
    "dynamodb:GetItem", "dynamodb:Scan", "dynamodb:Query",
    "rds:CopyDBSnapshot", "rds:CopyDBClusterSnapshot",
    "secretsmanager:GetSecretValue", "ssm:GetParameter", "ssm:GetParameters",
    "kms:Decrypt", "kms:ReEncrypt*",
    "lambda:GetFunction",
    "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage",
    "codecommit:GetRepository", "codecommit:GitPull",
  ],
  "IAM Admin": [
    "iam:CreateUser", "iam:CreateRole", "iam:CreatePolicy",
    "iam:AttachUserPolicy", "iam:AttachRolePolicy", "iam:PutUserPolicy", "iam:PutRolePolicy",
    "iam:CreateAccessKey", "iam:CreateLoginProfile", "iam:UpdateLoginProfile",
    "iam:PassRole", "iam:UpdateAssumeRolePolicy", "iam:AddUserToGroup",
    "iam:DeleteUserPermissionsBoundary", "iam:DeleteRolePermissionsBoundary",
    "sts:AssumeRole",
  ],
  "Network": [
    "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress",
    "ec2:CreateVpcPeeringConnection", "ec2:AcceptVpcPeeringConnection",
    "ec2:ModifyInstanceAttribute",
    "route53:ChangeResourceRecordSets",
  ],
  "Compute": [
    "lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:InvokeFunction",
    "ecs:RunTask", "ecs:ExecuteCommand",
    "ec2:RunInstances",
    "ssm:SendCommand", "ssm:StartSession",
    "codebuild:CreateProject", "codebuild:StartBuild",
    "glue:CreateDevEndpoint", "glue:CreateJob",
    "sagemaker:CreateNotebookInstance",
  ],
  "Defense Evasion": [
    "cloudtrail:StopLogging", "cloudtrail:DeleteTrail", "cloudtrail:UpdateTrail",
    "guardduty:DeleteDetector", "guardduty:CreateFilter",
    "config:StopConfigurationRecorder", "config:DeleteConfigRule",
    "securityhub:DisableSecurityHub",
    "logs:DeleteLogGroup", "logs:DeleteLogStream",
  ],
  "Persistence": [
    "iam:CreateAccessKey",
    "lambda:AddPermission", "lambda:CreateEventSourceMapping",
    "events:PutRule", "events:PutTargets",
    "ssm:CreateDocument",
    "ec2:CreateKeyPair",
  ],
}

export async function iamPolicySimulation(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const target = argVal(args, "--target")
  const findings: Finding[] = []
  const output: string[] = ["[*] IAM Policy Simulation — Effective Permission Analysis\n"]

  let sourceArn: string
  if (target) {
    sourceArn = target
    output.push(`[+] Target principal: ${sourceArn}`)
  } else {
    const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
    if (id.exitCode !== 0) return { output: `[-] Not authenticated: ${id.stderr.trim()}`, findings }
    const identity = tryJson(id.stdout) || {}
    sourceArn = identity.Arn as string || ""
    if (sourceArn.includes(":assumed-role/")) {
      const roleName = sourceArn.split("/")[1] || ""
      sourceArn = `arn:aws:iam::${identity.Account}:role/${roleName}`
    }
    output.push(`[+] Current identity: ${sourceArn}`)
  }

  const sim = await aws(
    [
      "iam", "simulate-principal-policy",
      "--policy-source-arn", sourceArn,
      "--action-names", "sts:GetCallerIdentity",
      "--query", "EvaluationResults[0].EvalDecision",
    ],
    profile, region, timeout,
  )
  if (sim.exitCode !== 0) {
    output.push(`[-] simulate-principal-policy unavailable: ${sim.stderr.trim().split("\n")[0]}`)
    output.push(`[*] This requires iam:SimulatePrincipalPolicy permission`)
    return { output: output.join("\n"), findings }
  }

  const summary: Record<string, { allowed: string[]; denied: string[] }> = {}
  let totalAllowed = 0
  let totalDenied = 0

  for (const [category, actions] of Object.entries(DANGEROUS_ACTIONS)) {
    summary[category] = { allowed: [], denied: [] }

    const batchSize = 10
    for (let i = 0; i < actions.length; i += batchSize) {
      const batch = actions.slice(i, i + batchSize)
      const result = await aws(
        [
          "iam", "simulate-principal-policy",
          "--policy-source-arn", sourceArn,
          "--action-names", ...batch,
          "--query", "EvaluationResults[].[EvalActionName,EvalDecision]",
        ],
        profile, region, timeout,
      )
      if (result.exitCode !== 0) continue

      const evals = tryJson(result.stdout) || []
      for (const [action, decision] of evals) {
        if (decision === "allowed") {
          summary[category].allowed.push(action)
          totalAllowed++
        } else {
          summary[category].denied.push(action)
          totalDenied++
        }
      }
    }
  }

  // ── Phase 2: Resource-scoped re-testing for allowed actions ──
  const accountMatch = sourceArn.match(/:(\d{12}):/)
  const accountId = accountMatch ? accountMatch[1] : ""
  const regionVal = region || "us-east-1"

  const RESOURCE_SCOPE_MAP: Record<string, string> = {
    "s3:GetObject": `arn:aws:s3:::*/*`,
    "s3:ListBucket": `arn:aws:s3:::*`,
    "s3:GetBucketPolicy": `arn:aws:s3:::*`,
    "dynamodb:GetItem": `arn:aws:dynamodb:${regionVal}:${accountId}:table/*`,
    "dynamodb:Scan": `arn:aws:dynamodb:${regionVal}:${accountId}:table/*`,
    "dynamodb:Query": `arn:aws:dynamodb:${regionVal}:${accountId}:table/*`,
    "secretsmanager:GetSecretValue": `arn:aws:secretsmanager:${regionVal}:${accountId}:secret:*`,
    "ssm:GetParameter": `arn:aws:ssm:${regionVal}:${accountId}:parameter/*`,
    "ssm:GetParameters": `arn:aws:ssm:${regionVal}:${accountId}:parameter/*`,
    "kms:Decrypt": `arn:aws:kms:${regionVal}:${accountId}:key/*`,
    "lambda:GetFunction": `arn:aws:lambda:${regionVal}:${accountId}:function:*`,
    "lambda:CreateFunction": `arn:aws:lambda:${regionVal}:${accountId}:function:*`,
    "lambda:InvokeFunction": `arn:aws:lambda:${regionVal}:${accountId}:function:*`,
    "ec2:RunInstances": `*`,
    "ecs:RunTask": `arn:aws:ecs:${regionVal}:${accountId}:task-definition/*`,
  }

  const allAllowed = Object.values(summary).flatMap((s) => s.allowed)
  const scopeTestable = allAllowed.filter((a) => RESOURCE_SCOPE_MAP[a])
  const resourceScoped: { action: string; universal: boolean }[] = []

  if (scopeTestable.length > 0 && accountId) {
    output.push(`\n[*] Resource-scope analysis: re-testing ${scopeTestable.length} allowed actions with wildcard resource ARNs...`)

    for (let i = 0; i < scopeTestable.length; i += 5) {
      const batch = scopeTestable.slice(i, i + 5)
      for (const action of batch) {
        const resourceArn = RESOURCE_SCOPE_MAP[action]
        const scopeResult = await aws(
          [
            "iam", "simulate-principal-policy",
            "--policy-source-arn", sourceArn,
            "--action-names", action,
            "--resource-arns", resourceArn,
            "--query", "EvaluationResults[0].EvalDecision",
            "--output", "text",
          ],
          profile, region, timeout,
        )
        const decision = scopeResult.stdout.trim()
        const universal = decision === "allowed"
        resourceScoped.push({ action, universal })
      }
    }

    const universalAccess = resourceScoped.filter((r) => r.universal)
    const constrainedAccess = resourceScoped.filter((r) => !r.universal)

    if (universalAccess.length > 0) {
      output.push(`[!] UNIVERSAL access (all resources): ${universalAccess.length} actions`)
      for (const r of universalAccess) output.push(`    ⚠ ${r.action} — allowed on ALL ${RESOURCE_SCOPE_MAP[r.action]}`)
    }
    if (constrainedAccess.length > 0) {
      output.push(`[+] Resource-constrained: ${constrainedAccess.length} actions (allowed by identity, but denied on wildcard resource)`)
      for (const r of constrainedAccess) output.push(`    ○ ${r.action} — identity-allowed but resource-restricted`)
    }

    if (universalAccess.length > 3) {
      findings.push({
        checkId: "AWS-POLSIM-004",
        provider: "aws",
        severity: "critical",
        status: "FAIL",
        resource: sourceArn,
        title: `${universalAccess.length} actions with universal resource access`,
        details: `Actions allowed on ALL resources: ${universalAccess.map((r) => r.action).join(", ")}`,
        remediation: "Apply resource-level conditions to restrict scope",
        cwe: "CWE-269",
      })
    }
  }

  output.push(`\n${"═".repeat(60)}`)
  output.push(`[*] Effective Permissions: ${totalAllowed} allowed / ${totalDenied} denied${resourceScoped.length > 0 ? ` (${resourceScoped.filter((r) => r.universal).length} universal)` : ""}`)
  output.push(`${"═".repeat(60)}\n`)

  for (const [category, result] of Object.entries(summary)) {
    const marker = result.allowed.length > 0 ? "[!]" : "[+]"
    output.push(`${marker} ${category}: ${result.allowed.length} allowed, ${result.denied.length} denied`)
    if (result.allowed.length > 0) {
      for (const a of result.allowed) {
        const scopeInfo = resourceScoped.find((r) => r.action === a)
        const scopeLabel = scopeInfo ? (scopeInfo.universal ? " ⚠ UNIVERSAL" : " (resource-constrained)") : ""
        output.push(`    ✓ ${a}${scopeLabel}`)
      }
    }
  }

  const criticalCategories = ["IAM Admin", "Defense Evasion"]
  for (const cat of criticalCategories) {
    const s = summary[cat]
    if (!s || s.allowed.length === 0) continue
    findings.push({
      checkId: "AWS-POLSIM-001",
      provider: "aws",
      severity: "critical",
      status: "FAIL",
      resource: sourceArn,
      title: `${s.allowed.length} dangerous ${cat} actions allowed`,
      details: `Allowed: ${s.allowed.join(", ")}`,
      remediation: `Restrict or deny: ${s.allowed.join(", ")} via IAM policy or SCP`,
      cwe: "CWE-269",
    })
  }

  const dataActions = summary["Data Access"]
  if (dataActions && dataActions.allowed.length > 5) {
    findings.push({
      checkId: "AWS-POLSIM-002",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: sourceArn,
      title: `Broad data access: ${dataActions.allowed.length} data retrieval actions allowed`,
      details: `Allowed: ${dataActions.allowed.join(", ")}`,
      remediation: "Apply resource-level restrictions or reduce attached policies",
      cwe: "CWE-284",
    })
  }

  const computeActions = summary["Compute"]
  if (computeActions && computeActions.allowed.length > 3) {
    findings.push({
      checkId: "AWS-POLSIM-003",
      provider: "aws",
      severity: "high",
      status: "FAIL",
      resource: sourceArn,
      title: `${computeActions.allowed.length} compute execution actions allowed`,
      details: `Allowed: ${computeActions.allowed.join(", ")} — can run arbitrary code in AWS`,
      remediation: "Restrict compute actions to specific resources",
      cwe: "CWE-269",
    })
  }

  output.push(`\n[*] Summary: ${totalAllowed} dangerous permissions allowed, ${findings.length} issues`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: SimulatePrincipalPolicy (per batch — multiple calls for full simulation)`)
  output.push(`  CloudTrail: GetCallerIdentity`)
  output.push(`  OPSEC: SimulatePrincipalPolicy is moderate signal — reveals what the caller is testing; bulk simulation is a pre-attack recon indicator`)
  output.push(`  OPSEC: attackers use this to find which dangerous actions they can perform before attempting them`)

  return { output: output.join("\n"), findings }
}

