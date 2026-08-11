import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function defenderPlanAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Defender for Cloud plans (CIS 3.1.2-3.1.10)...\n"]

  const r = await az(["security", "pricing", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list Defender plans: ${r.stderr.trim()}`, findings }

  const plans = tryJson(r.stdout)
  if (!Array.isArray(plans)) return { output: "[-] Could not parse Defender plan data", findings }

  const required = [
    "VirtualMachines",
    "StorageAccounts",
    "SqlServers",
    "AppServices",
    "Containers",
    "KeyVaults",
    "Dns",
    "Arm",
    "OpenSourceRelationalDatabases",
    "CosmosDbs",
    "CloudPosture",
    "SqlServerVirtualMachines",
    "Api",
  ]

  for (const plan of plans) {
    const name = plan.name || plan.pricingTier?.name || ""
    const tier = plan.pricingTier || plan.properties?.pricingTier || plan.tier || ""
    const isFree = typeof tier === "string" ? tier === "Free" : tier === "Free"
    const isRequired = required.includes(name)

    if (isRequired) {
      if (isFree || (!tier && !plan.properties)) {
        output.push(`[-] ${name}: FREE (not enabled)`)
        findings.push({
          checkId: `CIS-AZ-3.1`,
          provider: "azure-cis",
          severity: "high",
          status: "FAIL",
          resource: `defender://${name}`,
          title: `Defender for ${name} is not enabled`,
          details: `Plan '${name}' is set to Free tier — no threat detection active`,
          remediation: `az security pricing create --name ${name} --tier Standard`,
        })
      } else {
        output.push(`[+] ${name}: Standard (enabled)`)
      }
    }
  }

  const failCount = findings.length
  output.push(`\n[*] Summary: ${required.length - failCount}/${required.length} plans enabled, ${failCount} disabled`)
  return { output: output.join("\n"), findings }
}

export async function defenderContactAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Defender security contacts (CIS 3.1.12-3.1.16)...\n"]

  const r = await az(["security", "contact", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list security contacts: ${r.stderr.trim()}`, findings }

  const contacts = tryJson(r.stdout)
  if (!Array.isArray(contacts) || contacts.length === 0) {
    findings.push({
      checkId: "CIS-AZ-3.1.12",
      provider: "azure-cis",
      severity: "high",
      status: "FAIL",
      resource: "defender://contacts",
      title: "No security contacts configured",
      details: "No email addresses configured for security alert notifications",
      remediation:
        "az security contact create --name default --email security@example.com --alert-notifications on --alerts-admins on",
    })
    output.push("[-] No security contacts configured")
    return { output: output.join("\n"), findings }
  }

  for (const c of contacts) {
    const email = c.email || c.properties?.email || ""
    const alertNotif = c.alertNotifications?.state || c.properties?.alertNotifications?.state || "Off"
    const adminNotif = c.notificationsByRole?.state || c.properties?.notificationsByRole?.state || "Off"

    output.push(`[*] Contact: ${email || "(no email)"}`)
    output.push(`    Alert notifications: ${alertNotif}`)
    output.push(`    Admin notifications: ${adminNotif}`)

    if (!email) {
      findings.push({
        checkId: "CIS-AZ-3.1.13",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `defender://contact/${c.name}`,
        title: "Security contact has no email address",
        details: "Contact exists but no email is set — alerts won't be delivered",
        remediation: "Update security contact with a valid email address",
      })
    }
    if (alertNotif !== "On") {
      findings.push({
        checkId: "CIS-AZ-3.1.14",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `defender://contact/${c.name}`,
        title: "Alert notifications disabled for security contact",
        details: "Security alerts will not be sent to this contact",
        remediation: "Enable alert notifications: --alert-notifications on",
      })
    }
    if (adminNotif !== "On") {
      findings.push({
        checkId: "CIS-AZ-3.1.15",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `defender://contact/${c.name}`,
        title: "Admin notification disabled — subscription owners won't get alerts",
        details: "Notifications to subscription owners/admins are off",
        remediation: "Enable admin notifications: --alerts-admins on",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function storageSecurityAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing storage account security (CIS 4.1-4.17)...\n"]

  const r = await az(["storage", "account", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list storage accounts: ${r.stderr.trim()}`, findings }

  const accounts = tryJson(r.stdout) || []
  output.push(`[*] Found ${accounts.length} storage accounts\n`)

  for (const acct of accounts) {
    const name = acct.name
    const rg = acct.resourceGroup
    output.push(`[*] ${name} (${rg})`)

    if (!acct.enableHttpsTrafficOnly && acct.supportsHttpsTrafficOnly !== true) {
      findings.push({
        checkId: "CIS-AZ-4.1",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `storage://${name}`,
        title: `Secure transfer not required: ${name}`,
        details: "HTTP traffic allowed — data in transit not encrypted",
        remediation: `az storage account update --name ${name} --https-only true`,
      })
      output.push("  [-] Secure transfer: NOT required")
    } else {
      output.push("  [+] Secure transfer: required")
    }

    const netRules = acct.networkRuleSet || acct.properties?.networkAcls || {}
    const defaultAction = netRules.defaultAction || "Allow"
    if (defaultAction === "Allow") {
      findings.push({
        checkId: "CIS-AZ-4.6",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `storage://${name}`,
        title: `Default network access allowed: ${name}`,
        details: "Storage account accessible from all networks by default",
        remediation: `az storage account update --name ${name} --default-action Deny`,
      })
      output.push("  [-] Default network: Allow (public)")
    } else {
      output.push("  [+] Default network: Deny")
    }

    const tls = acct.minimumTlsVersion || "TLS1_0"
    if (tls !== "TLS1_2") {
      findings.push({
        checkId: "CIS-AZ-4.12",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `storage://${name}`,
        title: `TLS version below 1.2: ${name} (${tls})`,
        details: `Minimum TLS version is ${tls} — should be TLS1_2`,
        remediation: `az storage account update --name ${name} --min-tls-version TLS1_2`,
      })
      output.push(`  [-] Min TLS: ${tls}`)
    } else {
      output.push("  [+] Min TLS: TLS1_2")
    }

    const allowSharedKey = acct.allowSharedKeyAccess
    if (allowSharedKey !== false) {
      findings.push({
        checkId: "CIS-AZ-4.4",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `storage://${name}`,
        title: `Shared key access enabled: ${name}`,
        details: "Storage account allows shared key auth — should use Entra ID only",
        remediation: `az storage account update --name ${name} --allow-shared-key-access false`,
      })
      output.push("  [-] Shared key access: enabled")
    }

    const softDelete = acct.properties?.blobServiceProperties?.deleteRetentionPolicy?.enabled
    if (softDelete === false) {
      findings.push({
        checkId: "CIS-AZ-4.9",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `storage://${name}`,
        title: `Blob soft delete disabled: ${name}`,
        details: "Deleted blobs cannot be recovered",
        remediation: `az storage blob service-properties delete-policy update --account-name ${name} --enable true --days-retained 7`,
      })
    }

    const infraEncrypt = acct.encryption?.requireInfrastructureEncryption
    if (!infraEncrypt) {
      findings.push({
        checkId: "CIS-AZ-4.16",
        provider: "azure-cis",
        severity: "low",
        status: "FAIL",
        resource: `storage://${name}`,
        title: `Infrastructure encryption disabled: ${name}`,
        details: "Double encryption not enabled — single layer encryption only",
        remediation: "Enable infrastructure encryption (requires account recreation)",
      })
    }
  }

  output.push(`\n[*] Total findings: ${findings.length} across ${accounts.length} accounts`)
  return { output: output.join("\n"), findings }
}

