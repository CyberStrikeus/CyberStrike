import { aws, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function stsSessionEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating STS session and federation capabilities...\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout) || {}
  output.push(`[+] Identity: ${identity.Arn}`)
  output.push(`    Account: ${identity.Account}, UserId: ${identity.UserId}`)

  const isRole = (identity.Arn || "").includes(":assumed-role/")
  const isUser = (identity.Arn || "").includes(":user/")
  output.push(`    Type: ${isRole ? "assumed-role" : isUser ? "IAM user" : "other"}`)

  if (isRole) {
    const roleName = (identity.Arn || "").split("/")[1] || ""
    const role = await aws(["iam", "get-role", "--role-name", roleName], profile, region, timeout)
    const r = tryJson(role.stdout)?.Role || {}
    output.push(`\n[+] Current role: ${roleName}`)
    output.push(`    MaxSessionDuration: ${r.MaxSessionDuration}s`)
    output.push(`    AssumeRolePolicy: ${JSON.stringify(r.AssumeRolePolicyDocument?.Statement?.length || 0)} statements`)

    if ((r.MaxSessionDuration || 3600) > 3600) {
      findings.push({ checkId: "AWS-STS-001", provider: "aws", severity: "medium", status: "FAIL", resource: `iam://role/${roleName}`, title: `Role ${roleName} allows sessions > 1 hour (${r.MaxSessionDuration}s)`, details: "Long-lived sessions increase exposure window after credential theft", remediation: "Reduce MaxSessionDuration to 3600" })
    }
  }

  if (isUser) {
    const userName = (identity.Arn || "").split("/").pop() || ""
    const fedToken = await aws(["sts", "get-federation-token", "--name", "audit-test", "--duration-seconds", "900", "--policy", '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"sts:GetCallerIdentity","Resource":"*"}]}'], profile, region, timeout)
    if (fedToken.exitCode === 0) {
      output.push(`\n[!] Can generate federation tokens (console access without MFA)`)
      findings.push({ checkId: "AWS-STS-002", provider: "aws", severity: "high", status: "FAIL", resource: `iam://user/${userName}`, title: `User ${userName} can generate federation tokens`, details: "Federation tokens enable AWS Console access without MFA — persistence vector", remediation: "Add IAM policy denying sts:GetFederationToken or require MFA condition" })
    }
  }

  const roles = await aws(["iam", "list-roles", "--query", "Roles[?AssumeRolePolicyDocument.Statement[?Principal.Service=='sts.amazonaws.com' || Principal=='*']].[RoleName,Arn]"], profile, region, timeout)
  const wildcardRoles = tryJson(roles.stdout) || []
  if (wildcardRoles.length > 0) {
    output.push(`\n[!] Roles assumable by any principal: ${wildcardRoles.length}`)
    for (const r of wildcardRoles.slice(0, 10)) {
      output.push(`    ${r[0]}`)
      findings.push({ checkId: "AWS-STS-003", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://role/${r[0]}`, title: `Role ${r[0]} has wildcard trust policy`, details: "Any AWS principal can assume this role", remediation: "Restrict AssumeRolePolicyDocument to specific accounts/services" })
    }
  }

  output.push(`\n[*] Summary: ${findings.length} identity issues found`)
  return { output: output.join("\n"), findings }
}

export async function crossAccountTrustEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating cross-account trust relationships...\n"]

  const id = await aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile, region, timeout)
  const ownAccount = id.stdout.trim()

  const roles = await aws(["iam", "list-roles", "--max-items", "200"], profile, region, timeout)
  const roleList = tryJson(roles.stdout)?.Roles || []
  output.push(`[+] Total roles: ${roleList.length}`)

  let crossCount = 0
  for (const role of roleList) {
    const statements = role.AssumeRolePolicyDocument?.Statement || []
    for (const stmt of statements) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      for (const p of principals) {
        const match = p.match(/^arn:aws:iam::(\d+):/)
        if (match && match[1] !== ownAccount) {
          crossCount++
          const hasCondition = stmt.Condition && Object.keys(stmt.Condition).length > 0
          const hasExternalId = stmt.Condition?.StringEquals?.["sts:ExternalId"]
          output.push(`[!] ${role.RoleName} ← account ${match[1]}${hasExternalId ? " (ExternalId)" : hasCondition ? " (conditional)" : " (NO conditions)"}`)

          if (!hasCondition) {
            findings.push({ checkId: "AWS-XACCT-001", provider: "aws", severity: "high", status: "FAIL", resource: `iam://role/${role.RoleName}`, title: `Cross-account role ${role.RoleName} trusts ${match[1]} without conditions`, details: "No ExternalId or condition — confused deputy risk", remediation: "Add sts:ExternalId condition to the trust policy" })
          }
        }
        if (p === "*") {
          findings.push({ checkId: "AWS-XACCT-002", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://role/${role.RoleName}`, title: `Role ${role.RoleName} trusts ANY principal (*)`, details: "Wildcard principal in assume role policy", remediation: "Restrict to specific AWS account or service principals" })
        }
      }
    }
  }

  output.push(`\n[+] Cross-account trust relationships: ${crossCount}`)
  output.push(`[*] Summary: ${findings.length} issues found`)
  return { output: output.join("\n"), findings }
}

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

  output.push(`\n[*] Summary: ${findings.length} IAM issues found`)
  return { output: output.join("\n"), findings }
}

