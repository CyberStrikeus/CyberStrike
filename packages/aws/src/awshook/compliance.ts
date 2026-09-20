import { aws, argVal, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function cloudtrailAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing CloudTrail configuration (CIS 3.x)...\n"]

  const trails = await aws(["cloudtrail", "describe-trails"], profile, region, timeout)
  if (trails.exitCode !== 0) return { output: `[-] Failed to describe trails: ${trails.stderr.trim()}`, findings }
  const list = tryJson(trails.stdout)?.trailList || []
  output.push(`[+] CloudTrail trails: ${list.length}`)

  if (list.length === 0) {
    findings.push({ checkId: "CIS-AWS-3.1", provider: "aws-cis", severity: "critical", status: "FAIL", resource: "cloudtrail://none", title: "No CloudTrail trails configured", details: "No trails exist — all API activity is unlogged", remediation: "aws cloudtrail create-trail --name main-trail --s3-bucket-name <bucket> --is-multi-region-trail" })
    return { output: output.join("\n"), findings }
  }

  let hasMultiRegion = false
  for (const t of list) {
    const name = t.Name || t.TrailARN?.split("/").pop() || "unknown"
    const status = await aws(["cloudtrail", "get-trail-status", "--name", t.TrailARN || name], profile, region, timeout)
    const st = tryJson(status.stdout) || {}
    const logging = st.IsLogging === true

    output.push(`\n  Trail: ${name}`)
    output.push(`    MultiRegion: ${t.IsMultiRegionTrail}, Logging: ${logging}`)
    output.push(`    S3Bucket: ${t.S3BucketName}, LogFileValidation: ${t.LogFileValidationEnabled}`)
    output.push(`    KMS: ${t.KmsKeyId || "none"}, CloudWatch: ${t.CloudWatchLogsLogGroupArn || "none"}`)

    if (t.IsMultiRegionTrail) hasMultiRegion = true

    if (!logging) {
      findings.push({ checkId: "CIS-AWS-3.1", provider: "aws-cis", severity: "critical", status: "FAIL", resource: `cloudtrail://${name}`, title: `CloudTrail ${name} is not logging`, details: "Trail exists but logging is stopped", remediation: `aws cloudtrail start-logging --name ${name}` })
    }
    if (!t.LogFileValidationEnabled) {
      findings.push({ checkId: "CIS-AWS-3.2", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `cloudtrail://${name}`, title: `Log file validation disabled on ${name}`, details: "Tampered logs cannot be detected", remediation: `aws cloudtrail update-trail --name ${name} --enable-log-file-validation` })
    }
    if (!t.KmsKeyId) {
      findings.push({ checkId: "CIS-AWS-3.7", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `cloudtrail://${name}`, title: `CloudTrail ${name} not encrypted with CMK`, details: "Logs use default SSE-S3 — CMK provides additional access controls", remediation: `aws cloudtrail update-trail --name ${name} --kms-key-id <key-arn>` })
    }
    if (!t.CloudWatchLogsLogGroupArn) {
      findings.push({ checkId: "CIS-AWS-3.4", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `cloudtrail://${name}`, title: `CloudTrail ${name} not integrated with CloudWatch`, details: "Real-time alerting on API events not possible", remediation: `aws cloudtrail update-trail --name ${name} --cloud-watch-logs-log-group-arn <arn> --cloud-watch-logs-role-arn <role-arn>` })
    }

    const selectors = await aws(["cloudtrail", "get-event-selectors", "--trail-name", t.TrailARN || name], profile, region, timeout)
    const sel = tryJson(selectors.stdout)
    if (sel) {
      const mgmt = sel.EventSelectors?.[0]?.IncludeManagementEvents
      if (mgmt === false) {
        findings.push({ checkId: "CIS-AWS-3.10", provider: "aws-cis", severity: "high", status: "FAIL", resource: `cloudtrail://${name}`, title: `Management events excluded on ${name}`, details: "Management events (IAM, EC2, S3 ops) are not logged", remediation: "Update event selectors to include management events" })
      }
    }
  }

  if (!hasMultiRegion) {
    findings.push({ checkId: "CIS-AWS-3.1", provider: "aws-cis", severity: "high", status: "FAIL", resource: "cloudtrail://all", title: "No multi-region CloudTrail trail", details: "Activity in non-primary regions is invisible", remediation: "aws cloudtrail update-trail --name <trail> --is-multi-region-trail" })
  }

  output.push(`\n[*] Summary: ${findings.length} compliance issues found`)
  return { output: output.join("\n"), findings }
}

