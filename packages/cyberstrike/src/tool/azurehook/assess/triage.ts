import type { Finding } from "../shared"
import type { TriageResult, TriageFlag } from "./types"

const TRIAGE_RULES: { key: string; label: string; pattern: RegExp; recommendation: string }[] = [
  {
    key: "privesc",
    label: "Privilege Escalation",
    pattern: /privilege.?escalat|privesc|role.?assign.*(owner|contributor)|global.?admin/i,
    recommendation: "run azurehook privesc programs (entra_privesc, pim_abuse, global_admin_elevate)",
  },
  {
    key: "public_exposure",
    label: "Public Exposure",
    pattern: /public.?(access|endpoint|ip|network)|internet.?facing|0\.0\.0\.0\/0/i,
    recommendation: "run azurehook credential programs (keyvault_dump, managed_identity, storage_key_dump)",
  },
  {
    key: "weak_auth",
    label: "Weak Authentication",
    pattern: /mfa.?(disabled|not.?enabled|gap)|weak.?password|credential.?(exposed|leak)|no.?password.?policy/i,
    recommendation: "run azurehook identity programs (password_spray, conditional_access_audit, mfa_manipulation)",
  },
  {
    key: "data_exfil",
    label: "Data Exfiltration Risk",
    pattern:
      /storage.*(public|anonymous)|blob.*(public|open)|shared.?access.?signature|sas.?token|unprotected.?backup/i,
    recommendation: "run azurehook exfil programs (storage_dump, cosmos_dump, data_lake_dump)",
  },
  {
    key: "lateral_movement",
    label: "Lateral Movement",
    pattern: /cross.?subscription|peering.*(active|connected)|shared.?key|run.?command|service.?connection/i,
    recommendation: "run azurehook lateral programs (vm_run_command, bastion_tunnel, cross_tenant_enum)",
  },
  {
    key: "persistence",
    label: "Persistence Risk",
    pattern:
      /automation.?account.*(credential|runbook)|logic.?app.*(http|webhook)|scheduled.?task|function.?app.*(http|timer)/i,
    recommendation: "run azurehook persistence programs (runbook_backdoor, logic_app_backdoor, sp_persist)",
  },
  {
    key: "unencrypted_data",
    label: "Unencrypted Data",
    pattern: /encrypt.*(disabled|off|not)|tls.*(disabled|1\.0|1\.1)|https.?only.*(false|disabled)|http.?traffic/i,
    recommendation: "enforce encryption at rest and TLS 1.2+ in transit for all data services",
  },
  {
    key: "logging_gaps",
    label: "Logging & Monitoring Gaps",
    pattern:
      /diagnostic.*(disabled|not.?configured)|no.?alert|log.*(disabled|not|missing)|monitor.*(gap|disabled)|watcher.*(disabled|not)/i,
    recommendation: "run azurehook evasion programs to assess blind spots (diagnostic_tamper, sentinel_suppress)",
  },
]

export function analyzeTriage(findings: Finding[]): TriageResult {
  const critical = findings.filter((f) => f.severity.toLowerCase() === "critical")
  const high = findings.filter((f) => f.severity.toLowerCase() === "high")
  const pool = [...critical, ...high]

  const flags: TriageFlag[] = []
  for (const rule of TRIAGE_RULES) {
    if (pool.some((f) => rule.pattern.test(f.title + f.details))) {
      flags.push({ key: rule.key, label: rule.label, recommendation: rule.recommendation })
    }
  }

  return { critical, high, flags }
}
