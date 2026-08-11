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
      ["vm", "list", ...rgArgs, "--query", "[].{name:name,rg:resourceGroup,os:storageProfile.osDisk.osType,state:provisioningState}"],
      sub,
      timeout,
    )
    if (vms.exitCode !== 0) return { output: output.join("\n") + `[-] Failed to list VMs: ${vms.stderr.slice(0, 200)}`, findings }
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

  if (!vm || !rg || !cmd) return { output: "[-] --vm-name, --resource-group, and --command required for exec", findings }

  const commandId = os === "windows" ? "RunPowerShellScript" : "RunShellScript"
  output.push(`[*] Executing on ${vm} via ${commandId}...`)
  output.push(`    Command: ${cmd}`)

  const exec = await az(
    [
      "vm", "run-command", "invoke",
      "--command-id", commandId,
      "--name", vm,
      "--resource-group", rg,
      "--scripts", cmd,
    ],
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
    const vms = await az(
      ["vm", "list", ...rgFilter, "--query", "[].{name:name,rg:resourceGroup,id:id}"],
      sub,
      timeout,
    )
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

  const vmInfo = await az(["vm", "show", "--name", targetVm, "--resource-group", tRg, "--query", "id", "-o", "tsv"], sub, timeout)
  if (vmInfo.exitCode !== 0) return { output: output.join("\n") + `[-] VM not found: ${vmInfo.stderr.slice(0, 200)}`, findings }

  const vmId = vmInfo.stdout.trim()
  output.push(`[*] Bastion: ${bastionName}`)
  output.push(`[*] Target VM: ${targetVm} (${tRg})`)
  output.push(`[*] VM ID: ${vmId}`)
  output.push(`\n[+] SSH tunnel command:`)
  output.push(`    az network bastion ssh --name ${bastionName} --resource-group ${rg || tRg} --target-resource-id ${vmId} --auth-type ssh-key --ssh-key ~/.ssh/id_rsa`)
  output.push(`\n[+] RDP tunnel command:`)
  output.push(`    az network bastion rdp --name ${bastionName} --resource-group ${rg || tRg} --target-resource-id ${vmId}`)
  output.push(`\n[+] Port forwarding (native tunnel):`)
  output.push(`    az network bastion tunnel --name ${bastionName} --resource-group ${rg || tRg} --target-resource-id ${vmId} --resource-port 22 --port 2222`)

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

    const extensions = await az(["connectedmachine", "extension", "list", "--machine-name", machineList[0]?.name || "none", "--resource-group", machineList[0]?.resourceGroup || "none"], sub, timeout)
    if (extensions.exitCode === 0) {
      const extList = tryJson(extensions.stdout) || []
      output.push(`\n[+] Extensions on first machine: ${extList.length}`)
      for (const e of extList) output.push(`    ${e.name} (${e.type}) — ${e.provisioningState}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (!machine || !rg || !cmd) return { output: "[-] --machine, --resource-group, and --command required for exec", findings }

  output.push(`[*] Executing on Arc machine: ${machine}`)
  output.push(`    Command: ${cmd}`)

  const exec = await az(
    [
      "connectedmachine", "run-command", "create",
      "--machine-name", machine,
      "--resource-group", rg,
      "--run-command-name", `cs-cmd-${Date.now().toString(36)}`,
      "--script", cmd,
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
      const endpoints = await run("az", ["devops", "service-endpoint", "list", "--project", p.name, ...orgArgs, "-o", "json"], timeout)
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

  const endpoints = await run("az", ["devops", "service-endpoint", "list", "--project", project, ...orgArgs, "-o", "json"], timeout)
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

  const ctap = await run("az", ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/policies/crossTenantAccessPolicy", "-o", "json"], timeout)
  if (ctap.exitCode === 0) {
    const policy = tryJson(ctap.stdout)
    if (policy) {
      output.push(`[+] Cross-tenant access policy:`)
      const def = policy.default || {}
      output.push(`    Inbound trust: MFA=${def.inboundTrust?.isMfaAccepted || false}, Device=${def.inboundTrust?.isCompliantDeviceAccepted || false}`)
      output.push(`    B2B collaboration inbound: ${def.b2bCollaborationInbound?.usersAndGroups?.accessType || "default"}`)
      output.push(`    B2B collaboration outbound: ${def.b2bCollaborationOutbound?.usersAndGroups?.accessType || "default"}`)
    }
  }
  if (ctap.exitCode !== 0) output.push(`[-] Cross-tenant policy access denied (needs Policy.Read.All): ${ctap.stderr.slice(0, 200)}`)

  const partners = await run("az", ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/policies/crossTenantAccessPolicy/partners", "-o", "json"], timeout)
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
  const guests = await az(["ad", "user", "list", "--filter", "userType eq 'Guest'", "--query", "[].{upn:userPrincipalName,display:displayName,created:createdDateTime}"], undefined, timeout)
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

  const b2bInvites = await az(["ad", "user", "list", "--filter", "externalUserState eq 'PendingAcceptance'", "--query", "[].{upn:userPrincipalName,display:displayName}"], undefined, timeout)
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