export async function configAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing AWS Config (CIS 3.5)...\n"]

  const recorders = await aws(["configservice", "describe-configuration-recorders"], profile, region, timeout)
  if (recorders.exitCode !== 0) return { output: `[-] Failed to describe recorders: ${recorders.stderr.trim()}`, findings }
  const recs = tryJson(recorders.stdout)?.ConfigurationRecorders || []

  if (recs.length === 0) {
    findings.push({ checkId: "CIS-AWS-3.5", provider: "aws-cis", severity: "high", status: "FAIL", resource: "config://none", title: "AWS Config not enabled", details: "No configuration recorder — resource changes untracked", remediation: "Enable AWS Config with recording for all resource types" })
    return { output: output.join("\n"), findings }
  }

  for (const rec of recs) {
    output.push(`[+] Recorder: ${rec.name}`)
    output.push(`    AllSupported: ${rec.recordingGroup?.allSupported}`)
    output.push(`    IncludeGlobal: ${rec.recordingGroup?.includeGlobalResourceTypes}`)

    if (!rec.recordingGroup?.allSupported) {
      findings.push({ checkId: "CIS-AWS-3.5", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `config://${rec.name}`, title: `Config recorder ${rec.name} not recording all resources`, details: "Only specific resource types are recorded", remediation: "Update recording group to allSupported=true" })
    }
    if (!rec.recordingGroup?.includeGlobalResourceTypes) {
      findings.push({ checkId: "CIS-AWS-3.5", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `config://${rec.name}`, title: `Config recorder ${rec.name} excludes global resources`, details: "IAM and other global resources are not tracked", remediation: "Set includeGlobalResourceTypes to true" })
    }
  }

  const status = await aws(["configservice", "describe-configuration-recorder-status"], profile, region, timeout)
  const statuses = tryJson(status.stdout)?.ConfigurationRecordersStatus || []
  for (const s of statuses) {
    if (!s.recording) {
      findings.push({ checkId: "CIS-AWS-3.5", provider: "aws-cis", severity: "high", status: "FAIL", resource: `config://${s.name}`, title: `Config recorder ${s.name} is not recording`, details: "Recorder exists but is stopped", remediation: `aws configservice start-configuration-recorder --configuration-recorder-name ${s.name}` })
    }
  }

  const rules = await aws(["configservice", "describe-config-rules", "--query", "ConfigRules[].{Name:ConfigRuleName,State:ConfigRuleState}"], profile, region, timeout)
  const ruleList = tryJson(rules.stdout) || []
  output.push(`\n[+] Config Rules: ${ruleList.length}`)
  const inactive = ruleList.filter((r: Record<string, string>) => r.State !== "ACTIVE")
  if (inactive.length > 0) {
    output.push(`[!] Inactive rules: ${inactive.map((r: Record<string, string>) => r.Name).join(", ")}`)
  }

  const packs = await aws(["configservice", "describe-conformance-packs", "--query", "ConformancePackDetails[].ConformancePackName"], profile, region, timeout)
  const packList = tryJson(packs.stdout) || []
  output.push(`[+] Conformance Packs: ${packList.length}`)

  output.push(`\n[*] Summary: ${findings.length} compliance issues found`)
  return { output: output.join("\n"), findings }
}

export async function guarddutyAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing GuardDuty (CIS 4.15)...\n"]

  const detectors = await aws(["guardduty", "list-detectors"], profile, region, timeout)
  if (detectors.exitCode !== 0) return { output: `[-] Failed to list detectors: ${detectors.stderr.trim()}`, findings }
  const ids = tryJson(detectors.stdout)?.DetectorIds || []

  if (ids.length === 0) {
    findings.push({ checkId: "CIS-AWS-4.15", provider: "aws-cis", severity: "high", status: "FAIL", resource: "guardduty://none", title: "GuardDuty not enabled", details: "No GuardDuty detectors — threat detection inactive", remediation: "aws guardduty create-detector --enable" })
    return { output: output.join("\n"), findings }
  }

  for (const id of ids) {
    const det = await aws(["guardduty", "get-detector", "--detector-id", id], profile, region, timeout)
    const d = tryJson(det.stdout) || {}
    output.push(`[+] Detector: ${id}`)
    output.push(`    Status: ${d.Status}`)
    output.push(`    DataSources: S3=${d.DataSources?.S3Logs?.Status || "?"}, DNS=${d.DataSources?.DNSLogs?.Status || "?"}, K8s=${d.DataSources?.Kubernetes?.AuditLogs?.Status || "?"}`)

    if (d.Status !== "ENABLED") {
      findings.push({ checkId: "CIS-AWS-4.15", provider: "aws-cis", severity: "high", status: "FAIL", resource: `guardduty://${id}`, title: `GuardDuty detector ${id} is not enabled`, details: `Status: ${d.Status}`, remediation: `aws guardduty update-detector --detector-id ${id} --enable` })
    }

    const findingsReq = await aws(["guardduty", "get-findings-statistics", "--detector-id", id, "--finding-statistic-types", "COUNT_BY_SEVERITY"], profile, region, timeout)
    const stats = tryJson(findingsReq.stdout)?.FindingStatistics?.CountBySeverity || {}
    const total = Object.values(stats).reduce((a: number, b) => a + (b as number), 0)
    output.push(`    Active findings: ${total} (by severity: ${JSON.stringify(stats)})`)
    if ((stats["8.0"] || 0) > 0 || (stats["7.0"] || 0) > 0) {
      findings.push({ checkId: "AWS-GD-001", provider: "aws", severity: "high", status: "FAIL", resource: `guardduty://${id}`, title: `GuardDuty has ${(stats["8.0"] || 0) + (stats["7.0"] || 0)} high/critical severity findings`, details: `Severity breakdown: ${JSON.stringify(stats)}`, remediation: "Review and remediate active GuardDuty findings" })
    }
  }

  output.push(`\n[*] Summary: ${findings.length} compliance issues found`)
  return { output: output.join("\n"), findings }
}

