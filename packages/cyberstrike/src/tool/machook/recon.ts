import { run, argVal } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function systemInfo(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== macOS System Information ==="]

  const swVers = await run("sw_vers", [], timeout)
  output.push(swVers.stdout.trim())

  const uname = await run("uname", ["-a"], timeout)
  output.push(`\nKernel: ${uname.stdout.trim()}`)

  const hostname = await run("hostname", ["-f"], timeout)
  output.push(`Hostname: ${hostname.stdout.trim()}`)

  const model = await run("sysctl", ["-n", "hw.model"], timeout)
  output.push(`\n--- Hardware ---`)
  output.push(`Model: ${model.stdout.trim()}`)

  const memsize = await run("sysctl", ["-n", "hw.memsize"], timeout)
  const memGB = Math.round(parseInt(memsize.stdout.trim() || "0") / 1073741824)
  output.push(`Memory: ${memGB} GB`)

  const ncpu = await run("sysctl", ["-n", "hw.ncpu"], timeout)
  output.push(`CPUs: ${ncpu.stdout.trim()}`)

  const profiler = await run("system_profiler", ["SPHardwareDataType"], timeout)
  if (profiler.exitCode === 0) {
    const lines = profiler.stdout.split("\n").filter(Boolean).slice(0, 20)
    output.push(`\n--- Hardware Profile ---`)
    for (const l of lines) output.push(l)
  }

  const disk = await run("df", ["-h"], timeout)
  if (disk.exitCode === 0) {
    const lines = disk.stdout.split("\n").filter((l) => !l.includes("devfs") && !l.includes("map "))
    output.push(`\n--- Disk Usage ---`)
    for (const l of lines) output.push(l)
  }

  const uptime = await run("uptime", [], timeout)
  output.push(`\nUptime: ${uptime.stdout.trim()}`)

  findings.push({
    checkId: "MAC-SYSINFO-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://system",
    title: "macOS system information enumerated",
    details: `Host system enumerated — macOS version, hardware model, CPU, memory, disk, kernel collected`,
    remediation: "Restrict access to system profiling commands for non-privileged users where possible",
  })

  return { output: output.join("\n"), findings }
}

export async function processEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Process Enumeration ==="]

  const ps = await run("ps", ["auxww"], timeout)
  if (ps.exitCode === 0) {
    const lines = ps.stdout.split("\n").filter(Boolean)
    output.push(`[*] Total processes: ${lines.length - 1}`)
    output.push("")
    for (const l of lines.slice(0, 80)) output.push(l)
    if (lines.length > 80) output.push(`... (${lines.length - 80} more truncated)`)
  }

  const rootProcs = await run("ps", ["-eo", "pid,user,comm"], timeout)
  if (rootProcs.exitCode === 0) {
    const roots = rootProcs.stdout.split("\n").filter((l) => l.match(/^\s*\d+\s+root\s/))
    output.push(`\n--- Root Processes (${roots.length}) ---`)
    for (const r of roots.slice(0, 40)) output.push(`  ${r.trim()}`)
    findings.push({
      checkId: "MAC-PROCS-001",
      provider: "macos",
      severity: "info",
      status: "ENUMERATED",
      resource: "macos://processes",
      title: "Process tree enumerated",
      details: `${roots.length} root-context processes found — review for exploitable services`,
      remediation: "Minimize services running as root; use dedicated service accounts",
    })
  }

  const listeners = await run("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P"], timeout)
  if (listeners.exitCode === 0) {
    const lines = listeners.stdout.split("\n").filter(Boolean)
    output.push(`\n--- Listening Ports (${lines.length - 1}) ---`)
    for (const l of lines) output.push(`  ${l}`)
    findings.push({
      checkId: "MAC-PROCS-002",
      provider: "macos",
      severity: "low",
      status: "ENUMERATED",
      resource: "macos://network",
      title: "Listening services detected",
      details: `${lines.length - 1} listening port(s) found — potential attack surface`,
      remediation: "Disable unnecessary listening services and restrict bindings to localhost where possible",
    })
  }

  const established = await run("lsof", ["-iTCP", "-sTCP:ESTABLISHED", "-n", "-P"], timeout)
  if (established.exitCode === 0) {
    const lines = established.stdout.split("\n").filter(Boolean)
    output.push(`\n--- Established Connections (${Math.min(lines.length - 1, 30)}) ---`)
    for (const l of lines.slice(0, 31)) output.push(`  ${l}`)
  }

  return { output: output.join("\n"), findings }
}

