import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function resourceHijack(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Detecting crypto-mining / resource hijacking indicators (T1496)...\n"]

  const vms = await az(["vm", "list", "-d"], sub, timeout)
  if (vms.exitCode === 0) {
    for (const vm of tryJson(vms.stdout) || []) {
      const size = vm.hardwareProfile?.vmSize || ""
      const isGpu = /Standard_(N|ND|NC|NV)/i.test(size)
      const isHighCpu = /Standard_(F|H|D\d+s)/i.test(size) && parseInt(size.replace(/\D/g, "")) >= 64

      if (isGpu) {
        findings.push({
          checkId: "AZ-HIJACK-001",
          provider: "azure-impact",
          severity: "medium",
          status: "INFO",
          resource: `vm://${vm.name}`,
          title: `GPU VM detected: ${vm.name} (${size})`,
          details: "GPU VMs are high-value targets for cryptomining. Verify legitimate workload",
          remediation: "Review VM owner and workload justification",
        })
        output.push(`[!] GPU VM: ${vm.name} (${size}) — cryptomining target`)
      }
      if (isHighCpu) {
        output.push(`[!] High-CPU VM: ${vm.name} (${size})`)
      }
    }
  }

  const budgets = await az(["consumption", "budget", "list"], sub, timeout)
  if (budgets.exitCode === 0) {
    const budgetList = tryJson(budgets.stdout) || []
    if (budgetList.length === 0) {
      findings.push({
        checkId: "AZ-HIJACK-002",
        provider: "azure-impact",
        severity: "medium",
        status: "FAIL",
        resource: "subscription://budgets",
        title: "No cost budgets configured",
        details: "Without budget alerts, crypto-mining costs can go unnoticed for weeks",
        remediation: "az consumption budget create --budget-name CostAlert --amount 1000 --time-grain Monthly",
      })
      output.push("[-] No cost budgets — mining costs would go unnoticed")
    } else {
      output.push(`[+] ${budgetList.length} cost budgets configured`)
    }
  }

  const advisories = await az(["advisor", "recommendation", "list", "--filter", "Category eq 'Cost'"], sub, timeout)
  if (advisories.exitCode === 0) {
    const recs = tryJson(advisories.stdout) || []
    const unusedVMs = recs.filter((r: Record<string, unknown>) => {
      const sd = r.shortDescription as Record<string, string> | undefined
      const problem = (sd?.problem || "").toLowerCase()
      return problem.includes("shut down") || problem.includes("underutilized")
    })
    if (unusedVMs.length > 0) {
      output.push(`\n[!] ${unusedVMs.length} underutilized/idle VMs (potential hijack or waste)`)
      for (const r of unusedVMs.slice(0, 5)) {
        output.push(`    ${r.resourceMetadata?.resourceId?.split("/").pop() || "unknown"}: ${r.shortDescription?.problem || ""}`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function dataDestroy(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const dryRun = hasFlag(args, "--dry-run")
  const findings: Finding[] = []
  const output: string[] = [`[*] Assessing data destruction risk (T1485)${dryRun ? " [DRY RUN]" : ""}...\n`]

  const storage = await az(["storage", "account", "list"], sub, timeout)
  if (storage.exitCode === 0) {
    for (const acct of tryJson(storage.stdout) || []) {
      const softDelete = acct.properties?.blobServiceProperties?.deleteRetentionPolicy?.enabled
      const locks = await az(["lock", "list", "--resource-group", acct.resourceGroup, "--resource-name", acct.name, "--resource-type", "Microsoft.Storage/storageAccounts"], sub, timeout)
      const hasLock = locks.exitCode === 0 && (tryJson(locks.stdout) || []).length > 0

      if (!softDelete && !hasLock) {
        findings.push({
          checkId: "AZ-DESTROY-001",
          provider: "azure-impact",
          severity: "critical",
          status: "FAIL",
          resource: `storage://${acct.name}`,
          title: `Unprotected storage: ${acct.name}`,
          details: "No soft delete and no resource lock — data can be permanently deleted",
          remediation: "Enable blob soft delete and add CanNotDelete resource lock",
        })
        output.push(`[-] ${acct.name}: no soft delete, no lock — DESTRUCTIBLE`)
      } else {
        output.push(`[+] ${acct.name}: ${softDelete ? "soft-delete" : ""}${hasLock ? " locked" : ""}`)
      }
    }
  }

  const sql = await az(["sql", "server", "list"], sub, timeout)
  if (sql.exitCode === 0) {
    for (const srv of tryJson(sql.stdout) || []) {
      const dbs = await az(["sql", "db", "list", "--server", srv.name, "--resource-group", srv.resourceGroup], sub, timeout)
      if (dbs.exitCode === 0) {
        for (const db of tryJson(dbs.stdout) || []) {
          if (db.name === "master") continue
          const retention = db.backupLongTermRetentionPolicy || {}
          if (!retention.weeklyRetention && !retention.monthlyRetention) {
            findings.push({
              checkId: "AZ-DESTROY-002",
              provider: "azure-impact",
              severity: "high",
              status: "FAIL",
              resource: `sql://${srv.name}/${db.name}`,
              title: `No LTR backup: ${db.name}`,
              details: "No long-term backup retention — data loss risk is high if deleted",
              remediation: "Configure long-term retention policy for the database",
            })
            output.push(`[-] SQL ${srv.name}/${db.name}: no LTR backup`)
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function ransomwareSim(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Ransomware simulation — assessing encryption risk (T1486)...\n"]
  output.push("[!] SIMULATION ONLY — no data will be encrypted\n")

  const storage = await az(["storage", "account", "list"], sub, timeout)
  if (storage.exitCode === 0) {
    const accounts = tryJson(storage.stdout) || []
    let vulnerable = 0
    for (const acct of accounts) {
      const hasImmutability = acct.properties?.immutableStorageWithVersioning?.enabled
      const hasSoftDelete = acct.properties?.blobServiceProperties?.deleteRetentionPolicy?.enabled
      const hasVersioning = acct.properties?.blobServiceProperties?.isVersioningEnabled

      if (!hasImmutability && !hasVersioning) {
        vulnerable++
        findings.push({
          checkId: "AZ-RANSOM-001",
          provider: "azure-impact",
          severity: "critical",
          status: "FAIL",
          resource: `storage://${acct.name}`,
          title: `Ransomware-vulnerable storage: ${acct.name}`,
          details: "No immutable storage or versioning — blobs can be overwritten/encrypted with no recovery",
          remediation: "Enable immutable storage with versioning or blob versioning with soft delete",
        })
        output.push(`[-] ${acct.name}: NO immutability, NO versioning — ransomware target`)
      } else {
        output.push(`[+] ${acct.name}: ${hasImmutability ? "immutable" : ""}${hasVersioning ? " versioned" : ""}`)
      }
    }
    output.push(`\n[*] ${vulnerable}/${accounts.length} storage accounts vulnerable to ransomware`)
  }

  const vms = await az(["vm", "list", "-d"], sub, timeout)
  if (vms.exitCode === 0) {
    const vmList = tryJson(vms.stdout) || []
    let noBackup = 0
    for (const vm of vmList) {
      const status = await az(["backup", "protection", "check-vm", "--vm-id", vm.id], sub, timeout)
      if (status.exitCode !== 0) {
        noBackup++
        findings.push({
          checkId: "AZ-RANSOM-002",
          provider: "azure-impact",
          severity: "high",
          status: "FAIL",
          resource: `vm://${vm.name}`,
          title: `No backup configured: ${vm.name}`,
          details: "VM has no Azure Backup — ransomware encryption = permanent data loss",
          remediation: "Enable Azure Backup for the VM",
        })
        output.push(`[-] ${vm.name}: no backup — ransomware = total loss`)
      }
    }
    output.push(`\n[*] ${noBackup}/${vmList.length} VMs without backup`)
  }

  return { output: output.join("\n"), findings }
}

export async function accountLockout(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Assessing account access removal capabilities (T1531)...\n"]

  const admins = await az(["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/directoryRoles/filterByRoleTemplateId(roleTemplateId='62e90394-69f5-4237-9190-012177145e10')/members"], undefined, timeout)
  if (admins.exitCode === 0) {
    const globalAdmins = tryJson(admins.stdout)?.value || []
    output.push(`[*] Global Administrators: ${globalAdmins.length}`)

    if (globalAdmins.length < 2) {
      findings.push({
        checkId: "AZ-LOCKOUT-001",
        provider: "azure-impact",
        severity: "critical",
        status: "FAIL",
        resource: "identity://global-admins",
        title: "Single Global Admin — lockout risk",
        details: "Only 1 GA account. If compromised/locked, no recovery path",
        remediation: "Create at least 2 break-glass GA accounts with MFA",
      })
      output.push("[-] CRITICAL: Only 1 GA — single point of failure")
    } else if (globalAdmins.length > 5) {
      findings.push({
        checkId: "AZ-LOCKOUT-002",
        provider: "azure-impact",
        severity: "medium",
        status: "FAIL",
        resource: "identity://global-admins",
        title: `Too many Global Admins: ${globalAdmins.length}`,
        details: "Excessive GA count increases attack surface for lockout attacks",
        remediation: "Reduce to 2-4 GA accounts, use PIM for the rest",
      })
    }

    for (const admin of globalAdmins) {
      output.push(`    ${admin.displayName || admin.userPrincipalName}`)
    }
  }

  const breakGlass = await az(["rest", "--method", "GET", "--url", "https://graph.microsoft.com/v1.0/users?$filter=startswith(displayName,'BreakGlass') or startswith(displayName,'Emergency') or startswith(displayName,'Break Glass')&$select=displayName,userPrincipalName,accountEnabled"], undefined, timeout)
  if (breakGlass.exitCode === 0) {
    const bgAccounts = tryJson(breakGlass.stdout)?.value || []
    if (bgAccounts.length === 0) {
      findings.push({
        checkId: "AZ-LOCKOUT-003",
        provider: "azure-impact",
        severity: "high",
        status: "FAIL",
        resource: "identity://break-glass",
        title: "No break-glass accounts detected",
        details: "No emergency access accounts found — tenant lockout has no recovery path",
        remediation: "Create 2 break-glass accounts excluded from all CA policies, with hardware FIDO2 keys",
      })
      output.push("\n[-] No break-glass accounts detected")
    } else {
      output.push(`\n[+] Break-glass accounts: ${bgAccounts.length}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function serviceDisruption(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const findings: Finding[] = []
  const output: string[] = ["[*] Assessing service disruption risk (T1489)...\n"]

  const apps = await az(["webapp", "list"], sub, timeout)
  if (apps.exitCode === 0) {
    for (const app of tryJson(apps.stdout) || []) {
      const slots = await az(["webapp", "deployment", "slot", "list", "--name", app.name, "--resource-group", app.resourceGroup], sub, timeout)
      const hasSlots = slots.exitCode === 0 && (tryJson(slots.stdout) || []).length > 0
      if (!hasSlots) {
        findings.push({
          checkId: "AZ-DISRUPT-001",
          provider: "azure-impact",
          severity: "medium",
          status: "FAIL",
          resource: `appservice://${app.name}`,
          title: `No deployment slots: ${app.name}`,
          details: "Single slot — app deletion/stop = immediate outage with no rollback",
          remediation: "Create staging slot for rollback capability",
        })
        output.push(`[-] ${app.name}: no deployment slots — fragile`)
      }
    }
  }

  const locks = await az(["lock", "list"], sub, timeout)
  if (locks.exitCode === 0) {
    const lockList = tryJson(locks.stdout) || []
    const deleteProtected = lockList.filter((l: Record<string, string>) => l.level === "CanNotDelete" || l.level === "ReadOnly")
    output.push(`\n[*] Resource locks: ${lockList.length} total, ${deleteProtected.length} delete-protected`)

    if (deleteProtected.length === 0) {
      findings.push({
        checkId: "AZ-DISRUPT-002",
        provider: "azure-impact",
        severity: "high",
        status: "FAIL",
        resource: "subscription://locks",
        title: "No delete-protection locks on any resource",
        details: "Any user with Contributor role can delete critical resources",
        remediation: "Add CanNotDelete locks to production resource groups",
      })
      output.push("[-] No delete-protection locks — all resources can be destroyed")
    }
  }

  const actionGroups = await az(["monitor", "action-group", "list"], sub, timeout)
  if (actionGroups.exitCode === 0) {
    const groups = tryJson(actionGroups.stdout) || []
    if (groups.length === 0) {
      findings.push({
        checkId: "AZ-DISRUPT-003",
        provider: "azure-impact",
        severity: "medium",
        status: "FAIL",
        resource: "monitor://action-groups",
        title: "No alert action groups configured",
        details: "No notification channels for service disruption alerts",
        remediation: "Create action groups with email/SMS/webhook for critical alerts",
      })
      output.push("[-] No alert action groups — disruptions would go unnoticed")
    }
  }

  return { output: output.join("\n"), findings }
}