export async function securityHubAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Security Hub...\n"]

  const hub = await aws(["securityhub", "describe-hub"], profile, region, timeout)
  if (hub.exitCode !== 0) {
    findings.push({ checkId: "AWS-SH-001", provider: "aws-cis", severity: "medium", status: "FAIL", resource: "securityhub://none", title: "Security Hub not enabled", details: "Centralized security findings aggregation is disabled", remediation: "aws securityhub enable-security-hub --enable-default-standards" })
    return { output: "[-] Security Hub not enabled in this region\n" + output.join("\n"), findings }
  }

  const hubInfo = tryJson(hub.stdout) || {}
  output.push(`[+] Security Hub enabled: ${hubInfo.HubArn}`)
  output.push(`    AutoEnable: ${hubInfo.AutoEnableControls}`)

  const standards = await aws(["securityhub", "get-enabled-standards"], profile, region, timeout)
  const stdList = tryJson(standards.stdout)?.StandardsSubscriptions || []
  output.push(`\n[+] Enabled standards: ${stdList.length}`)
  for (const s of stdList) {
    output.push(`    ${s.StandardsArn?.split("/").pop() || s.StandardsSubscriptionArn} — ${s.StandardsStatus}`)
  }

  if (stdList.length === 0) {
    findings.push({ checkId: "AWS-SH-002", provider: "aws-cis", severity: "medium", status: "FAIL", resource: "securityhub://standards", title: "No security standards enabled in Security Hub", details: "Hub is active but no CIS/PCI/FSBP standard is enabled", remediation: "Enable CIS AWS Foundations and AWS FSBP standards" })
  }

  const findingsSummary = await aws(["securityhub", "get-findings", "--filters", '{"SeverityLabel":[{"Value":"CRITICAL","Comparison":"EQUALS"}],"WorkflowStatus":[{"Value":"NEW","Comparison":"EQUALS"}]}', "--max-items", "10", "--query", "Findings[].{Title:Title,Severity:Severity.Label,Resource:Resources[0].Id}"], profile, region, timeout)
  const critFindings = tryJson(findingsSummary.stdout) || []
  if (critFindings.length > 0) {
    output.push(`\n[!] Critical findings (up to 10):`)
    for (const f of critFindings) {
      output.push(`    ${f.Severity}: ${f.Title} — ${f.Resource || "N/A"}`)
    }
  }

  output.push(`\n[*] Summary: ${findings.length} compliance issues found`)
  return { output: output.join("\n"), findings }
}

export async function iamPasswordPolicyAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing IAM Password Policy (CIS 1.8-1.14)...\n"]

  const policy = await aws(["iam", "get-account-password-policy"], profile, region, timeout)
  if (policy.exitCode !== 0) {
    findings.push({ checkId: "CIS-AWS-1.8", provider: "aws-cis", severity: "high", status: "FAIL", resource: "iam://password-policy", title: "No IAM password policy configured", details: "Default password policy allows weak passwords", remediation: "aws iam update-account-password-policy --minimum-password-length 14 --require-symbols --require-numbers --require-uppercase-characters --require-lowercase-characters --max-password-age 90 --password-reuse-prevention 24" })
    return { output: output.join("\n"), findings }
  }

  const p = tryJson(policy.stdout)?.PasswordPolicy || {}
  output.push(`[+] MinLength: ${p.MinimumPasswordLength}, MaxAge: ${p.MaxPasswordAge || "none"}`)
  output.push(`    RequireUpper: ${p.RequireUppercaseCharacters}, RequireLower: ${p.RequireLowercaseCharacters}`)
  output.push(`    RequireNumbers: ${p.RequireNumbers}, RequireSymbols: ${p.RequireSymbols}`)
  output.push(`    ReusePrevent: ${p.PasswordReusePrevention || "none"}, ExpirePasswords: ${p.ExpirePasswords}`)

  if ((p.MinimumPasswordLength || 0) < 14) {
    findings.push({ checkId: "CIS-AWS-1.8", provider: "aws-cis", severity: "medium", status: "FAIL", resource: "iam://password-policy", title: `Password minimum length ${p.MinimumPasswordLength} < 14`, details: "CIS recommends minimum 14 characters", remediation: "aws iam update-account-password-policy --minimum-password-length 14" })
  }
  if (!p.RequireUppercaseCharacters) findings.push({ checkId: "CIS-AWS-1.9", provider: "aws-cis", severity: "low", status: "FAIL", resource: "iam://password-policy", title: "Uppercase characters not required", details: "Reduces password complexity", remediation: "--require-uppercase-characters" })
  if (!p.RequireLowercaseCharacters) findings.push({ checkId: "CIS-AWS-1.10", provider: "aws-cis", severity: "low", status: "FAIL", resource: "iam://password-policy", title: "Lowercase characters not required", details: "Reduces password complexity", remediation: "--require-lowercase-characters" })
  if (!p.RequireSymbols) findings.push({ checkId: "CIS-AWS-1.11", provider: "aws-cis", severity: "low", status: "FAIL", resource: "iam://password-policy", title: "Symbols not required", details: "Reduces password complexity", remediation: "--require-symbols" })
  if (!p.RequireNumbers) findings.push({ checkId: "CIS-AWS-1.12", provider: "aws-cis", severity: "low", status: "FAIL", resource: "iam://password-policy", title: "Numbers not required", details: "Reduces password complexity", remediation: "--require-numbers" })
  if ((p.PasswordReusePrevention || 0) < 24) findings.push({ checkId: "CIS-AWS-1.13", provider: "aws-cis", severity: "medium", status: "FAIL", resource: "iam://password-policy", title: `Password reuse prevention ${p.PasswordReusePrevention || 0} < 24`, details: "CIS recommends preventing reuse of last 24 passwords", remediation: "--password-reuse-prevention 24" })
  if ((p.MaxPasswordAge || 999) > 90) findings.push({ checkId: "CIS-AWS-1.14", provider: "aws-cis", severity: "medium", status: "FAIL", resource: "iam://password-policy", title: `Max password age ${p.MaxPasswordAge || "unlimited"} > 90 days`, details: "CIS recommends 90-day max age", remediation: "--max-password-age 90" })

  output.push(`\n[*] Summary: ${findings.length} compliance issues found`)
  return { output: output.join("\n"), findings }
}