export async function stalePermissionAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing stale/unused IAM permissions...\n"]

  const policies = await aws(["iam", "list-policies", "--scope", "Local", "--only-attached", "--query", "Policies[].[PolicyName,Arn,AttachmentCount,CreateDate]"], profile, region, timeout)
  const policyList = tryJson(policies.stdout) || []
  output.push(`[+] Customer-managed attached policies: ${policyList.length}`)

  for (const p of policyList) {
    const versions = await aws(["iam", "list-policy-versions", "--policy-arn", p[1], "--query", "Versions[].[VersionId,IsDefaultVersion,CreateDate]"], profile, region, timeout)
    const vList = tryJson(versions.stdout) || []
    const defaultVer = vList.find((v: unknown[]) => v[1] === true)
    if (defaultVer) {
      const pol = await aws(["iam", "get-policy-version", "--policy-arn", p[1], "--version-id", defaultVer[0]], profile, region, timeout)
      const doc = tryJson(pol.stdout)?.PolicyVersion?.Document || {}
      const stmts = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement].filter(Boolean)
      for (const s of stmts) {
        if (s.Effect !== "Allow") continue
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
        const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource]
        if (actions.some((a: string) => a === "*") && resources.some((r: string) => r === "*")) {
          findings.push({ checkId: "AWS-PERM-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://policy/${p[0]}`, title: `Policy ${p[0]} grants full admin (Action:* Resource:*)`, details: `Attached to ${p[2]} entities. Created: ${p[3]}`, remediation: "Replace with least-privilege policy" })
        }
        const wildcardSvc = actions.filter((a: string) => a !== "*" && a.endsWith(":*"))
        if (wildcardSvc.length > 3) {
          findings.push({ checkId: "AWS-PERM-002", provider: "aws", severity: "high", status: "FAIL", resource: `iam://policy/${p[0]}`, title: `Policy ${p[0]} has ${wildcardSvc.length} service-level wildcards`, details: `Services: ${wildcardSvc.slice(0, 5).join(", ")}...`, remediation: "Scope down to specific actions per service" })
        }
      }
    }
  }

  const roles = await aws(["iam", "list-roles", "--query", "Roles[?Path!='/aws-service-role/'].[RoleName,Arn,CreateDate]"], profile, region, timeout)
  const roleList = tryJson(roles.stdout) || []
  let staleRoles = 0
  for (const r of roleList.slice(0, 50)) {
    const lastUsed = await aws(["iam", "get-role", "--role-name", r[0], "--query", "Role.RoleLastUsed"], profile, region, timeout)
    const lu = tryJson(lastUsed.stdout) || {}
    if (!lu.LastUsedDate) {
      const created = new Date(r[2]).getTime()
      const age = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24))
      if (age > 90) {
        staleRoles++
        if (staleRoles <= 5) output.push(`[!] Stale role: ${r[0]} (created ${age} days ago, never used)`)
        findings.push({ checkId: "AWS-PERM-003", provider: "aws", severity: "medium", status: "FAIL", resource: `iam://role/${r[0]}`, title: `Role ${r[0]} unused for ${age}+ days`, details: "Never assumed since creation", remediation: `Review and delete if not needed: aws iam delete-role --role-name ${r[0]}` })
      }
    }
  }
  output.push(`[+] Stale roles (>90 days, never used): ${staleRoles}`)

  output.push(`\n[*] Summary: ${findings.length} permission issues found`)
  return { output: output.join("\n"), findings }
}