export async function networkEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Network Enumeration ==="]

  const ifconfig = await run("ifconfig", [], timeout)
  if (ifconfig.exitCode === 0) {
    output.push("--- Interfaces ---")
    output.push(ifconfig.stdout.trim())
  }

  const routes = await run("netstat", ["-rn"], timeout)
  if (routes.exitCode === 0) {
    output.push("\n--- Routing Table ---")
    output.push(routes.stdout.trim())
  }

  const arp = await run("arp", ["-a"], timeout)
  if (arp.exitCode === 0) {
    output.push("\n--- ARP Table ---")
    output.push(arp.stdout.trim())
  }

  const resolv = await run("cat", ["/etc/resolv.conf"], timeout)
  if (resolv.exitCode === 0) {
    output.push("\n--- /etc/resolv.conf ---")
    output.push(resolv.stdout.trim())
  }

  const hosts = await run("cat", ["/etc/hosts"], timeout)
  if (hosts.exitCode === 0) {
    output.push("\n--- /etc/hosts ---")
    output.push(hosts.stdout.trim())
  }

  const dns = await run("scutil", ["--dns"], timeout)
  if (dns.exitCode === 0) {
    const lines = dns.stdout.split("\n").slice(0, 30)
    output.push("\n--- DNS Configuration ---")
    for (const l of lines) output.push(l)
  }

  const hwPorts = await run("networksetup", ["-listallhardwareports"], timeout)
  if (hwPorts.exitCode === 0) {
    output.push("\n--- Hardware Ports ---")
    output.push(hwPorts.stdout.trim())
  }

  const wifi = await run("networksetup", ["-getinfo", "Wi-Fi"], timeout)
  if (wifi.exitCode === 0) {
    output.push("\n--- Wi-Fi Info ---")
    output.push(wifi.stdout.trim())
  }

  const interfaces = (ifconfig.stdout.match(/inet /g) || []).length
  findings.push({
    checkId: "MAC-NETWORK-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://network",
    title: "Network configuration enumerated",
    details: `${interfaces} network interface(s) with IPv4 addresses detected — routing, ARP, DNS collected`,
    remediation: "Segment networks and apply host-based firewall rules",
  })

  return { output: output.join("\n"), findings }
}

export async function userEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== User Enumeration ==="]

  const users = await run("dscl", [".", "-list", "/Users"], timeout)
  if (users.exitCode === 0) {
    const userList = users.stdout.split("\n").filter((u) => u && !u.startsWith("_"))
    output.push(`--- Local Users (${userList.length}) ---`)
    for (const u of userList) output.push(`  ${u}`)
  }

  const whoami = await run("id", [], timeout)
  output.push(`\n--- Current Identity ---`)
  output.push(whoami.stdout.trim())

  const groups = await run("groups", [], timeout)
  output.push(`Groups: ${groups.stdout.trim()}`)

  const adminGroup = await run("dscl", [".", "-read", "/Groups/admin", "GroupMembership"], timeout)
  if (adminGroup.exitCode === 0) {
    output.push(`\n--- Admin Group Members ---`)
    output.push(adminGroup.stdout.trim())
  }

  const last = await run("last", ["-20"], timeout)
  if (last.exitCode === 0) {
    output.push(`\n--- Recent Logins ---`)
    output.push(last.stdout.trim())
  }

  const userCount = users.exitCode === 0 ? users.stdout.split("\n").filter((u) => u && !u.startsWith("_")).length : 0
  findings.push({
    checkId: "MAC-USERS-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://users",
    title: "User accounts enumerated",
    details: `${userCount} local user accounts found — admin group membership and login history collected`,
    remediation: "Remove unnecessary accounts; enforce strong authentication",
  })

  const sudo = await run("sudo", ["-l"], timeout)
  if (sudo.exitCode === 0) {
    const lines = sudo.stdout.split("\n").slice(0, 20)
    output.push(`\n--- sudo Privileges ---`)
    for (const l of lines) output.push(l)
    if (sudo.stdout.includes("NOPASSWD") || sudo.stdout.includes("(ALL)")) {
      findings.push({
        checkId: "MAC-USERS-002",
        provider: "macos",
        severity: "high",
        status: "VULNERABLE",
        resource: "macos://sudo",
        title: "Elevated sudo privileges available",
        details: `Current user has sudo access — ${sudo.stdout.includes("NOPASSWD") ? "NOPASSWD entries found" : "password-protected"}`,
        remediation: "Restrict sudo access; remove NOPASSWD entries where possible",
      })
    }
  }
  if (sudo.exitCode !== 0 && sudo.stderr) {
    output.push(`\n--- sudo ---`)
    output.push(`[*] ${sudo.stderr.trim().split("\n")[0]}`)
  }

  return { output: output.join("\n"), findings }
}