export async function iamMfaAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing IAM MFA compliance (CIS 1.5-1.6)...\n"]

  const summary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  const sum = tryJson(summary.stdout)?.SummaryMap || {}
  output.push(`[+] Account summary: ${sum.Users} users, ${sum.MFADevicesInUse} MFA devices`)

  const root = await aws(["iam", "get-account-summary", "--query", "SummaryMap.AccountMFAEnabled"], profile, region, timeout)
  const rootMfa = tryJson(root.stdout)
  if (rootMfa === 0) {
    findings.push({ checkId: "CIS-AWS-1.5", provider: "aws-cis", severity: "critical", status: "FAIL", resource: "iam://root", title: "Root account MFA not enabled", details: "Root has unrestricted access — MFA is mandatory", remediation: "Enable hardware MFA for root account" })
  }
  output.push(`[+] Root MFA: ${rootMfa === 1 ? "enabled" : "DISABLED"}`)

  const users = await aws(["iam", "list-users", "--query", "Users[].UserName"], profile, region, timeout)
  const userList = tryJson(users.stdout) || []

  let noMfa = 0
  for (const user of userList) {
    const mfa = await aws(["iam", "list-mfa-devices", "--user-name", user, "--query", "MFADevices"], profile, region, timeout)
    const devices = tryJson(mfa.stdout) || []
    if (devices.length === 0) {
      const loginProfile = await aws(["iam", "get-login-profile", "--user-name", user], profile, region, timeout)
      if (loginProfile.exitCode === 0) {
        noMfa++
        output.push(`[!] ${user}: console access WITHOUT MFA`)
        findings.push({ checkId: "CIS-AWS-1.6", provider: "aws-cis", severity: "high", status: "FAIL", resource: `iam://user/${user}`, title: `IAM user ${user} has console access without MFA`, details: "Console login enabled but no MFA device registered", remediation: `Enable MFA for user ${user}` })
      }
    }
  }

  output.push(`\n[*] Summary: ${noMfa} console users without MFA, ${findings.length} total issues`)
  return { output: output.join("\n"), findings }
}

export async function s3PublicAccessAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing S3 public access settings (CIS 2.1.5)...\n"]

  const accountBlock = await aws(["s3control", "get-public-access-block", "--account-id", "$(aws sts get-caller-identity --query Account --output text)"], profile, region, timeout)
  if (accountBlock.exitCode !== 0) {
    findings.push({ checkId: "CIS-AWS-2.1.5", provider: "aws-cis", severity: "high", status: "FAIL", resource: "s3://account-level", title: "S3 account-level public access block not configured", details: "No account-level block — individual buckets may be public", remediation: "aws s3control put-public-access-block --account-id <id> --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" })
    output.push("[-] Account-level S3 public access block: NOT SET")
  } else {
    const block = tryJson(accountBlock.stdout)?.PublicAccessBlockConfiguration || {}
    output.push(`[+] Account S3 Block: BlockAcls=${block.BlockPublicAcls}, IgnoreAcls=${block.IgnorePublicAcls}, BlockPolicy=${block.BlockPublicPolicy}, Restrict=${block.RestrictPublicBuckets}`)
    if (!block.BlockPublicAcls || !block.IgnorePublicAcls || !block.BlockPublicPolicy || !block.RestrictPublicBuckets) {
      findings.push({ checkId: "CIS-AWS-2.1.5", provider: "aws-cis", severity: "high", status: "FAIL", resource: "s3://account-level", title: "S3 account-level public access block incomplete", details: `BlockAcls=${block.BlockPublicAcls}, IgnoreAcls=${block.IgnorePublicAcls}, BlockPolicy=${block.BlockPublicPolicy}, Restrict=${block.RestrictPublicBuckets}`, remediation: "Enable all four settings at account level" })
    }
  }

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  output.push(`\n[+] Total buckets: ${bucketList.length}`)

  let publicCount = 0
  for (const bucket of bucketList.slice(0, 50)) {
    const block = await aws(["s3api", "get-public-access-block", "--bucket", bucket], profile, region, timeout)
    if (block.exitCode !== 0) {
      publicCount++
      output.push(`[!] ${bucket}: no public access block`)
      findings.push({ checkId: "CIS-AWS-2.1.5", provider: "aws-cis", severity: "high", status: "FAIL", resource: `s3://${bucket}`, title: `S3 bucket ${bucket} has no public access block`, details: "No bucket-level block and may inherit permissive settings", remediation: `aws s3api put-public-access-block --bucket ${bucket} --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true` })
    }
  }

  output.push(`\n[*] Summary: ${publicCount} buckets without public access block, ${findings.length} total issues`)
  return { output: output.join("\n"), findings }
}