export async function ssoDeepEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Deep SSO/IAM Identity Center enumeration...\n"]

  const instances = await aws(["sso-admin", "list-instances"], profile, region, timeout)
  if (instances.exitCode !== 0) return { output: `[-] SSO not configured or no access: ${instances.stderr.trim()}`, findings }
  const instList = tryJson(instances.stdout)?.Instances || []

  if (instList.length === 0) {
    output.push("[-] No SSO instances found")
    return { output: output.join("\n"), findings }
  }

  for (const inst of instList) {
    const arn = inst.InstanceArn
    const storeId = inst.IdentityStoreId
    output.push(`[+] SSO Instance: ${arn}`)
    output.push(`    Identity Store: ${storeId}`)

    const permSets = await aws(["sso-admin", "list-permission-sets", "--instance-arn", arn, "--max-results", "100"], profile, region, timeout)
    const psArns = tryJson(permSets.stdout)?.PermissionSets || []
    output.push(`    Permission sets: ${psArns.length}`)

    for (const psArn of psArns.slice(0, 20)) {
      const ps = await aws(["sso-admin", "describe-permission-set", "--instance-arn", arn, "--permission-set-arn", psArn], profile, region, timeout)
      const detail = tryJson(ps.stdout)?.PermissionSet || {}
      const duration = detail.SessionDuration || "PT1H"
      output.push(`\n    PermissionSet: ${detail.Name}`)
      output.push(`      SessionDuration: ${duration}, Relay: ${detail.RelayState || "none"}`)

      const durationHours = parseInt(duration.replace(/PT(\d+)H.*/, "$1")) || 1
      if (durationHours > 8) {
        findings.push({ checkId: "AWS-SSO-001", provider: "aws", severity: "medium", status: "FAIL", resource: `sso://permission-set/${detail.Name}`, title: `Permission set ${detail.Name} session duration ${duration} exceeds 8 hours`, details: "Long sessions increase exposure after credential compromise", remediation: "Reduce session duration to 8 hours or less" })
      }

      const inlinePolicy = await aws(["sso-admin", "get-inline-policy-for-permission-set", "--instance-arn", arn, "--permission-set-arn", psArn], profile, region, timeout)
      const inline = tryJson(inlinePolicy.stdout)?.InlinePolicy
      if (inline) {
        const doc = tryJson(inline) || {}
        const stmts = doc.Statement || []
        for (const s of stmts) {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action]
          if (s.Effect === "Allow" && actions.includes("*")) {
            findings.push({ checkId: "AWS-SSO-002", provider: "aws", severity: "critical", status: "FAIL", resource: `sso://permission-set/${detail.Name}`, title: `SSO permission set ${detail.Name} has Action:* inline policy`, details: "Full admin through SSO — review if intentional", remediation: "Replace with least-privilege managed policy" })
          }
        }
      }
    }

    const users = await aws(["identitystore", "list-users", "--identity-store-id", storeId, "--max-results", "100"], profile, region, timeout)
    const userList = tryJson(users.stdout)?.Users || []
    output.push(`\n    Identity Store users: ${userList.length}`)
    for (const u of userList.slice(0, 10)) {
      output.push(`      ${u.UserName || u.DisplayName} (${u.UserId})`)
    }

    const groups = await aws(["identitystore", "list-groups", "--identity-store-id", storeId, "--max-results", "100"], profile, region, timeout)
    const groupList = tryJson(groups.stdout)?.Groups || []
    output.push(`    Identity Store groups: ${groupList.length}`)
  }

  output.push(`\n[*] Summary: ${findings.length} SSO issues found`)
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
  for (const ip of idPoolList) {
    if (ip.AllowUnauthenticatedIdentities) {
      findings.push({ checkId: "AWS-COGN-005", provider: "aws", severity: "high", status: "FAIL", resource: `cognito-identity://${ip.IdentityPoolId}`, title: `Identity pool ${ip.IdentityPoolName} allows unauthenticated access`, details: "Unauthenticated identities can assume the unauth role — check its permissions", remediation: "Disable unauthenticated access or restrict the unauth role" })
      output.push(`[!] ${ip.IdentityPoolName}: allows unauthenticated identities`)
    }
  }

  output.push(`\n[*] Summary: ${findings.length} Cognito issues found`)
  return { output: output.join("\n"), findings }
}

