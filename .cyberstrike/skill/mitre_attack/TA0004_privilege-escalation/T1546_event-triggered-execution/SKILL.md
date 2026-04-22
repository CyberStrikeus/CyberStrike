---
name: "T1546_event-triggered-execution"
description: "Adversaries may establish persistence and/or elevate privileges using system mechanisms that trigger execution based on specific events."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546
  - privilege-escalation
  - persistence
  - linux
  - macos
  - windows
  - saas
  - iaas
  - office-suite
technique_id: "T1546"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - Linux
  - macOS
  - Windows
  - SaaS
  - IaaS
  - Office Suite
mitre_url: "https://attack.mitre.org/techniques/T1546"
tech_stack:
  - linux
  - macos
  - windows
  - saas
  - cloud
  - office
cwe_ids:
  - CWE-269
chains_with:
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.005
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  []
severity_boost:
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
  T1546.003: "Chain with T1546.003 for deeper attack path"
---

# T1546 Event Triggered Execution

## High-Level Description

Adversaries may establish persistence and/or elevate privileges using system mechanisms that trigger execution based on specific events. Various operating systems have means to monitor and subscribe to events such as logons or other user activity such as running specific applications/binaries. Cloud environments may also support various functions and services that monitor and can be invoked in response to specific cloud events.

Adversaries may abuse these mechanisms as a means of maintaining persistent access to a victim via repeatedly executing malicious code. After gaining access to a victim system, adversaries may create/modify event triggers to point to malicious content that will be executed whenever the event trigger is invoked.

Since the execution can be proxied by an account with higher permissions, such as SYSTEM or service accounts, an adversary may be able to abuse these triggered execution mechanisms to escalate their privileges.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** Linux, macOS, Windows, SaaS, IaaS, Office Suite

## What to Check

- [ ] Identify if Event Triggered Execution technique is applicable to target environment
- [ ] Check Linux systems for indicators of Event Triggered Execution
- [ ] Check macOS systems for indicators of Event Triggered Execution
- [ ] Check Windows systems for indicators of Event Triggered Execution
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Persistence with Custom AutodialDLL

The DLL pointed to by the AutodialDLL registry key is loaded every time a process connects to the internet. Attackers can gain persistent code execution by setting this key to a DLL of their choice. 

The sample dll provided, AltWinSock2DLL, will launch the notepad process. Starting and stopping a web browser such as MS Edge or Chrome should result in the dll executing.
[Blog](https://www.mdsec.co.uk/2022/10/autodialdlling-your-way/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Set-ItemProperty HKLM:\SYSTEM\CurrentControlSet\Services\WinSock2\Parameters -Name AutodialDLL -Value PathToAtomicsFolder\T1546\bin\AltWinSock2DLL.dll
```

**Dependencies:**
- AltWinSock2DLL DLL must exist on disk at specified at PathToAtomicsFolder\T1546\bin\AltWinSock2DLL.dll

### Atomic Test 2: HKLM - Persistence using CommandProcessor AutoRun key (With Elevation)

An adversary may abuse the CommandProcessor AutoRun registry key to persist. Every time cmd.exe is executed, the command defined in the AutoRun key also gets executed.
[reference](https://devblogs.microsoft.com/oldnewthing/20071121-00/?p=24433)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
New-ItemProperty -Path "HKLM:\Software\Microsoft\Command Processor" -Name "AutoRun" -Value "#{command}" -PropertyType "String"
```

### Atomic Test 3: HKCU - Persistence using CommandProcessor AutoRun key (Without Elevation)

An adversary may abuse the CommandProcessor AutoRun registry key to persist. Every time cmd.exe is executed, the command defined in the AutoRun key also gets executed.
[reference](https://devblogs.microsoft.com/oldnewthing/20071121-00/?p=24433)

**Supported Platforms:** windows

```powershell
$path = "HKCU:\Software\Microsoft\Command Processor"
if (!(Test-Path -path $path)){
  New-Item -ItemType Key -Path $path
}
New-ItemProperty -Path $path -Name "AutoRun" -Value "#{command}" -PropertyType "String"
```

### Atomic Test 4: WMI Invoke-CimMethod Start Process

The following Atomic will create a New-CimSession on a remote endpoint and start a process usnig Invoke-CimMethod.
This is a novel way to perform lateral movement or to start a remote process.
This does require WinRM to be enabled. The account performing the run will also need to be elevated.
A successful execution will stdout that the process started. On the remote endpoint, wmiprvse.exe will spawn the given process.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
# Set the remote computer name and credentials
 $RemoteComputer = "#{dest}"
 $PWord = ConvertTo-SecureString -String "#{password}" -AsPlainText -Force
 $Credential = New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList "#{username}", $Pword

 # Create a CIM session
 $CimSession = New-CimSession -ComputerName $RemoteComputer -Credential $Credential

 # Define the process you want to start
 $ProcessToStart = "#{process}"

 # Invoke the Create method on the Win32_Process class to start the process
 $Result = Invoke-CimMethod -CimSession $CimSession -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine = $ProcessToStart}

 # Check the result
 if ($Result.ReturnValue -eq 0) {
     Write-Host "Process started successfully with Process ID: $($Result.ProcessId)"
 } else {
     Write-Host "Failed to start the process. Error code: $($Result.ReturnValue)"
 }

 # Clean up the CIM session
 Remove-CimSession -CimSession $CimSession
```

### Atomic Test 5: Adding custom debugger for Windows Error Reporting

When applications hang, the Windows Error Reporting framework allows us to attach a debugger, if it is set up in the Registry.
Adding executable of choice will let the executable to auto-execute when during any application crash due to functioning of WER framework

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
reg add "HKLM\Software\Microsoft\Windows\Windows Error Reporting\Hangs" /v Debugger /t REG_SZ /d "C:\Windows\System32\notepad.exe" /f
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Event Triggered Execution by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1546 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management
Manage the creation, modification, use, and permissions associated to privileged accounts, including SYSTEM and root.

### M1051 Update Software
Perform regular software updates to mitigate exploitation risk.


## Detection

### Behavioral Detection of Event Triggered Execution Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Event Triggered Execution technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [FireEye WMI 2015](https://www.fireeye.com/content/dam/fireeye-www/global/en/current-threats/pdfs/wp-windows-management-instrumentation.pdf)
- [Microsoft DART Case Report 001](https://www.microsoft.com/security/blog/2020/03/09/real-life-cybercrime-stories-dart-microsoft-detection-and-response-team)
- [amnesia malware](https://researchcenter.paloaltonetworks.com/2017/04/unit42-new-iotlinux-malware-targets-dvrs-forms-botnet/)
- [Backdooring an AWS account](https://medium.com/daniel-grzelak/backdooring-an-aws-account-da007d36f8f9)
- [Varonis Power Automate Data Exfiltration](https://www.varonis.com/blog/power-automate-data-exfiltration)
- [Malware Persistence on OS X](https://www.virusbulletin.com/uploads/pdf/conference/vb2014/VB2014-Wardle.pdf)
- [Atomic Red Team - T1546](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546)
- [MITRE ATT&CK - T1546](https://attack.mitre.org/techniques/T1546)