export async function encryptionAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing encryption at rest (CIS 2.x)...\n"]

  const ebs = await aws(["ec2", "get-ebs-encryption-by-default"], profile, region, timeout)
  const ebsEnc = tryJson(ebs.stdout)?.EbsEncryptionByDefault
  output.push(`[+] EBS default encryption: ${ebsEnc ? "enabled" : "DISABLED"}`)
  if (!ebsEnc) {
    findings.push({ checkId: "CIS-AWS-2.2.1", provider: "aws-cis", severity: "medium", status: "FAIL", resource: "ebs://default", title: "EBS default encryption not enabled", details: "New EBS volumes will not be encrypted unless explicitly specified", remediation: "aws ec2 enable-ebs-encryption-by-default" })
  }

  const rds = await aws(["rds", "describe-db-instances", "--query", "DBInstances[?StorageEncrypted==`false`].[DBInstanceIdentifier,Engine]"], profile, region, timeout)
  const unencRds = tryJson(rds.stdout) || []
  output.push(`[+] Unencrypted RDS instances: ${unencRds.length}`)
  for (const r of unencRds) {
    findings.push({ checkId: "CIS-AWS-2.3.1", provider: "aws-cis", severity: "high", status: "FAIL", resource: `rds://${r[0]}`, title: `RDS instance ${r[0]} not encrypted`, details: `Engine: ${r[1]}`, remediation: "Create encrypted snapshot, restore from it, swap endpoints" })
  }

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  let noEnc = 0
  for (const bucket of bucketList.slice(0, 30)) {
    const enc = await aws(["s3api", "get-bucket-encryption", "--bucket", bucket], profile, region, timeout)
    if (enc.exitCode !== 0) {
      noEnc++
      findings.push({ checkId: "CIS-AWS-2.1.1", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `s3://${bucket}`, title: `S3 bucket ${bucket} default encryption not configured`, details: "Objects may be stored unencrypted", remediation: `aws s3api put-bucket-encryption --bucket ${bucket} --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"},"BucketKeyEnabled":true}]}'` })
    }
  }
  output.push(`[+] S3 buckets without default encryption: ${noEnc}/${bucketList.length}`)

  output.push(`\n[*] Summary: ${findings.length} encryption issues found`)
  return { output: output.join("\n"), findings }
}

export async function loggingAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing logging configuration...\n"]

  const vpcFlows = await aws(["ec2", "describe-vpcs", "--query", "Vpcs[].VpcId"], profile, region, timeout)
  const vpcs = tryJson(vpcFlows.stdout) || []
  for (const vpcId of vpcs) {
    const flows = await aws(["ec2", "describe-flow-logs", "--filter", `Name=resource-id,Values=${vpcId}`, "--query", "FlowLogs[].FlowLogId"], profile, region, timeout)
    const flowList = tryJson(flows.stdout) || []
    if (flowList.length === 0) {
      findings.push({ checkId: "CIS-AWS-3.9", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `vpc://${vpcId}`, title: `VPC ${vpcId} has no flow logs`, details: "Network traffic not being captured for analysis", remediation: `aws ec2 create-flow-logs --resource-type VPC --resource-ids ${vpcId} --traffic-type ALL --log-destination-type cloud-watch-logs --log-group-name vpc-flow-logs` })
      output.push(`[-] ${vpcId}: no flow logs`)
    } else {
      output.push(`[+] ${vpcId}: ${flowList.length} flow log(s)`)
    }
  }

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const bucketList = tryJson(buckets.stdout) || []
  let noLogging = 0
  for (const bucket of bucketList.slice(0, 30)) {
    const logging = await aws(["s3api", "get-bucket-logging", "--bucket", bucket, "--query", "LoggingEnabled"], profile, region, timeout)
    const cfg = tryJson(logging.stdout)
    if (!cfg) {
      noLogging++
    }
  }
  output.push(`\n[+] S3 buckets without access logging: ${noLogging}/${Math.min(bucketList.length, 30)}`)
  if (noLogging > 0) {
    findings.push({ checkId: "AWS-LOG-001", provider: "aws", severity: "low", status: "FAIL", resource: "s3://access-logging", title: `${noLogging} S3 buckets without access logging`, details: "Access logs help detect unauthorized access patterns", remediation: "Enable server access logging on sensitive buckets" })
  }

  output.push(`\n[*] Summary: ${findings.length} logging issues found`)
  return { output: output.join("\n"), findings }
}