export async function serviceLinkedRoleEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating service-linked roles...\n"]

  const roles = await aws(["iam", "list-roles", "--path-prefix", "/aws-service-role/", "--query", "Roles[].[RoleName,Arn,CreateDate]"], profile, region, timeout)
  const roleList = tryJson(roles.stdout) || []
  output.push(`[+] Service-linked roles: ${roleList.length}`)

  const serviceMap = new Map<string, number>()
  for (const r of roleList) {
    const svc = (r[0] as string).split("_")[0] || r[0]
    serviceMap.set(svc, (serviceMap.get(svc) || 0) + 1)
    output.push(`  ${r[0]}`)
  }

  output.push(`\n[+] Services with linked roles: ${serviceMap.size}`)
  for (const [svc, count] of serviceMap) {
    output.push(`  ${svc}: ${count}`)
  }

  output.push(`\n[*] Summary: ${roleList.length} service-linked roles (informational)`)
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
  const knownServices = new Set([
    "ec2.amazonaws.com", "lambda.amazonaws.com", "ecs-tasks.amazonaws.com", "eks.amazonaws.com",
    "rds.amazonaws.com", "s3.amazonaws.com", "cloudformation.amazonaws.com", "codebuild.amazonaws.com",
    "codepipeline.amazonaws.com", "glue.amazonaws.com", "sagemaker.amazonaws.com", "states.amazonaws.com",
    "events.amazonaws.com", "ssm.amazonaws.com", "elasticmapreduce.amazonaws.com", "firehose.amazonaws.com",
    "logs.amazonaws.com", "monitoring.amazonaws.com", "autoscaling.amazonaws.com", "application-autoscaling.amazonaws.com",
    "elasticloadbalancing.amazonaws.com", "config.amazonaws.com", "guardduty.amazonaws.com",
  ])

  for (const role of roleList) {
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

        if (p.endsWith(".amazonaws.com") && !knownServices.has(p)) {
          unusualServiceCount++
          output.push(`[?] ${role.RoleName}: unusual service principal ${p}`)
          findings.push({ checkId: "AWS-RTRUST-003", provider: "aws", severity: "low", status: "FAIL", resource: `iam://role/${role.RoleName}`, title: `Role ${role.RoleName} trusts unusual service: ${p}`, details: "Service principal not in common set — verify legitimacy", remediation: "Review if this service principal is expected" })
        }
      }
    }
  }

  output.push(`\n[+] Wildcard trusts: ${wildcardCount}, Cross-account: ${crossAccountCount}, Unusual services: ${unusualServiceCount}`)
  output.push(`[*] Summary: ${findings.length} trust policy issues found`)
  return { output: output.join("\n"), findings }
}

