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