export async function networkAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing network security (CIS 5.x)...\n"]

  const sgs = await aws(["ec2", "describe-security-groups", "--query", "SecurityGroups[?length(IpPermissions[?contains(IpRanges[].CidrIp, '0.0.0.0/0')]) > `0`].[GroupId,GroupName,Description]"], profile, region, timeout)
  const openSgs = tryJson(sgs.stdout) || []
  output.push(`[+] Security groups with 0.0.0.0/0 inbound: ${openSgs.length}`)

  for (const sg of openSgs) {
    const detail = await aws(["ec2", "describe-security-groups", "--group-ids", sg[0], "--query", "SecurityGroups[0].IpPermissions[?contains(IpRanges[].CidrIp, '0.0.0.0/0')]"], profile, region, timeout)
    const rules = tryJson(detail.stdout) || []
    for (const rule of rules) {
      const port = rule.FromPort === rule.ToPort ? `${rule.FromPort}` : `${rule.FromPort}-${rule.ToPort}`
      const proto = rule.IpProtocol === "-1" ? "ALL" : rule.IpProtocol

      if (rule.FromPort === 22 || (rule.FromPort <= 22 && rule.ToPort >= 22)) {
        findings.push({ checkId: "CIS-AWS-5.2", provider: "aws-cis", severity: "high", status: "FAIL", resource: `sg://${sg[0]}`, title: `SSH (22) open to 0.0.0.0/0 on ${sg[1]}`, details: `SG: ${sg[0]} (${sg[1]})`, remediation: "Restrict SSH to known IP ranges" })
      }
      if (rule.FromPort === 3389 || (rule.FromPort <= 3389 && rule.ToPort >= 3389)) {
        findings.push({ checkId: "CIS-AWS-5.3", provider: "aws-cis", severity: "high", status: "FAIL", resource: `sg://${sg[0]}`, title: `RDP (3389) open to 0.0.0.0/0 on ${sg[1]}`, details: `SG: ${sg[0]} (${sg[1]})`, remediation: "Restrict RDP to known IP ranges or use SSM Session Manager" })
      }
      if (rule.IpProtocol === "-1") {
        findings.push({ checkId: "CIS-AWS-5.4", provider: "aws-cis", severity: "critical", status: "FAIL", resource: `sg://${sg[0]}`, title: `All traffic open to 0.0.0.0/0 on ${sg[1]}`, details: `SG: ${sg[0]} allows all ports/protocols from internet`, remediation: "Remove the 0.0.0.0/0 rule or restrict to specific ports" })
      }

      output.push(`  [!] ${sg[0]} (${sg[1]}): ${proto}/${port} open to 0.0.0.0/0`)
    }
  }

  const nacls = await aws(["ec2", "describe-network-acls", "--query", "NetworkAcls[].{Id:NetworkAclId,Entries:Entries[?RuleAction=='allow' && CidrBlock=='0.0.0.0/0' && !Egress]}"], profile, region, timeout)
  const naclList = tryJson(nacls.stdout) || []
  for (const nacl of naclList) {
    const open = (nacl.Entries || []).filter((e: Record<string, unknown>) => e.Protocol === "-1")
    if (open.length > 0) {
      output.push(`[!] NACL ${nacl.Id}: allows all inbound from 0.0.0.0/0`)
      findings.push({ checkId: "AWS-NET-001", provider: "aws", severity: "high", status: "FAIL", resource: `nacl://${nacl.Id}`, title: `NACL ${nacl.Id} allows all inbound traffic from internet`, details: "All protocols and ports allowed", remediation: "Restrict NACL inbound rules to necessary traffic" })
    }
  }

  const defaultSg = await aws(["ec2", "describe-security-groups", "--filters", "Name=group-name,Values=default", "--query", "SecurityGroups[?length(IpPermissions) > `0`].[GroupId,VpcId]"], profile, region, timeout)
  const defaultOpen = tryJson(defaultSg.stdout) || []
  if (defaultOpen.length > 0) {
    output.push(`\n[!] Default security groups with inbound rules: ${defaultOpen.length}`)
    for (const sg of defaultOpen) {
      findings.push({ checkId: "CIS-AWS-5.4", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `sg://${sg[0]}`, title: `Default SG in ${sg[1]} has inbound rules`, details: "Default SGs should restrict all traffic — CIS 5.4", remediation: `Remove all inbound/outbound rules from default SG ${sg[0]}` })
    }
  }

  output.push(`\n[*] Summary: ${findings.length} network security issues found`)
  return { output: output.join("\n"), findings }
}

export async function accessAnalyzerAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing IAM Access Analyzer (CIS 1.20)...\n"]

  const analyzers = await aws(["accessanalyzer", "list-analyzers"], profile, region, timeout)
  if (analyzers.exitCode !== 0) return { output: `[-] Failed to list analyzers: ${analyzers.stderr.trim()}`, findings }
  const list = tryJson(analyzers.stdout)?.analyzers || []

  if (list.length === 0) {
    findings.push({ checkId: "CIS-AWS-1.20", provider: "aws-cis", severity: "medium", status: "FAIL", resource: "accessanalyzer://none", title: "No IAM Access Analyzer enabled", details: "External access to resources not being monitored", remediation: "aws accessanalyzer create-analyzer --analyzer-name default --type ACCOUNT" })
    return { output: output.join("\n"), findings }
  }

  for (const a of list) {
    output.push(`[+] Analyzer: ${a.name} (${a.type}) — ${a.status}`)
    if (a.status !== "ACTIVE") {
      findings.push({ checkId: "CIS-AWS-1.20", provider: "aws-cis", severity: "medium", status: "FAIL", resource: `accessanalyzer://${a.name}`, title: `Access Analyzer ${a.name} is not active`, details: `Status: ${a.status}`, remediation: "Investigate and resolve analyzer issues" })
    }

    const af = await aws(["accessanalyzer", "list-findings", "--analyzer-arn", a.arn, "--filter", '{"status":{"eq":["ACTIVE"]}}', "--max-results", "20"], profile, region, timeout)
    const activeFindings = tryJson(af.stdout)?.findings || []
    output.push(`    Active findings: ${activeFindings.length}`)
    for (const f of activeFindings.slice(0, 10)) {
      output.push(`      [!] ${f.resourceType}: ${f.resource} — ${f.condition?.["aws:PrincipalOrgID"] ? "org access" : "external access"}`)
      findings.push({ checkId: "AWS-AA-001", provider: "aws", severity: "high", status: "FAIL", resource: f.resource || "unknown", title: `External access: ${f.resourceType} ${f.resource?.split("/").pop() || ""}`, details: `Principal: ${JSON.stringify(f.principal)}, Action: ${f.action?.join(", ") || "N/A"}`, remediation: "Review and restrict external access" })
    }
  }

  output.push(`\n[*] Summary: ${findings.length} issues found`)
  return { output: output.join("\n"), findings }
}

