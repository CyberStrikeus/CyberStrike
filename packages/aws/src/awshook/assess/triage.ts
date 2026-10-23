import type { Finding } from "../shared"
import type { TriageResult, TriageFlag } from "./types"

const TRIAGE_RULES: { key: string; label: string; pattern: RegExp; recommendation: string }[] = [
  {
    key: "privesc",
    label: "Privilege Escalation",
    pattern: /privilege.?escalat|privesc|PassRole|AssumeRole.*admin|AdministratorAccess/i,
    recommendation: "run awshook privesc programs (auto_privesc_scan, iam_privesc, role_chain)",
  },
  {
    key: "public_exposure",
    label: "Public Exposure",
    pattern: /public.?(access|endpoint|ip|bucket)|internet.?facing|0\.0\.0\.0\/0/i,
    recommendation: "run awshook credential programs (secrets_dump, lambda_env_harvest, ec2_user_data)",
  },
  {
    key: "weak_auth",
    label: "Weak Authentication",
    pattern: /mfa.?(disabled|not.?enabled|gap)|weak.?password|credential.?(exposed|leak)|no.?password.?policy|root.*access.?key/i,
    recommendation: "run awshook identity programs (password_spray_aws, mfa_audit, root_account_audit)",
  },
  {
    key: "data_exfil",
    label: "Data Exfiltration Risk",
    pattern: /s3.*(public|anonymous)|bucket.*(public|open)|public.*snapshot|shared.*snapshot/i,
    recommendation: "run awshook exfil programs (s3_dump, rds_dump, secrets_bulk_export)",
  },
  {
    key: "lateral_movement",
    label: "Lateral Movement",
    pattern: /cross.?account|peering.*(active|connected)|run.?command|ssm.*(exec|session)|vpc.*pivot/i,
    recommendation: "run awshook lateral programs (ssm_exec, cross_account_enum, eks_lateral)",
  },
  {
    key: "persistence",
    label: "Persistence Risk",
    pattern: /backdoor|scheduled.?(task|rule)|state.?manager|lambda.*(inject|layer)/i,
    recommendation: "run awshook persistence programs (lambda_backdoor, iam_backdoor, eventbridge_backdoor)",
  },
  {
    key: "unencrypted_data",
    label: "Unencrypted Data",
    pattern: /encrypt.*(disabled|off|not)|unencrypted|tls.*(disabled|1\.0|1\.1)/i,
    recommendation: "enforce encryption at rest and TLS 1.2+ in transit for all data services",
  },
  {
    key: "logging_gaps",
    label: "Logging & Monitoring Gaps",
    pattern: /cloudtrail.*(disabled|not|stopped)|guardduty.*(disabled|not)|flow.?log.*(disabled|not|missing)|logging.*(disabled|not)/i,
    recommendation: "run awshook evasion programs to assess blind spots (cloudtrail_blind, guardduty_evade)",
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