export async function installedApps(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Installed Applications ==="]

  const apps = await run("ls", ["/Applications"], timeout)
  if (apps.exitCode === 0) {
    const appList = apps.stdout.split("\n").filter((a) => a.endsWith(".app"))
    output.push(`--- /Applications (${appList.length}) ---`)
    for (const a of appList) output.push(`  ${a}`)
  }

  const profiler = await run("system_profiler", ["SPApplicationsDataType"], timeout)
  if (profiler.exitCode === 0) {
    const lines = profiler.stdout.split("\n").slice(0, 100)
    output.push(`\n--- Application Details ---`)
    for (const l of lines) output.push(l)
    if (profiler.stdout.split("\n").length > 100) output.push("... (truncated)")
  }

  const brew = await run("brew", ["list", "--versions"], timeout)
  if (brew.exitCode === 0 && brew.stdout.trim()) {
    const pkgs = brew.stdout.trim().split("\n")
    output.push(`\n--- Homebrew Packages (${pkgs.length}) ---`)
    for (const p of pkgs.slice(0, 50)) output.push(`  ${p}`)
    if (pkgs.length > 50) output.push(`... (${pkgs.length - 50} more)`)
  }

  const pip = await run("pip3", ["list", "--format=columns"], timeout)
  if (pip.exitCode === 0 && pip.stdout.trim()) {
    const lines = pip.stdout.trim().split("\n")
    output.push(`\n--- Python Packages (${lines.length - 2}) ---`)
    for (const l of lines.slice(0, 30)) output.push(`  ${l}`)
    if (lines.length > 30) output.push(`... (${lines.length - 30} more)`)
  }

  const npm = await run("npm", ["list", "-g", "--depth=0"], timeout)
  if (npm.exitCode === 0 && npm.stdout.trim()) {
    const lines = npm.stdout.trim().split("\n")
    output.push(`\n--- Global npm Packages ---`)
    for (const l of lines.slice(0, 20)) output.push(`  ${l}`)
  }

  const appCount = apps.exitCode === 0 ? apps.stdout.split("\n").filter((a) => a.endsWith(".app")).length : 0
  findings.push({
    checkId: "MAC-APPS-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://applications",
    title: "Installed applications and packages enumerated",
    details: `${appCount} applications found. Review application names and versions in the output — for any with a version, check CVE database via cve-mcp (cve search_by_product --product <name> --version <ver>). If cve-mcp is not enabled: cyberstrike mcp enable cve`,
    remediation: "Remove unnecessary applications. Keep all software updated.",
  })

  return { output: output.join("\n"), findings }
}

