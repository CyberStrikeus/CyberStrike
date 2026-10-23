import type { Finding } from "../shared"
import type { TriageResult, TriageFlag } from "./types"

const TRIAGE_RULES: { key: string; label: string; pattern: RegExp; recommendation: string }[] = [
  {
    key: "privesc",
    label: "Privilege Escalation",
    pattern: /privilege.?escalat|privesc|actAs|setIamPolicy|iam\.serviceAccounts\.create/i,
    recommendation: "run gcphook privesc programs (gcp_privesc, custom_role_abuse, os_login_abuse)",
  },
  {
    key: "public_exposure",
    label: "Public Exposure",
    pattern: /public.?(access|endpoint|ip|bucket)|allUsers|allAuthenticatedUsers|0\.0\.0\.0\/0/i,
    recommendation: "run gcphook credential programs (secrets_dump_gcp, metadata_harvest_gcp)",
  },
  {
    key: "weak_auth",
    label: "Weak Authentication",
    pattern: /key.*older|stale.*key|no.*rotation|disabled.*account|primitive.*role.*owner/i,
    recommendation: "run gcphook identity programs (iam_analyzer, sa_key_create --check-only)",
  },
  {
    key: "data_exfil",
    label: "Data Exfiltration Risk",
    pattern: /public.*(bucket|snapshot)|storage.*(public|open)|bigquery.*(public|allUsers)/i,
    recommendation: "run gcphook exfil programs (gcs_dump, bigquery_dump, source_repo_dump)",
  },
  {
    key: "lateral_movement",
    label: "Lateral Movement",
    pattern: /cross.?project|peering|os.login|metadata.*harvest|workload.identity/i,
    recommendation: "run gcphook credential programs (metadata_harvest_gcp, os_login_abuse)",
  },
  {
    key: "persistence",
    label: "Persistence Risk",
    pattern: /backdoor|scheduler|cloud.build|composer|persistent/i,
    recommendation: "run gcphook persistence programs (cloudfunc_backdoor, cloud_run_backdoor, scheduler_persist)",
  },
  {
    key: "unencrypted_data",
    label: "Unencrypted Data",
    pattern: /encrypt.*(disabled|off|not)|unencrypted|ssl.*(disabled|not.?required)/i,
    recommendation: "enforce CMEK encryption and SSL for all data services",
  },
  {
    key: "logging_gaps",
    label: "Logging & Monitoring Gaps",
    pattern: /audit.*log.*(disabled|not)|flow.*log.*(disabled|missing)|no.*log.*sink|logging.*(disabled|not)/i,
    recommendation: "run gcphook evasion programs to assess blind spots (audit_log_tamper --action status, vpc_flow_tamper --action status)",
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