export async function inspectorAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing Amazon Inspector...\n"]

  const status = await aws(["inspector2", "batch-get-account-status"], profile, region, timeout)
  if (status.exitCode !== 0) {
    findings.push({ checkId: "AWS-INSP-001", provider: "aws", severity: "medium", status: "FAIL", resource: "inspector://none", title: "Amazon Inspector not enabled or not accessible", details: `Error: ${status.stderr.trim()}`, remediation: "aws inspector2 enable --resource-types EC2 ECR LAMBDA" })
    output.push("[-] Inspector not enabled or not accessible")
    return { output: output.join("\n"), findings }
  }

  const accts = tryJson(status.stdout)?.accounts || []
  for (const a of accts) {
    output.push(`[+] Account: ${a.accountId}`)
    output.push(`    EC2: ${a.resourceState?.ec2?.status || "?"}, ECR: ${a.resourceState?.ecr?.status || "?"}, Lambda: ${a.resourceState?.lambda?.status || "?"}`)

    if (a.resourceState?.ec2?.status !== "ENABLED") {
      findings.push({ checkId: "AWS-INSP-002", provider: "aws", severity: "medium", status: "FAIL", resource: `inspector://${a.accountId}/ec2`, title: "Inspector EC2 scanning not enabled", details: "EC2 instances not being scanned for vulnerabilities", remediation: "aws inspector2 enable --resource-types EC2" })
    }
    if (a.resourceState?.ecr?.status !== "ENABLED") {
      findings.push({ checkId: "AWS-INSP-003", provider: "aws", severity: "medium", status: "FAIL", resource: `inspector://${a.accountId}/ecr`, title: "Inspector ECR scanning not enabled", details: "Container images not being scanned", remediation: "aws inspector2 enable --resource-types ECR" })
    }
  }

  const coverage = await aws(["inspector2", "list-coverage-statistics", "--filter-criteria", "{}"], profile, region, timeout)
  const cov = tryJson(coverage.stdout)?.totalCounts || {}
  output.push(`\n[+] Coverage: ${JSON.stringify(cov)}`)

  output.push(`\n[*] Summary: ${findings.length} issues found`)
  return { output: output.join("\n"), findings }
}

export async function resourceTagAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing resource tagging compliance...\n"]

  const required = argVal(args, "--required-tags")?.split(",") || ["Environment", "Owner", "Project"]
  output.push(`[+] Required tags: ${required.join(", ")}`)

  const ec2 = await aws(["ec2", "describe-instances", "--query", "Reservations[].Instances[].[InstanceId,Tags]"], profile, region, timeout)
  const instances = tryJson(ec2.stdout) || []
  let untagged = 0
  for (const inst of instances) {
    const tags = (inst[1] || []).map((t: Record<string, string>) => t.Key)
    const missing = required.filter((r) => !tags.includes(r))
    if (missing.length > 0) {
      untagged++
      if (untagged <= 10) output.push(`[!] EC2 ${inst[0]}: missing tags ${missing.join(", ")}`)
    }
  }
  output.push(`[+] EC2 instances missing required tags: ${untagged}/${instances.length}`)

  const rds = await aws(["rds", "describe-db-instances", "--query", "DBInstances[].[DBInstanceIdentifier,TagList]"], profile, region, timeout)
  const dbs = tryJson(rds.stdout) || []
  let untaggedRds = 0
  for (const db of dbs) {
    const tags = (db[1] || []).map((t: Record<string, string>) => t.Key)
    const missing = required.filter((r) => !tags.includes(r))
    if (missing.length > 0) untaggedRds++
  }
  output.push(`[+] RDS instances missing required tags: ${untaggedRds}/${dbs.length}`)

  if (untagged > 0 || untaggedRds > 0) {
    findings.push({ checkId: "AWS-TAG-001", provider: "aws", severity: "low", status: "FAIL", resource: "tags://compliance", title: `${untagged + untaggedRds} resources missing required tags`, details: `EC2: ${untagged}, RDS: ${untaggedRds}. Required: ${required.join(", ")}`, remediation: "Apply required tags to all resources for cost allocation and ownership tracking" })
  }

  output.push(`\n[*] Summary: ${findings.length} tagging issues found`)
  return { output: output.join("\n"), findings }
}

export async function rootAccountAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing root account security (CIS 1.x)...\n"]

  const summary = await aws(["iam", "get-account-summary"], profile, region, timeout)
  const sum = tryJson(summary.stdout)?.SummaryMap || {}

  output.push(`[+] Root MFA: ${sum.AccountMFAEnabled === 1 ? "enabled" : "DISABLED"}`)
  if (sum.AccountMFAEnabled !== 1) {
    findings.push({ checkId: "CIS-AWS-1.5", provider: "aws-cis", severity: "critical", status: "FAIL", resource: "iam://root", title: "Root account MFA not enabled", details: "Root has unrestricted access", remediation: "Enable hardware MFA for root" })
  }

  const keys = await aws(["iam", "list-access-keys", "--user-name", "root"], profile, region, timeout)
  if (keys.exitCode === 0) {
    const rootKeys = tryJson(keys.stdout)?.AccessKeyMetadata || []
    const active = rootKeys.filter((k: Record<string, string>) => k.Status === "Active")
    output.push(`[+] Root access keys: ${rootKeys.length} (${active.length} active)`)
    if (active.length > 0) {
      findings.push({ checkId: "CIS-AWS-1.4", provider: "aws-cis", severity: "critical", status: "FAIL", resource: "iam://root/access-key", title: `Root account has ${active.length} active access key(s)`, details: "Root access keys should not exist — use IAM users/roles instead", remediation: "Delete root access keys: aws iam delete-access-key --user-name root --access-key-id <key>" })
    }
  } else {
    output.push("[+] Root access key check: cannot enumerate (likely non-root caller — good)")
  }

  const alias = await aws(["iam", "list-account-aliases"], profile, region, timeout)
  const aliases = tryJson(alias.stdout)?.AccountAliases || []
  output.push(`[+] Account aliases: ${aliases.length > 0 ? aliases.join(", ") : "none (using account ID for console login)"}`)

  output.push(`\n[*] Summary: ${findings.length} root account issues found`)
  return { output: output.join("\n"), findings }
}