export async function sqlAuditConfig(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Azure SQL security (CIS 5.1.1-5.1.7)...\n"]

  const r = await az(["sql", "server", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list SQL servers: ${r.stderr.trim()}`, findings }

  const servers = tryJson(r.stdout) || []
  output.push(`[*] Found ${servers.length} SQL servers\n`)

  for (const srv of servers) {
    const name = srv.name
    const rg = srv.resourceGroup
    output.push(`[*] ${name} (${rg})`)

    const audit = await az(
      ["sql", "server", "audit-policy", "show", "--name", name, "--resource-group", rg],
      sub,
      timeout,
    )
    if (audit.exitCode === 0) {
      const policy = tryJson(audit.stdout)
      const state = policy?.state || policy?.properties?.state || "Disabled"
      if (state !== "Enabled") {
        findings.push({
          checkId: "CIS-AZ-5.1.1",
          provider: "azure-cis",
          severity: "high",
          status: "FAIL",
          resource: `sql://${name}`,
          title: `SQL auditing disabled: ${name}`,
          details: "No audit logs for database operations",
          remediation: `az sql server audit-policy update --name ${name} --resource-group ${rg} --state Enabled --storage-account STORAGE`,
        })
        output.push("  [-] Auditing: disabled")
      } else {
        output.push("  [+] Auditing: enabled")
      }
    }

    const atp = await az(
      ["sql", "server", "advanced-threat-protection-setting", "show", "--name", name, "--resource-group", rg],
      sub,
      timeout,
    )
    if (atp.exitCode === 0) {
      const atpData = tryJson(atp.stdout)
      const atpState = atpData?.state || atpData?.properties?.state || "Disabled"
      if (atpState !== "Enabled") {
        findings.push({
          checkId: "CIS-AZ-5.1.4",
          provider: "azure-cis",
          severity: "high",
          status: "FAIL",
          resource: `sql://${name}`,
          title: `Advanced Threat Protection disabled: ${name}`,
          details: "No SQL threat detection (injection, anomalous access, brute force)",
          remediation: `az sql server advanced-threat-protection-setting update --name ${name} --resource-group ${rg} --state Enabled`,
        })
        output.push("  [-] ATP: disabled")
      } else {
        output.push("  [+] ATP: enabled")
      }
    }

    const dbs = await az(["sql", "db", "list", "--server", name, "--resource-group", rg], sub, timeout)
    if (dbs.exitCode === 0) {
      for (const db of tryJson(dbs.stdout) || []) {
        if (db.name === "master") continue
        const tde = await az(
          ["sql", "db", "tde", "show", "--server", name, "--database", db.name, "--resource-group", rg],
          sub,
          timeout,
        )
        if (tde.exitCode === 0) {
          const tdeData = tryJson(tde.stdout)
          const tdeState = tdeData?.state || tdeData?.properties?.state || "Disabled"
          if (tdeState !== "Enabled") {
            findings.push({
              checkId: "CIS-AZ-5.1.3",
              provider: "azure-cis",
              severity: "high",
              status: "FAIL",
              resource: `sql://${name}/${db.name}`,
              title: `TDE disabled on database: ${db.name}`,
              details: "Transparent Data Encryption not enabled — data at rest not encrypted",
              remediation: `az sql db tde set --server ${name} --database ${db.name} --resource-group ${rg} --status Enabled`,
            })
            output.push(`  [-] TDE: ${db.name} not encrypted`)
          }
        }
      }
    }

    const fw = await az(
      ["sql", "server", "firewall-rule", "list", "--server", name, "--resource-group", rg],
      sub,
      timeout,
    )
    if (fw.exitCode === 0) {
      for (const rule of tryJson(fw.stdout) || []) {
        if (rule.startIpAddress === "0.0.0.0" && rule.endIpAddress === "255.255.255.255") {
          findings.push({
            checkId: "CIS-AZ-5.1.5",
            provider: "azure-cis",
            severity: "critical",
            status: "FAIL",
            resource: `sql://${name}/firewall/${rule.name}`,
            title: `SQL firewall allows all IPs: ${name}/${rule.name}`,
            details: "Firewall rule 0.0.0.0-255.255.255.255 allows access from any IP",
            remediation: `az sql server firewall-rule delete --server ${name} --resource-group ${rg} --name "${rule.name}"`,
          })
          output.push(`  [-] Firewall: rule '${rule.name}' allows ALL IPs`)
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function postgresAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing PostgreSQL servers (CIS 5.2.1-5.2.8)...\n"]

  const r = await az(["postgres", "server", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list PostgreSQL servers: ${r.stderr.trim()}`, findings }

  const servers = tryJson(r.stdout) || []
  output.push(`[*] Found ${servers.length} PostgreSQL servers\n`)

  for (const srv of servers) {
    const name = srv.name
    const rg = srv.resourceGroup
    output.push(`[*] ${name} (${rg})`)

    if (srv.sslEnforcement !== "Enabled") {
      findings.push({
        checkId: "CIS-AZ-5.2.1",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `postgres://${name}`,
        title: `SSL enforcement disabled: ${name}`,
        details: "Connections without SSL are allowed — data in transit not encrypted",
        remediation: `az postgres server update --name ${name} --resource-group ${rg} --ssl-enforcement Enabled`,
      })
      output.push("  [-] SSL enforcement: disabled")
    } else {
      output.push("  [+] SSL enforcement: enabled")
    }

    const configs = await az(
      ["postgres", "server", "configuration", "list", "--server-name", name, "--resource-group", rg],
      sub,
      timeout,
    )
    if (configs.exitCode === 0) {
      const params = tryJson(configs.stdout) || []
      const checks: Record<string, { cis: string; expected: string; sev: string }> = {
        log_checkpoints: { cis: "CIS-AZ-5.2.2", expected: "on", sev: "medium" },
        log_connections: { cis: "CIS-AZ-5.2.3", expected: "on", sev: "medium" },
        log_disconnections: { cis: "CIS-AZ-5.2.4", expected: "on", sev: "medium" },
        connection_throttling: { cis: "CIS-AZ-5.2.5", expected: "on", sev: "medium" },
      }
      for (const param of params) {
        const check = checks[param.name]
        if (check && param.value !== check.expected) {
          findings.push({
            checkId: check.cis,
            provider: "azure-cis",
            severity: check.sev,
            status: "FAIL",
            resource: `postgres://${name}/${param.name}`,
            title: `${param.name} = ${param.value} (expected ${check.expected}): ${name}`,
            details: `PostgreSQL configuration '${param.name}' is not set to recommended value`,
            remediation: `az postgres server configuration set --name ${param.name} --value ${check.expected} --server-name ${name} --resource-group ${rg}`,
          })
          output.push(`  [-] ${param.name}: ${param.value}`)
        }
      }

      const retention = params.find((p: Record<string, string>) => p.name === "log_retention_days")
      if (retention && parseInt(retention.value) < 3) {
        findings.push({
          checkId: "CIS-AZ-5.2.6",
          provider: "azure-cis",
          severity: "medium",
          status: "FAIL",
          resource: `postgres://${name}/log_retention_days`,
          title: `Log retention < 3 days: ${name} (${retention.value} days)`,
          details: "Log retention period is too short for investigation",
          remediation: `az postgres server configuration set --name log_retention_days --value 4 --server-name ${name} --resource-group ${rg}`,
        })
        output.push(`  [-] Log retention: ${retention.value} days (< 3)`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function mysqlAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing MySQL servers (CIS 5.3.1-5.3.4)...\n"]

  const r = await az(["mysql", "server", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list MySQL servers: ${r.stderr.trim()}`, findings }

  const servers = tryJson(r.stdout) || []
  output.push(`[*] Found ${servers.length} MySQL servers\n`)

  for (const srv of servers) {
    const name = srv.name
    const rg = srv.resourceGroup
    output.push(`[*] ${name} (${rg})`)

    if (srv.sslEnforcement !== "Enabled") {
      findings.push({
        checkId: "CIS-AZ-5.3.1",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `mysql://${name}`,
        title: `SSL enforcement disabled: ${name}`,
        details: "Unencrypted connections allowed to MySQL server",
        remediation: `az mysql server update --name ${name} --resource-group ${rg} --ssl-enforcement Enabled`,
      })
      output.push("  [-] SSL enforcement: disabled")
    } else {
      output.push("  [+] SSL enforcement: enabled")
    }

    const minTls = srv.minimalTlsVersion || "TLSEnforcementDisabled"
    if (minTls !== "TLS1_2") {
      findings.push({
        checkId: "CIS-AZ-5.3.2",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `mysql://${name}`,
        title: `TLS version below 1.2: ${name} (${minTls})`,
        details: "Weak TLS versions allowed",
        remediation: `az mysql server update --name ${name} --resource-group ${rg} --minimal-tls-version TLS1_2`,
      })
      output.push(`  [-] Min TLS: ${minTls}`)
    }

    const configs = await az(
      ["mysql", "server", "configuration", "list", "--server-name", name, "--resource-group", rg],
      sub,
      timeout,
    )
    if (configs.exitCode === 0) {
      const params = tryJson(configs.stdout) || []
      const auditLog = params.find((p: Record<string, string>) => p.name === "audit_log_enabled")
      if (auditLog && auditLog.value !== "ON") {
        findings.push({
          checkId: "CIS-AZ-5.3.3",
          provider: "azure-cis",
          severity: "medium",
          status: "FAIL",
          resource: `mysql://${name}/audit_log_enabled`,
          title: `Audit logging disabled: ${name}`,
          details: "MySQL audit log is not enabled",
          remediation: `az mysql server configuration set --name audit_log_enabled --value ON --server-name ${name} --resource-group ${rg}`,
        })
        output.push("  [-] Audit log: disabled")
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function cosmosSecurityAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Cosmos DB security (CIS 5.4.1-5.4.3)...\n"]

  const r = await az(["cosmosdb", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list Cosmos DB accounts: ${r.stderr.trim()}`, findings }

  const accounts = tryJson(r.stdout) || []
  output.push(`[*] Found ${accounts.length} Cosmos DB accounts\n`)

  for (const acct of accounts) {
    const name = acct.name
    output.push(`[*] ${name}`)

    const ipRules = acct.ipRules || []
    const vnRules = acct.virtualNetworkRules || []
    const publicAccess = acct.publicNetworkAccess || "Enabled"

    if (ipRules.length === 0 && vnRules.length === 0 && publicAccess !== "Disabled") {
      findings.push({
        checkId: "CIS-AZ-5.4.1",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `cosmosdb://${name}`,
        title: `No firewall configured: ${name}`,
        details: "Cosmos DB account has no IP rules, VNet rules, or public access restriction",
        remediation: `az cosmosdb update --name ${name} --resource-group ${acct.resourceGroup} --ip-range-filter "YOUR_IP"`,
      })
      output.push("  [-] Firewall: not configured (public)")
    } else {
      output.push(`  [+] Firewall: ${ipRules.length} IP rules, ${vnRules.length} VNet rules`)
    }

    const localAuth = acct.disableLocalAuth
    if (!localAuth) {
      findings.push({
        checkId: "CIS-AZ-5.4.2",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `cosmosdb://${name}`,
        title: `Local auth enabled: ${name}`,
        details: "Cosmos DB allows key-based auth — should use Entra ID only",
        remediation: `az cosmosdb update --name ${name} --resource-group ${acct.resourceGroup} --disable-key-based-metadata-write-access true`,
      })
      output.push("  [-] Local auth: enabled")
    }

    const privateEndpoints = acct.privateEndpointConnections || []
    if (privateEndpoints.length === 0) {
      findings.push({
        checkId: "CIS-AZ-5.4.3",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `cosmosdb://${name}`,
        title: `No private endpoints: ${name}`,
        details: "Cosmos DB has no private endpoint connections — traffic goes over public internet",
        remediation: "Create private endpoint for Cosmos DB account",
      })
      output.push("  [-] Private endpoints: none")
    }
  }

  return { output: output.join("\n"), findings }
}

export async function diagnosticAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing subscription diagnostic settings (CIS 6.1)...\n"]

  const r = await az(["monitor", "diagnostic-settings", "subscription", "list"], sub, timeout)
  if (r.exitCode !== 0) {
    findings.push({
      checkId: "CIS-AZ-6.1",
      provider: "azure-cis",
      severity: "high",
      status: "FAIL",
      resource: "subscription://diagnostic-settings",
      title: "No subscription diagnostic settings found",
      details: `Could not retrieve diagnostic settings: ${r.stderr.trim()}`,
      remediation:
        'az monitor diagnostic-settings subscription create --name AuditLogs --logs \'[{"category":"Administrative","enabled":true}]\' --workspace WS_ID',
    })
    return { output: output.join("\n"), findings }
  }

  const settings = tryJson(r.stdout)?.value || tryJson(r.stdout) || []
  if (!Array.isArray(settings) || settings.length === 0) {
    findings.push({
      checkId: "CIS-AZ-6.1",
      provider: "azure-cis",
      severity: "high",
      status: "FAIL",
      resource: "subscription://diagnostic-settings",
      title: "No subscription diagnostic settings configured",
      details: "Activity logs are not being forwarded to any destination",
      remediation: "Create diagnostic settings for subscription-level activity logs",
    })
    output.push("[-] No diagnostic settings found")
    return { output: output.join("\n"), findings }
  }

  const required = ["Administrative", "Security", "ServiceHealth", "Alert", "Recommendation", "Policy"]
  for (const setting of settings) {
    const name = setting.name || "unknown"
    const logs = setting.properties?.logs || setting.logs || []
    output.push(`[*] Setting: ${name}`)

    for (const cat of required) {
      const log = logs.find((l: Record<string, string | boolean>) => l.category === cat)
      if (!log || !log.enabled) {
        findings.push({
          checkId: "CIS-AZ-6.1",
          provider: "azure-cis",
          severity: "medium",
          status: "FAIL",
          resource: `diagnostic://${name}/${cat}`,
          title: `Log category '${cat}' not enabled in '${name}'`,
          details: `Required log category '${cat}' is disabled or missing`,
          remediation: `Enable '${cat}' category in diagnostic setting '${name}'`,
        })
        output.push(`  [-] ${cat}: disabled`)
      } else {
        output.push(`  [+] ${cat}: enabled`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function activityAlertAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing activity log alerts (CIS 6.2.1-6.2.9)...\n"]

  const r = await az(["monitor", "activity-log", "alert", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list activity log alerts: ${r.stderr.trim()}`, findings }

  const alerts = tryJson(r.stdout) || []
  output.push(`[*] Found ${alerts.length} activity log alerts\n`)

  const requiredOps = [
    {
      op: "Microsoft.Authorization/policyAssignments/write",
      cis: "CIS-AZ-6.2.1",
      desc: "Policy assignment create/update",
    },
    { op: "Microsoft.Authorization/policyAssignments/delete", cis: "CIS-AZ-6.2.2", desc: "Policy assignment delete" },
    { op: "Microsoft.Network/networkSecurityGroups/write", cis: "CIS-AZ-6.2.3", desc: "NSG create/update" },
    { op: "Microsoft.Network/networkSecurityGroups/delete", cis: "CIS-AZ-6.2.4", desc: "NSG delete" },
    { op: "Microsoft.Security/securitySolutions/write", cis: "CIS-AZ-6.2.5", desc: "Security solution create/update" },
    { op: "Microsoft.Security/securitySolutions/delete", cis: "CIS-AZ-6.2.6", desc: "Security solution delete" },
    { op: "Microsoft.Sql/servers/firewallRules/write", cis: "CIS-AZ-6.2.7", desc: "SQL firewall rule create/update" },
    { op: "Microsoft.Sql/servers/firewallRules/delete", cis: "CIS-AZ-6.2.8", desc: "SQL firewall rule delete" },
    {
      op: "Microsoft.Network/networkSecurityGroups/securityRules/write",
      cis: "CIS-AZ-6.2.9",
      desc: "NSG security rule change",
    },
  ]

  for (const req of requiredOps) {
    const found = alerts.some((a: Record<string, unknown>) => {
      const cond = a as Record<string, Record<string, Record<string, unknown>>>
      const conditions = (cond.condition?.allOf || cond.properties?.condition?.allOf || []) as unknown as Record<
        string,
        unknown
      >[]
      return conditions.some(
        (c: Record<string, unknown>) => c.equals === req.op || (c.field === "operationName" && c.equals === req.op),
      )
    })
    if (!found) {
      findings.push({
        checkId: req.cis,
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: "alerts://activity-log",
        title: `No alert for: ${req.desc}`,
        details: `No activity log alert configured for operation '${req.op}'`,
        remediation: `az monitor activity-log alert create --name "${req.desc}" --condition category=Administrative and operationName=${req.op}`,
      })
      output.push(`[-] Missing alert: ${req.desc}`)
    } else {
      output.push(`[+] Alert exists: ${req.desc}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function networkWatcherAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Network Watcher (CIS 7.4-7.7)...\n"]

  const locations = await az(
    ["account", "list-locations", "--query", "[?metadata.regionType=='Physical'].name"],
    sub,
    timeout,
  )
  const regions: string[] = locations.exitCode === 0 ? tryJson(locations.stdout) || [] : []

  const r = await az(["network", "watcher", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list Network Watchers: ${r.stderr.trim()}`, findings }

  const watchers = tryJson(r.stdout) || []
  const watcherRegions = new Set(watchers.map((w: Record<string, string>) => w.location))

  output.push(`[*] Network Watchers: ${watchers.length} across ${watcherRegions.size} regions`)
  output.push(`[*] Subscription regions: ${regions.length}\n`)

  for (const region of regions) {
    if (!watcherRegions.has(region)) {
      findings.push({
        checkId: "CIS-AZ-7.4",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `network-watcher://${region}`,
        title: `Network Watcher not enabled: ${region}`,
        details: `No Network Watcher provisioned in region '${region}'`,
        remediation: `az network watcher configure --resource-group NetworkWatcherRG --locations ${region} --enabled true`,
      })
      output.push(`[-] ${region}: no Network Watcher`)
    }
  }

  const flowLogs = await az(
    ["network", "watcher", "flow-log", "list", "--location", watchers[0]?.location || "eastus"],
    sub,
    timeout,
  )
  if (flowLogs.exitCode === 0) {
    const logs = tryJson(flowLogs.stdout) || []
    output.push(`\n[*] Flow logs found: ${logs.length}`)
    const disabledLogs = logs.filter((l: Record<string, unknown>) => !(l as Record<string, boolean>).enabled)
    if (disabledLogs.length > 0) {
      findings.push({
        checkId: "CIS-AZ-7.5",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: "network://flow-logs",
        title: `${disabledLogs.length} NSG flow logs disabled`,
        details: "NSG flow logs are not capturing network traffic data",
        remediation: "Enable flow logs for all NSGs",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function vmSecurityAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing VM security (CIS 8.1-8.11)...\n"]

  const extra = rg ? ["--resource-group", rg] : []
  const r = await az(["vm", "list", ...extra, "-d"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list VMs: ${r.stderr.trim()}`, findings }

  const vms = tryJson(r.stdout) || []
  output.push(`[*] Found ${vms.length} VMs\n`)

  for (const vm of vms) {
    const name = vm.name
    const vmRg = vm.resourceGroup
    output.push(`[*] ${name} (${vmRg})`)

    const osDisk = vm.storageProfile?.osDisk || {}
    if (osDisk.managedDisk === null || osDisk.managedDisk === undefined) {
      if (osDisk.vhd) {
        findings.push({
          checkId: "CIS-AZ-8.1",
          provider: "azure-cis",
          severity: "medium",
          status: "FAIL",
          resource: `vm://${name}`,
          title: `Unmanaged disk: ${name}`,
          details: "VM uses unmanaged VHD disks instead of managed disks",
          remediation: `az vm convert --resource-group ${vmRg} --name ${name}`,
        })
        output.push("  [-] Managed disk: no (unmanaged VHD)")
      }
    }

    const encSettings = vm.storageProfile?.osDisk?.encryptionSettings?.enabled
    const diskEncType = vm.storageProfile?.osDisk?.managedDisk?.diskEncryptionSet
    if (!encSettings && !diskEncType) {
      const diskEnc = await az(["vm", "encryption", "show", "--name", name, "--resource-group", vmRg], sub, timeout)
      if (diskEnc.exitCode !== 0 || !tryJson(diskEnc.stdout)) {
        findings.push({
          checkId: "CIS-AZ-8.2",
          provider: "azure-cis",
          severity: "high",
          status: "FAIL",
          resource: `vm://${name}/os-disk`,
          title: `OS disk not encrypted: ${name}`,
          details: "VM OS disk does not have Azure Disk Encryption enabled",
          remediation: `az vm encryption enable --name ${name} --resource-group ${vmRg} --disk-encryption-keyvault KV_NAME`,
        })
        output.push("  [-] OS disk encryption: disabled")
      }
    }

    const exts = await az(["vm", "extension", "list", "--vm-name", name, "--resource-group", vmRg], sub, timeout)
    if (exts.exitCode === 0) {
      const extList = tryJson(exts.stdout) || []
      const approved = [
        "MicrosoftMonitoringAgent",
        "AzureMonitorWindowsAgent",
        "AzureMonitorLinuxAgent",
        "DependencyAgentWindows",
        "DependencyAgentLinux",
        "AzureDiskEncryption",
        "AzureDiskEncryptionForLinux",
        "IaaSAntimalware",
        "MDE.Windows",
        "MDE.Linux",
      ]
      const unapproved = extList.filter(
        (e: Record<string, string>) =>
          !approved.some((a) => (e.name || "").includes(a) || (e.typeHandlerVersion || "").includes(a)),
      )
      if (unapproved.length > 0) {
        output.push(`  [!] Unapproved extensions: ${unapproved.map((e: Record<string, string>) => e.name).join(", ")}`)
      }

      const hasEndpoint = extList.some(
        (e: Record<string, string>) =>
          (e.name || "").includes("Antimalware") ||
          (e.name || "").includes("MDE") ||
          (e.name || "").includes("IaaSAntimalware"),
      )
      if (!hasEndpoint) {
        findings.push({
          checkId: "CIS-AZ-8.7",
          provider: "azure-cis",
          severity: "medium",
          status: "FAIL",
          resource: `vm://${name}`,
          title: `No endpoint protection: ${name}`,
          details: "VM has no antimalware/EDR extension installed",
          remediation: "Install Microsoft Defender for Endpoint or IaaSAntimalware extension",
        })
        output.push("  [-] Endpoint protection: none")
      }
    }

    const secProfile = vm.securityProfile || {}
    if (!secProfile.securityType || secProfile.securityType !== "TrustedLaunch") {
      findings.push({
        checkId: "CIS-AZ-8.10",
        provider: "azure-cis",
        severity: "low",
        status: "FAIL",
        resource: `vm://${name}`,
        title: `Trusted Launch not enabled: ${name}`,
        details: "VM does not use Trusted Launch security type",
        remediation: "Redeploy VM with --security-type TrustedLaunch",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function appserviceSecurityAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing App Service security (CIS 9.1-9.12)...\n"]

  const extra = rg ? ["--resource-group", rg] : []
  const r = await az(["webapp", "list", ...extra], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list App Services: ${r.stderr.trim()}`, findings }

  const apps = tryJson(r.stdout) || []
  output.push(`[*] Found ${apps.length} App Services\n`)

  for (const app of apps) {
    const name = app.name
    const appRg = app.resourceGroup
    output.push(`[*] ${name} (${appRg})`)

    if (!app.httpsOnly) {
      findings.push({
        checkId: "CIS-AZ-9.1",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `appservice://${name}`,
        title: `HTTPS not enforced: ${name}`,
        details: "App allows HTTP connections — data in transit not encrypted",
        remediation: `az webapp update --name ${name} --resource-group ${appRg} --set httpsOnly=true`,
      })
      output.push("  [-] HTTPS only: no")
    } else {
      output.push("  [+] HTTPS only: yes")
    }

    const config = await az(["webapp", "config", "show", "--name", name, "--resource-group", appRg], sub, timeout)
    if (config.exitCode === 0) {
      const cfg = tryJson(config.stdout) || {}

      if (cfg.ftpsState !== "Disabled" && cfg.ftpsState !== "FtpsOnly") {
        findings.push({
          checkId: "CIS-AZ-9.3",
          provider: "azure-cis",
          severity: "high",
          status: "FAIL",
          resource: `appservice://${name}`,
          title: `FTP enabled: ${name} (${cfg.ftpsState || "AllAllowed"})`,
          details: "FTP allows plaintext credential transmission",
          remediation: `az webapp config set --name ${name} --resource-group ${appRg} --ftps-state Disabled`,
        })
        output.push(`  [-] FTP state: ${cfg.ftpsState || "AllAllowed"}`)
      }

      const tls = cfg.minTlsVersion || "1.0"
      if (tls !== "1.2" && tls !== "1.3") {
        findings.push({
          checkId: "CIS-AZ-9.4",
          provider: "azure-cis",
          severity: "medium",
          status: "FAIL",
          resource: `appservice://${name}`,
          title: `Min TLS below 1.2: ${name} (${tls})`,
          details: `Minimum TLS version is ${tls}`,
          remediation: `az webapp config set --name ${name} --resource-group ${appRg} --min-tls-version 1.2`,
        })
        output.push(`  [-] Min TLS: ${tls}`)
      }

      if (!cfg.http20Enabled) {
        findings.push({
          checkId: "CIS-AZ-9.9",
          provider: "azure-cis",
          severity: "low",
          status: "FAIL",
          resource: `appservice://${name}`,
          title: `HTTP/2 disabled: ${name}`,
          details: "HTTP/2 not enabled — performance and security improvements missed",
          remediation: `az webapp config set --name ${name} --resource-group ${appRg} --http20-enabled true`,
        })
      }

      if (cfg.remoteDebuggingEnabled) {
        findings.push({
          checkId: "CIS-AZ-9.10",
          provider: "azure-cis",
          severity: "critical",
          status: "FAIL",
          resource: `appservice://${name}`,
          title: `Remote debugging enabled: ${name}`,
          details: "Remote debugging exposes additional ports and attack surface",
          remediation: `az webapp config set --name ${name} --resource-group ${appRg} --remote-debugging-enabled false`,
        })
        output.push("  [-] Remote debugging: ENABLED")
      }
    }

    const auth = await az(["webapp", "auth", "show", "--name", name, "--resource-group", appRg], sub, timeout)
    if (auth.exitCode === 0) {
      const authData = tryJson(auth.stdout)
      const enabled = authData?.enabled || authData?.properties?.enabled || false
      if (!enabled) {
        findings.push({
          checkId: "CIS-AZ-9.2",
          provider: "azure-cis",
          severity: "medium",
          status: "FAIL",
          resource: `appservice://${name}`,
          title: `Authentication disabled: ${name}`,
          details: "App Service authentication/authorization not enabled — anonymous access possible",
          remediation: `az webapp auth update --name ${name} --resource-group ${appRg} --enabled true`,
        })
        output.push("  [-] Authentication: disabled")
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function keyvaultSecurityAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Key Vault security (CIS 3.3.1-3.3.8)...\n"]

  const r = await az(["keyvault", "list"], sub, timeout)
  if (r.exitCode !== 0) return { output: `[-] Failed to list Key Vaults: ${r.stderr.trim()}`, findings }

  const vaults = tryJson(r.stdout) || []
  output.push(`[*] Found ${vaults.length} Key Vaults\n`)

  for (const vault of vaults) {
    const name = vault.name
    output.push(`[*] ${name}`)

    const props = vault.properties || vault

    if (!props.enableSoftDelete && props.enableSoftDelete !== undefined) {
      findings.push({
        checkId: "CIS-AZ-3.3.3",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `keyvault://${name}`,
        title: `Soft delete disabled: ${name}`,
        details: "Deleted keys/secrets/certificates cannot be recovered",
        remediation: "Soft delete is now enabled by default and cannot be disabled on new vaults",
      })
      output.push("  [-] Soft delete: disabled")
    }

    if (!props.enablePurgeProtection) {
      findings.push({
        checkId: "CIS-AZ-3.3.4",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: `keyvault://${name}`,
        title: `Purge protection disabled: ${name}`,
        details: "Soft-deleted items can be permanently purged before retention period expires",
        remediation: `az keyvault update --name ${name} --enable-purge-protection true`,
      })
      output.push("  [-] Purge protection: disabled")
    }

    if (!props.enableRbacAuthorization) {
      findings.push({
        checkId: "CIS-AZ-3.3.5",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `keyvault://${name}`,
        title: `RBAC authorization disabled: ${name}`,
        details: "Key Vault uses access policies instead of RBAC — less granular control",
        remediation: `az keyvault update --name ${name} --enable-rbac-authorization true`,
      })
      output.push("  [-] RBAC auth: disabled (using access policies)")
    }

    const privateEndpoints = props.privateEndpointConnections || []
    if (privateEndpoints.length === 0) {
      findings.push({
        checkId: "CIS-AZ-3.3.7",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: `keyvault://${name}`,
        title: `No private endpoints: ${name}`,
        details: "Key Vault accessible over public internet",
        remediation: "Create private endpoint for Key Vault",
      })
      output.push("  [-] Private endpoints: none")
    }

    const keys = await az(
      ["keyvault", "key", "list", "--vault-name", name, "--query", "[?attributes.enabled==`true`]"],
      sub,
      timeout,
    )
    if (keys.exitCode === 0) {
      for (const key of tryJson(keys.stdout) || []) {
        if (!key.attributes?.expires) {
          findings.push({
            checkId: "CIS-AZ-3.3.1",
            provider: "azure-cis",
            severity: "medium",
            status: "FAIL",
            resource: `keyvault://${name}/key/${key.kid?.split("/").pop() || "unknown"}`,
            title: `Key without expiry: ${key.kid?.split("/").pop() || "unknown"}`,
            details: "Key has no expiration date set — keys should be rotated",
            remediation: "Set an expiration date for the key",
          })
        }
      }
    }

    const secrets = await az(
      ["keyvault", "secret", "list", "--vault-name", name, "--query", "[?attributes.enabled==`true`]"],
      sub,
      timeout,
    )
    if (secrets.exitCode === 0) {
      for (const secret of tryJson(secrets.stdout) || []) {
        if (!secret.attributes?.expires) {
          findings.push({
            checkId: "CIS-AZ-3.3.2",
            provider: "azure-cis",
            severity: "medium",
            status: "FAIL",
            resource: `keyvault://${name}/secret/${secret.id?.split("/").pop() || "unknown"}`,
            title: `Secret without expiry: ${secret.id?.split("/").pop() || "unknown"}`,
            details: "Secret has no expiration date — secrets should be rotated",
            remediation: "Set an expiration date for the secret",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function identityMfaAudit(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing MFA enforcement (CIS 2.1.1-2.1.4)...\n"]

  const reg = await az(
    [
      "rest",
      "--method",
      "GET",
      "--url",
      "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$top=999",
    ],
    undefined,
    timeout,
  )
  if (reg.exitCode === 0) {
    const data = tryJson(reg.stdout)
    const users = data?.value || []
    const total = users.length
    const mfaRegistered = users.filter((u: Record<string, boolean>) => u.isMfaRegistered).length
    const pct = total > 0 ? Math.round((mfaRegistered / total) * 100) : 0

    output.push(`[*] MFA registration: ${mfaRegistered}/${total} users (${pct}%)`)

    if (pct < 100) {
      const unregistered = users.filter((u: Record<string, boolean | string>) => !u.isMfaRegistered).slice(0, 20)
      findings.push({
        checkId: "CIS-AZ-2.1.1",
        provider: "azure-cis",
        severity: "critical",
        status: "FAIL",
        resource: "identity://mfa",
        title: `MFA not registered for all users: ${mfaRegistered}/${total} (${pct}%)`,
        details: `${total - mfaRegistered} users without MFA. Examples: ${unregistered.map((u: Record<string, string>) => u.userPrincipalName).join(", ")}`,
        remediation: "Enforce MFA registration via Conditional Access policy or Security Defaults",
      })
    }
  } else {
    output.push("[-] Could not query MFA registration (Graph API permissions required)")
  }

  const ca = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/identity/conditionalAccessPolicies"],
    undefined,
    timeout,
  )
  if (ca.exitCode === 0) {
    const policies = tryJson(ca.stdout)?.value || []
    const enabled = policies.filter((p: Record<string, string>) => p.state === "enabled")
    output.push(`\n[*] Conditional Access policies: ${enabled.length} enabled / ${policies.length} total`)

    const mfaPolicies = enabled.filter((p: Record<string, unknown>) => {
      const gc = p.grantControls as Record<string, unknown> | undefined
      const controls = (gc?.builtInControls || []) as string[]
      return controls.includes("mfa")
    })

    if (mfaPolicies.length === 0) {
      findings.push({
        checkId: "CIS-AZ-2.1.3",
        provider: "azure-cis",
        severity: "critical",
        status: "FAIL",
        resource: "identity://conditional-access",
        title: "No Conditional Access policy enforces MFA",
        details: "No enabled CA policy requires multi-factor authentication",
        remediation: "Create a CA policy that requires MFA for all users (or at minimum, all admins)",
      })
      output.push("[-] No CA policy enforcing MFA found")
    } else {
      output.push(`[+] ${mfaPolicies.length} CA policies enforce MFA`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function guestAccessAudit(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing guest user access (CIS 2.6-2.8)...\n"]

  const guests = await az(
    [
      "ad",
      "user",
      "list",
      "--filter",
      "userType eq 'Guest'",
      "--query",
      "[].{upn:userPrincipalName,displayName:displayName,createdDateTime:createdDateTime}",
    ],
    undefined,
    timeout,
  )
  if (guests.exitCode === 0) {
    const guestList = tryJson(guests.stdout) || []
    output.push(`[*] Guest users: ${guestList.length}`)
    if (guestList.length > 0) {
      for (const g of guestList.slice(0, 10)) {
        output.push(`    ${g.displayName || g.upn} (${g.createdDateTime || "unknown"})`)
      }
      if (guestList.length > 10) output.push(`    ... and ${guestList.length - 10} more`)
    }

    if (guestList.length > 50) {
      findings.push({
        checkId: "CIS-AZ-2.6",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: "identity://guests",
        title: `High guest user count: ${guestList.length}`,
        details: "Large number of guest users increases attack surface — review and remove stale guests",
        remediation: "Perform regular access reviews for guest users",
      })
    }
  }

  const authPolicy = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/policies/authorizationPolicy"],
    undefined,
    timeout,
  )
  if (authPolicy.exitCode === 0) {
    const policy = tryJson(authPolicy.stdout)

    const guestInvite = policy?.allowInvitesFrom || "everyone"
    output.push(`\n[*] Guest invite setting: ${guestInvite}`)
    if (guestInvite === "everyone") {
      findings.push({
        checkId: "CIS-AZ-2.7",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: "identity://guest-invite",
        title: "Anyone can invite guest users",
        details: `Guest invite policy: '${guestInvite}' — all users including guests can invite more guests`,
        remediation: "Restrict guest invitations to admins only or specific users",
      })
    }

    const guestAccess = policy?.guestUserRoleId || ""
    const accessLevels: Record<string, string> = {
      "a0b1b346-4d3e-4e8b-98f8-753987be4970": "Same as member users (most permissive)",
      "10dae51f-b6af-4016-8d66-8c2a99b929b3": "Limited access (default)",
      "2af84b1e-32c8-42b7-82bc-daa82404023b": "Restricted access (most restrictive)",
    }
    const accessLevel = accessLevels[guestAccess] || guestAccess
    output.push(`[*] Guest access level: ${accessLevel}`)

    if (guestAccess === "a0b1b346-4d3e-4e8b-98f8-753987be4970") {
      findings.push({
        checkId: "CIS-AZ-2.8",
        provider: "azure-cis",
        severity: "high",
        status: "FAIL",
        resource: "identity://guest-access",
        title: "Guest users have same access as member users",
        details: "Guests can enumerate all users, groups, and directory objects",
        remediation: "Set guest user access to 'Restricted access' via Entra ID external collaboration settings",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function passwordPolicyAudit(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing password policies (CIS 2.10-2.14, 2.19)...\n"]

  const methods = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy"],
    undefined,
    timeout,
  )
  if (methods.exitCode === 0) {
    const policy = tryJson(methods.stdout)
    output.push(`[*] Authentication methods policy retrieved`)

    const configs = policy?.authenticationMethodConfigurations || []
    for (const cfg of configs) {
      output.push(`    ${cfg.id}: ${cfg.state || "unknown"}`)
    }
  } else {
    output.push("[-] Could not retrieve authentication methods policy")
  }

  const settings = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/settings"],
    undefined,
    timeout,
  )
  if (settings.exitCode === 0) {
    const data = tryJson(settings.stdout)
    const dirSettings = data?.value || []
    output.push(`\n[*] Directory settings: ${dirSettings.length}`)

    const passwordRule = dirSettings.find((s: Record<string, string>) => s.displayName === "Password Rule Settings")
    if (passwordRule) {
      const values = passwordRule.values || []
      const bannedList = values.find((v: Record<string, string>) => v.name === "BannedPasswordList")
      const enableBannedList = values.find((v: Record<string, string>) => v.name === "EnableBannedPasswordCheck")

      if (!enableBannedList || enableBannedList.value !== "True") {
        findings.push({
          checkId: "CIS-AZ-2.19",
          provider: "azure-cis",
          severity: "medium",
          status: "FAIL",
          resource: "identity://password-policy",
          title: "Custom banned password list not enabled",
          details: "Organization-specific banned passwords are not being checked",
          remediation: "Enable custom banned password list in Entra ID Password Protection",
        })
        output.push("[-] Custom banned password list: disabled")
      }

      if (bannedList && (!bannedList.value || bannedList.value.split(",").length < 3)) {
        findings.push({
          checkId: "CIS-AZ-2.19",
          provider: "azure-cis",
          severity: "low",
          status: "FAIL",
          resource: "identity://banned-passwords",
          title: "Custom banned password list is very short",
          details: "Fewer than 3 entries in custom banned password list",
          remediation: "Add organization-specific terms to the banned password list",
        })
      }
    }
  }

  const lockout = await az(
    ["rest", "--method", "GET", "--url", "https://graph.microsoft.com/beta/settings"],
    undefined,
    timeout,
  )
  if (lockout.exitCode === 0) {
    const data = tryJson(lockout.stdout)
    output.push("\n[*] Lockout settings retrieved via beta API")
    const lockoutSetting = (data?.value || []).find(
      (s: Record<string, string>) => s.displayName === "Password Rule Settings",
    )
    if (lockoutSetting) {
      const lockoutThreshold = lockoutSetting.values?.find((v: Record<string, string>) => v.name === "LockoutThreshold")
      if (lockoutThreshold) {
        output.push(`    Lockout threshold: ${lockoutThreshold.value}`)
        if (parseInt(lockoutThreshold.value) > 10) {
          findings.push({
            checkId: "CIS-AZ-2.12",
            provider: "azure-cis",
            severity: "medium",
            status: "FAIL",
            resource: "identity://lockout",
            title: `Smart lockout threshold too high: ${lockoutThreshold.value}`,
            details: "High lockout threshold allows more brute force attempts",
            remediation: "Set smart lockout threshold to 10 or fewer in Entra ID",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function resourceLockAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing resource locks (CIS 10.1)...\n"]

  const rgs = await az(["group", "list"], sub, timeout)
  if (rgs.exitCode !== 0) return { output: `[-] Failed to list resource groups: ${rgs.stderr.trim()}`, findings }

  const groups = tryJson(rgs.stdout) || []
  output.push(`[*] Found ${groups.length} resource groups\n`)

  let lockedCount = 0
  let unlockedCount = 0

  for (const group of groups) {
    const name = group.name
    const locks = await az(["lock", "list", "--resource-group", name], sub, timeout)
    if (locks.exitCode === 0) {
      const lockList = tryJson(locks.stdout) || []
      if (lockList.length === 0) {
        unlockedCount++
        output.push(`[-] ${name}: no locks`)
      } else {
        lockedCount++
        const lockTypes = lockList.map((l: Record<string, string>) => `${l.name}(${l.level})`).join(", ")
        output.push(`[+] ${name}: ${lockTypes}`)
      }
    }
  }

  if (unlockedCount > 0) {
    findings.push({
      checkId: "CIS-AZ-10.1",
      provider: "azure-cis",
      severity: "medium",
      status: "FAIL",
      resource: "subscription://resource-locks",
      title: `${unlockedCount} resource groups without locks`,
      details: `${unlockedCount}/${groups.length} resource groups have no CanNotDelete or ReadOnly locks`,
      remediation: "az lock create --name DoNotDelete --resource-group RG --lock-type CanNotDelete",
    })
  }

  output.push(`\n[*] Summary: ${lockedCount} locked, ${unlockedCount} unlocked out of ${groups.length} resource groups`)
  return { output: output.join("\n"), findings }
}

export async function policyComplianceAudit(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Azure Policy compliance...\n"]

  const assignments = await az(["policy", "assignment", "list"], sub, timeout)
  if (assignments.exitCode !== 0)
    return { output: `[-] Failed to list policy assignments: ${assignments.stderr.trim()}`, findings }

  const assignList = tryJson(assignments.stdout) || []
  output.push(`[*] Policy assignments: ${assignList.length}`)

  if (assignList.length === 0) {
    findings.push({
      checkId: "CIS-AZ-POLICY-001",
      provider: "azure-cis",
      severity: "high",
      status: "FAIL",
      resource: "subscription://policy",
      title: "No Azure Policy assignments",
      details: "No policies are assigned — no guardrails enforced",
      remediation: "Assign Azure Security Benchmark initiative or CIS Benchmark policy set",
    })
    return { output: output.join("\n"), findings }
  }

  const notEnforced = assignList.filter((a: Record<string, string>) => a.enforcementMode === "DoNotEnforce")
  if (notEnforced.length > 0) {
    output.push(`\n[!] Policies in DoNotEnforce mode: ${notEnforced.length}`)
    for (const p of notEnforced) {
      output.push(`    ${p.displayName || p.name}: DoNotEnforce`)
    }
    findings.push({
      checkId: "CIS-AZ-POLICY-002",
      provider: "azure-cis",
      severity: "medium",
      status: "FAIL",
      resource: "subscription://policy/enforcement",
      title: `${notEnforced.length} policies not enforced (audit-only)`,
      details: `Policies in DoNotEnforce mode: ${notEnforced.map((p: Record<string, string>) => p.displayName || p.name).join(", ")}`,
      remediation: "Change enforcement mode to Default for security-critical policies",
    })
  }

  const exemptions = await az(["policy", "exemption", "list"], sub, timeout)
  if (exemptions.exitCode === 0) {
    const exemptList = tryJson(exemptions.stdout) || []
    if (exemptList.length > 0) {
      output.push(`\n[!] Policy exemptions: ${exemptList.length}`)
      for (const e of exemptList) {
        output.push(`    ${e.displayName || e.name}: ${e.exemptionCategory || "Waiver"}`)
      }
      findings.push({
        checkId: "CIS-AZ-POLICY-003",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: "subscription://policy/exemptions",
        title: `${exemptList.length} policy exemptions found`,
        details: "Policy exemptions bypass security controls — review regularly",
        remediation: "Review and remove unnecessary policy exemptions",
      })
    }
  }

  const summary = await az(["policy", "state", "summarize"], sub, timeout)
  if (summary.exitCode === 0) {
    const data = tryJson(summary.stdout)
    const results = data?.results || data?.value?.[0]?.results || {}
    const nonCompliant = results.nonCompliantResources || 0
    const nonCompliantPolicies = results.nonCompliantPolicies || 0
    output.push(`\n[*] Compliance summary:`)
    output.push(`    Non-compliant resources: ${nonCompliant}`)
    output.push(`    Non-compliant policies: ${nonCompliantPolicies}`)

    if (nonCompliant > 0) {
      findings.push({
        checkId: "CIS-AZ-POLICY-004",
        provider: "azure-cis",
        severity: "medium",
        status: "FAIL",
        resource: "subscription://policy/compliance",
        title: `${nonCompliant} non-compliant resources across ${nonCompliantPolicies} policies`,
        details: "Resources violating assigned Azure policies",
        remediation: "Review non-compliant resources and remediate or exempt with justification",
      })
    }
  }

  return { output: output.join("\n"), findings }
}