export async function crossAccountTrustAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Cross-account trust audit (IAM roles, S3, KMS, SQS)...\n"]

  const id = await aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"], profile, region, timeout)
  const ownAccount = id.stdout.trim()

  // IAM role cross-account trusts
  const roles = await aws(["iam", "list-roles", "--max-items", "200"], profile, region, timeout)
  const roleList = tryJson(roles.stdout)?.Roles || []
  let roleXAcct = 0
  for (const role of roleList) {
    const statements = role.AssumeRolePolicyDocument?.Statement || []
    for (const stmt of statements) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      for (const p of principals) {
        const match = p.match(/^arn:aws:iam::(\d+):/)
        if (match && match[1] !== ownAccount) {
          roleXAcct++
          if (roleXAcct <= 10) output.push(`[!] Role ${role.RoleName} ← account ${match[1]}`)
        }
        if (p === "*") {
          findings.push({ checkId: "AWS-XACCT-002", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://role/${role.RoleName}`, title: `Role ${role.RoleName} trusts ANY principal (*)`, details: "Wildcard principal — any AWS entity can assume", remediation: "Restrict to specific accounts/services" })
        }
      }
    }
  }
  output.push(`[+] IAM roles with cross-account trust: ${roleXAcct}`)

  // S3 bucket policy cross-account
  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  let s3XAcct = 0
  for (const bucket of bucketList.slice(0, 30)) {
    const pol = await aws(["s3api", "get-bucket-policy", "--bucket", bucket], profile, region, timeout)
    if (pol.exitCode !== 0) continue
    const doc = tryJson(tryJson(pol.stdout)?.Policy || pol.stdout) || {}
    const stmts = doc.Statement || []
    for (const stmt of stmts) {
      const principals = extractPrincipals(stmt.Principal)
      for (const p of principals) {
        if (p === "*" && stmt.Effect === "Allow") {
          s3XAcct++
          findings.push({ checkId: "AWS-XACCT-001", provider: "aws", severity: "high", status: "FAIL", resource: `s3://${bucket}`, title: `S3 bucket ${bucket} policy allows Principal:*`, details: "Bucket policy grants access to any AWS principal", remediation: "Restrict bucket policy to specific accounts or use conditions" })
        }
        const match = p.match(/^arn:aws:iam::(\d+):/)
        if (match && match[1] !== ownAccount) {
          s3XAcct++
          output.push(`[!] S3 ${bucket} ← account ${match[1]}`)
        }
      }
    }
  }
  output.push(`[+] S3 buckets with cross-account access: ${s3XAcct}`)

  // KMS key cross-account
  const keys = await aws(["kms", "list-keys", "--query", "Keys[].KeyId"], profile, region, timeout)
  const keyList = tryJson(keys.stdout) || []
  let kmsXAcct = 0
  for (const keyId of keyList.slice(0, 20)) {
    const pol = await aws(["kms", "get-key-policy", "--key-id", keyId, "--policy-name", "default"], profile, region, timeout)
    if (pol.exitCode !== 0) continue
    const doc = tryJson(pol.stdout) || {}
    const policyDoc = tryJson(doc.Policy || "") || doc
    const stmts = policyDoc.Statement || []
    for (const stmt of stmts) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      for (const p of principals) {
        const match = p.match(/^arn:aws:iam::(\d+):/)
        if (match && match[1] !== ownAccount) {
          kmsXAcct++
          output.push(`[!] KMS ${keyId.slice(0, 8)}... ← account ${match[1]}`)
        }
      }
    }
  }
  output.push(`[+] KMS keys with cross-account access: ${kmsXAcct}`)

  // SQS cross-account
  const queues = await aws(["sqs", "list-queues"], profile, region, timeout)
  const queueUrls = tryJson(queues.stdout)?.QueueUrls || []
  let sqsXAcct = 0
  for (const url of queueUrls.slice(0, 20)) {
    const attrs = await aws(["sqs", "get-queue-attributes", "--queue-url", url, "--attribute-names", "Policy"], profile, region, timeout)
    const policy = tryJson(attrs.stdout)?.Attributes?.Policy
    if (!policy) continue
    const doc = tryJson(policy) || {}
    const stmts = doc.Statement || []
    for (const stmt of stmts) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      for (const p of principals) {
        if (p === "*") {
          sqsXAcct++
          findings.push({ checkId: "AWS-XACCT-001", provider: "aws", severity: "high", status: "FAIL", resource: `sqs://${url.split("/").pop()}`, title: `SQS queue ${url.split("/").pop()} allows Principal:*`, details: "Queue policy grants access to any principal", remediation: "Restrict SQS policy to specific accounts" })
        }
      }
    }
  }
  output.push(`[+] SQS queues with cross-account access: ${sqsXAcct}`)

  output.push(`\n[*] Summary: ${findings.length} cross-account issues found`)
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
  }

  output.push(`\n[*] Summary: ${findings.length} SSO permission issues found`)
  return { output: output.join("\n"), findings }
}