export async function securityFramework(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== macOS Security Framework ==="]

  const sip = await run("csrutil", ["status"], timeout)
  const sipEnabled = sip.stdout.includes("enabled")
  output.push(`SIP: ${sip.stdout.trim()}`)

  const gatekeeper = await run("spctl", ["--status"], timeout)
  output.push(`Gatekeeper: ${gatekeeper.stdout.trim() || gatekeeper.stderr.trim()}`)

  const filevault = await run("fdesetup", ["status"], timeout)
  output.push(`FileVault: ${filevault.stdout.trim()}`)

  const firewall = await run("defaults", ["read", "/Library/Preferences/com.apple.alf", "globalstate"], timeout)
  const fwState = firewall.stdout.trim()
  const fwLabel = fwState === "0" ? "OFF" : fwState === "1" ? "ON (specific services)" : fwState === "2" ? "ON (block all)" : fwState
  output.push(`Firewall: ${fwLabel}`)

  const xprotectYara = "/Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Resources/XProtect.yara"
  const xpExists = await Bun.file(xprotectYara).exists()
  output.push(`\nXProtect YARA: ${xpExists ? "present" : "not found"}`)
  if (xpExists) {
    const ruleCount = await run("grep", ["-c", "^rule ", xprotectYara], timeout)
    if (ruleCount.exitCode === 0) output.push(`  Rules: ${ruleCount.stdout.trim()}`)
  }

  const mrtPath = "/Library/Apple/System/Library/CoreServices/MRT.app"
  if (await Bun.file(`${mrtPath}/Contents/Info.plist`).exists()) {
    const mrtVer = await run("defaults", ["read", `${mrtPath}/Contents/Info`, "CFBundleShortVersionString"], timeout)
    output.push(`MRT version: ${mrtVer.stdout.trim()}`)
  }

  const extensions = await run("systemextensionsctl", ["list"], timeout)
  if (extensions.exitCode === 0 && extensions.stdout.trim()) {
    output.push(`\n--- Endpoint Security Extensions ---`)
    output.push(extensions.stdout.trim())
  }

  const mdm = await run("profiles", ["-C"], timeout)
  if (mdm.exitCode === 0 && mdm.stdout.trim()) {
    output.push(`\n--- MDM / Configuration Profiles ---`)
    output.push(mdm.stdout.trim())
  }

  findings.push({
    checkId: "MAC-SEC-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://security",
    title: "macOS security framework enumerated",
    details: `SIP: ${sipEnabled ? "enabled" : "DISABLED"}, Gatekeeper: ${gatekeeper.stdout.trim() || gatekeeper.stderr.trim()}, FileVault: ${filevault.stdout.trim()}, Firewall: ${fwLabel}`,
    remediation: "Enable all security frameworks — SIP, Gatekeeper, FileVault, Firewall",
  })

  if (!sipEnabled) {
    findings.push({
      checkId: "MAC-SEC-002",
      provider: "macos",
      severity: "medium",
      status: "VULNERABLE",
      resource: "macos://sip",
      title: "System Integrity Protection is DISABLED",
      details: "SIP disabled — kernel extensions, DTrace system-wide tracing, and NVRAM modifications are unrestricted",
      remediation: "Re-enable SIP: boot to Recovery Mode, run csrutil enable",
    })
  }

  if (fwState === "0") {
    findings.push({
      checkId: "MAC-SEC-003",
      provider: "macos",
      severity: "medium",
      status: "VULNERABLE",
      resource: "macos://firewall",
      title: "macOS Application Firewall is OFF",
      details: "No host-based firewall protection — all incoming connections are accepted",
      remediation: "Enable firewall: System Preferences → Security & Privacy → Firewall → Turn On",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function launchdEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== launchd Enumeration ==="]
  const home = process.env.HOME || "/Users"

  const launchctl = await run("launchctl", ["list"], timeout)
  if (launchctl.exitCode === 0) {
    const lines = launchctl.stdout.split("\n").filter(Boolean)
    output.push(`--- Loaded Services (${lines.length - 1}) ---`)
    for (const l of lines.slice(0, 60)) output.push(`  ${l}`)
    if (lines.length > 60) output.push(`... (${lines.length - 60} more)`)
  }

  const dirs = [
    { path: "/Library/LaunchAgents", desc: "System LaunchAgents" },
    { path: "/Library/LaunchDaemons", desc: "System LaunchDaemons" },
    { path: `${home}/Library/LaunchAgents`, desc: "User LaunchAgents" },
  ]

  const thirdParty: string[] = []
  for (const dir of dirs) {
    const ls = await run("ls", [dir.path], timeout)
    if (ls.exitCode !== 0) continue

    const plists = ls.stdout.split("\n").filter((f) => f.endsWith(".plist"))
    const nonApple = plists.filter((f) => !f.startsWith("com.apple."))
    output.push(`\n--- ${dir.desc} (${plists.length} total, ${nonApple.length} third-party) ---`)
    for (const p of plists) {
      const marker = p.startsWith("com.apple.") ? " " : "!"
      output.push(`  [${marker}] ${p}`)
    }

    for (const p of nonApple) {
      thirdParty.push(`${dir.path}/${p}`)
      const info = await run("defaults", ["read", `${dir.path}/${p.replace(".plist", "")}`, "ProgramArguments"], timeout)
      if (info.exitCode === 0) {
        output.push(`      ProgramArguments: ${info.stdout.trim().replace(/\n/g, " ").substring(0, 200)}`)
      }
    }
  }

  const totalLoaded = launchctl.exitCode === 0 ? launchctl.stdout.split("\n").filter(Boolean).length - 1 : 0
  findings.push({
    checkId: "MAC-LAUNCHD-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://launchd",
    title: "launchd services enumerated",
    details: `${totalLoaded} loaded services, ${thirdParty.length} third-party LaunchAgents/Daemons found`,
    remediation: "Review third-party LaunchAgents/Daemons for suspicious entries",
  })

  if (thirdParty.length > 0) {
    findings.push({
      checkId: "MAC-LAUNCHD-002",
      provider: "macos",
      severity: "medium",
      status: "IDENTIFIED",
      resource: "macos://launchd/thirdparty",
      title: "Third-party LaunchAgents/Daemons detected",
      details: `${thirdParty.length} non-Apple plist(s) found: ${thirdParty.map((p) => p.split("/").pop()).join(", ")}`,
      remediation: "Audit third-party plists for persistence mechanisms or unwanted software",
    })
  }

  return { output: output.join("\n"), findings }
}