export async function vpcEndpointAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing VPC endpoint configuration...\n"]

  const endpoints = await aws(["ec2", "describe-vpc-endpoints", "--query", "VpcEndpoints[].{Id:VpcEndpointId,Service:ServiceName,Type:VpcEndpointType,State:State,PolicyDocument:PolicyDocument}"], profile, region, timeout)
  const list = tryJson(endpoints.stdout) || []
  output.push(`[+] VPC Endpoints: ${list.length}`)

  const criticalServices = ["s3", "dynamodb", "kms", "secretsmanager", "sts", "ec2", "ecr.api", "ecr.dkr", "logs", "monitoring"]

  for (const ep of list) {
    const svc = ep.Service?.split(".").pop() || ""
    output.push(`  ${ep.Id}: ${svc} (${ep.Type}) — ${ep.State}`)

    if (ep.PolicyDocument) {
      const policy = typeof ep.PolicyDocument === "string" ? tryJson(ep.PolicyDocument) : ep.PolicyDocument
      const statements = policy?.Statement || []
      for (const stmt of statements) {
        if (stmt.Principal === "*" && stmt.Effect === "Allow" && (!stmt.Condition || Object.keys(stmt.Condition).length === 0)) {
          findings.push({ checkId: "AWS-VPC-EP-001", provider: "aws", severity: "medium", status: "FAIL", resource: `vpc-endpoint://${ep.Id}`, title: `VPC endpoint ${ep.Id} (${svc}) has overly permissive policy`, details: "Principal: * with no conditions — any VPC resource can use this endpoint", remediation: "Restrict endpoint policy to specific IAM principals or VPC" })
        }
      }
    }
  }

  const vpcs = await aws(["ec2", "describe-vpcs", "--query", "Vpcs[].VpcId"], profile, region, timeout)
  const vpcList = tryJson(vpcs.stdout) || []
  const coveredServices = list.map((e: Record<string, string>) => e.Service?.split(".").pop())
  const missing = criticalServices.filter((s) => !coveredServices.includes(s))
  if (missing.length > 0) {
    output.push(`\n[!] Recommended VPC endpoints not found: ${missing.join(", ")}`)
    findings.push({ checkId: "AWS-VPC-EP-002", provider: "aws", severity: "low", status: "FAIL", resource: "vpc-endpoint://missing", title: `Missing VPC endpoints for critical services: ${missing.join(", ")}`, details: "Traffic to these services traverses the internet instead of staying within AWS network", remediation: `Create VPC endpoints for: ${missing.join(", ")}` })
  }

  output.push(`\n[*] Summary: ${findings.length} issues found`)
  return { output: output.join("\n"), findings }
}

export async function backupAudit(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Auditing AWS Backup configuration...\n"]

  const vaults = await aws(["backup", "list-backup-vaults"], profile, region, timeout)
  if (vaults.exitCode !== 0) return { output: `[-] Failed to list backup vaults: ${vaults.stderr.trim()}`, findings }
  const vaultList = tryJson(vaults.stdout)?.BackupVaultList || []
  output.push(`[+] Backup vaults: ${vaultList.length}`)

  if (vaultList.length === 0) {
    findings.push({ checkId: "AWS-BKP-001", provider: "aws", severity: "medium", status: "FAIL", resource: "backup://none", title: "No AWS Backup vaults configured", details: "No centralized backup strategy — data loss risk", remediation: "Create a backup vault and plan covering critical resources" })
    return { output: output.join("\n"), findings }
  }

  for (const v of vaultList) {
    output.push(`  ${v.BackupVaultName}: ${v.NumberOfRecoveryPoints} recovery points, encrypted=${!!v.EncryptionKeyArn}`)
    if (!v.EncryptionKeyArn) {
      findings.push({ checkId: "AWS-BKP-002", provider: "aws", severity: "medium", status: "FAIL", resource: `backup://${v.BackupVaultName}`, title: `Backup vault ${v.BackupVaultName} not encrypted with CMK`, details: "Using default encryption", remediation: "Create vault with customer-managed KMS key" })
    }
  }

  const plans = await aws(["backup", "list-backup-plans"], profile, region, timeout)
  const planList = tryJson(plans.stdout)?.BackupPlansList || []
  output.push(`\n[+] Backup plans: ${planList.length}`)
  for (const p of planList) {
    output.push(`  ${p.BackupPlanName} (${p.BackupPlanId})`)
  }

  const protected_ = await aws(["backup", "list-protected-resources", "--max-results", "100"], profile, region, timeout)
  const protectedList = tryJson(protected_.stdout)?.Results || []
  output.push(`[+] Protected resources: ${protectedList.length}`)

  output.push(`\n[*] Summary: ${findings.length} issues found`)
  return { output: output.join("\n"), findings }
}