export async function cognitoIdentityAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Cognito identity pools...\n"]

  const pools = await aws(["cognito-identity", "list-identity-pools", "--max-results", "60"], profile, region, timeout)
  if (pools.exitCode !== 0) return { output: `[-] Failed to list identity pools: ${pools.stderr.trim()}`, findings }
  const poolList = tryJson(pools.stdout)?.IdentityPools || []
  output.push(`[+] Identity pools: ${poolList.length}`)

  for (const pool of poolList) {
    const detail = await aws(["cognito-identity", "describe-identity-pool", "--identity-pool-id", pool.IdentityPoolId], profile, region, timeout)
    const d = tryJson(detail.stdout) || {}
    output.push(`\n  Pool: ${d.IdentityPoolName} (${d.IdentityPoolId})`)
    output.push(`    AllowUnauthenticated: ${d.AllowUnauthenticatedIdentities}`)
    output.push(`    Providers: ${(d.CognitoIdentityProviders || []).length}`)
    output.push(`    OIDC: ${Object.keys(d.OpenIdConnectProviderARNs || {}).length}`)
    output.push(`    SAML: ${(d.SamlProviderARNs || []).length}`)

    if (d.AllowUnauthenticatedIdentities) {
      findings.push({ checkId: "AWS-COGID-001", provider: "aws", severity: "high", status: "FAIL", resource: `cognito-identity://${d.IdentityPoolId}`, title: `Identity pool ${d.IdentityPoolName} allows unauthenticated identities`, details: "Unauthenticated users can obtain AWS credentials — check role permissions", remediation: "Disable AllowUnauthenticatedIdentities or restrict unauth role to minimal permissions" })

      // Check unauthenticated role permissions
      const roles = await aws(["cognito-identity", "get-identity-pool-roles", "--identity-pool-id", pool.IdentityPoolId], profile, region, timeout)
      const roleData = tryJson(roles.stdout) || {}
      const unauthRoleArn = roleData.Roles?.unauthenticated
      if (unauthRoleArn) {
        const roleName = unauthRoleArn.split("/").pop() || ""
        output.push(`    Unauth role: ${roleName}`)
        const role = await aws(["iam", "get-role", "--role-name", roleName], profile, region, timeout)
        const r = tryJson(role.stdout)?.Role || {}

        const attached = await aws(["iam", "list-attached-role-policies", "--role-name", roleName, "--query", "AttachedPolicies[].PolicyName"], profile, region, timeout)
        const attachedPolicies = tryJson(attached.stdout) || []
        output.push(`    Unauth policies: ${attachedPolicies.join(", ") || "none"}`)

        const dangerousPolicies = ["AdministratorAccess", "PowerUserAccess", "AmazonS3FullAccess", "AmazonDynamoDBFullAccess"]
        for (const pol of attachedPolicies) {
          if (dangerousPolicies.includes(pol)) {
            findings.push({ checkId: "AWS-COGID-002", provider: "aws", severity: "critical", status: "FAIL", resource: `cognito-identity://${d.IdentityPoolId}/unauth-role`, title: `Unauth role for ${d.IdentityPoolName} has ${pol}`, details: `Unauthenticated users get ${pol} — full access without login`, remediation: `Remove ${pol} from unauthenticated role ${roleName}` })
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
              findings.push({ checkId: "AWS-COGID-002", provider: "aws", severity: "critical", status: "FAIL", resource: `cognito-identity://${d.IdentityPoolId}/unauth-role`, title: `Unauth role inline policy has Action:*`, details: `Inline policy ${polName} on unauth role grants full access`, remediation: `Scope down inline policy ${polName} on role ${roleName}` })
            }
          }
        }
      }
    }
  }

  output.push(`\n[*] Summary: ${findings.length} Cognito identity pool issues found`)
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

  // Check current session type
  const isRole = (identity.Arn || "").includes(":assumed-role/")
  if (isRole) {
    const roleName = (identity.Arn || "").split("/")[1] || ""
    const sessionToken = await aws(["sts", "get-session-token", "--duration-seconds", "900"], profile, region, timeout)
    if (sessionToken.exitCode === 0) {
      output.push("[!] Can generate session tokens from assumed role session")
    }
    output.push(`[+] Current role: ${roleName}`)
  }

  output.push(`\n[*] Summary: ${findings.length} session issues found`)
  return { output: output.join("\n"), findings }
}

export async function resourcePolicyAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing resource-based policies for Principal:*...\n"]

  // S3 bucket policies
  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  let s3Open = 0
  for (const bucket of bucketList.slice(0, 30)) {
    const pol = await aws(["s3api", "get-bucket-policy", "--bucket", bucket], profile, region, timeout)
    if (pol.exitCode !== 0) continue
    const doc = tryJson(tryJson(pol.stdout)?.Policy || pol.stdout) || {}
    const stmts = doc.Statement || []
    for (const stmt of stmts) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      if (principals.includes("*") && !stmt.Condition) {
        s3Open++
        findings.push({ checkId: "AWS-RESPOL-001", provider: "aws", severity: "critical", status: "FAIL", resource: `s3://${bucket}`, title: `S3 ${bucket} policy allows Principal:* without conditions`, details: `Actions: ${JSON.stringify(stmt.Action)}`, remediation: "Add conditions or restrict to specific principals" })
        output.push(`[!] S3 ${bucket}: Principal:* without conditions`)
      }
    }
  }
  output.push(`[+] S3 buckets with open policies: ${s3Open}`)

  // Lambda function policies
  const lambdas = await aws(["lambda", "list-functions", "--query", "Functions[].FunctionName"], profile, region, timeout)
  const lambdaList = tryJson(lambdas.stdout) || []
  let lambdaOpen = 0
  for (const fn of lambdaList.slice(0, 30)) {
    const pol = await aws(["lambda", "get-policy", "--function-name", fn], profile, region, timeout)
    if (pol.exitCode !== 0) continue
    const doc = tryJson(tryJson(pol.stdout)?.Policy || pol.stdout) || {}
    const stmts = doc.Statement || []
    for (const stmt of stmts) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      if (principals.includes("*") && !stmt.Condition) {
        lambdaOpen++
        findings.push({ checkId: "AWS-RESPOL-002", provider: "aws", severity: "high", status: "FAIL", resource: `lambda://${fn}`, title: `Lambda ${fn} policy allows Principal:* invocation`, details: "Any AWS entity can invoke this function", remediation: "Restrict to specific account/service principals" })
        output.push(`[!] Lambda ${fn}: Principal:*`)
      }
    }
  }
  output.push(`[+] Lambda functions with open policies: ${lambdaOpen}`)

  // SQS queue policies
  const queues = await aws(["sqs", "list-queues"], profile, region, timeout)
  const queueUrls = tryJson(queues.stdout)?.QueueUrls || []
  let sqsOpen = 0
  for (const url of queueUrls.slice(0, 20)) {
    const attrs = await aws(["sqs", "get-queue-attributes", "--queue-url", url, "--attribute-names", "Policy"], profile, region, timeout)
    const policy = tryJson(attrs.stdout)?.Attributes?.Policy
    if (!policy) continue
    const doc = tryJson(policy) || {}
    const stmts = doc.Statement || []
    for (const stmt of stmts) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      if (principals.includes("*") && !stmt.Condition) {
        sqsOpen++
        const queueName = url.split("/").pop() || url
        findings.push({ checkId: "AWS-RESPOL-003", provider: "aws", severity: "high", status: "FAIL", resource: `sqs://${queueName}`, title: `SQS ${queueName} allows Principal:* without conditions`, details: "Any entity can send/receive messages", remediation: "Restrict SQS policy to specific accounts or add conditions" })
        output.push(`[!] SQS ${queueName}: Principal:*`)
      }
    }
  }
  output.push(`[+] SQS queues with open policies: ${sqsOpen}`)

  // SNS topic policies
  const topics = await aws(["sns", "list-topics", "--query", "Topics[].TopicArn"], profile, region, timeout)
  const topicList = tryJson(topics.stdout) || []
  let snsOpen = 0
  for (const arn of topicList.slice(0, 20)) {
    const attrs = await aws(["sns", "get-topic-attributes", "--topic-arn", arn], profile, region, timeout)
    const policy = tryJson(attrs.stdout)?.Attributes?.Policy
    if (!policy) continue
    const doc = tryJson(policy) || {}
    const stmts = doc.Statement || []
    for (const stmt of stmts) {
      if (stmt.Effect !== "Allow") continue
      const principals = extractPrincipals(stmt.Principal)
      if (principals.includes("*") && !stmt.Condition) {
        snsOpen++
        const topicName = arn.split(":").pop() || arn
        findings.push({ checkId: "AWS-RESPOL-004", provider: "aws", severity: "high", status: "FAIL", resource: `sns://${topicName}`, title: `SNS ${topicName} allows Principal:* without conditions`, details: "Any entity can publish/subscribe", remediation: "Restrict SNS policy to specific accounts or add conditions" })
        output.push(`[!] SNS ${topicName}: Principal:*`)
      }
    }
  }
  output.push(`[+] SNS topics with open policies: ${snsOpen}`)

  output.push(`\n[*] Summary: ${findings.length} overly permissive resource policies found`)
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
  return { output: output.join("\n"), findings }
}
