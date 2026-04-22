---
name: "T1202_indirect-command-execution"
description: "Adversaries may abuse utilities that allow for command execution to bypass security restrictions that limit the use of command-line interpreters."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1202
  - defense-evasion
  - windows
technique_id: "T1202"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1202"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1202 Indirect Command Execution

## High-Level Description

Adversaries may abuse utilities that allow for command execution to bypass security restrictions that limit the use of command-line interpreters. Various Windows utilities may be used to execute commands, possibly without invoking cmd. For example, Forfiles, the Program Compatibility Assistant (`pcalua.exe`), components of the Windows Subsystem for Linux (WSL), `Scriptrunner.exe`, as well as other utilities may invoke the execution of programs and commands from a Command and Scripting Interpreter, Run window, or via scripts. Adversaries may also abuse the `ssh.exe` binary to execute malicious commands via the `ProxyCommand` and `LocalCommand` options, which can be invoked via the `-o` flag or by modifying the SSH config file.

Adversaries may abuse these features for Defense Evasion, specifically to perform arbitrary execution while subverting detections and/or mitigation controls (such as Group Policy) that limit/prevent the usage of cmd or file extensions more commonly associated with malicious payloads.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Indirect Command Execution technique is applicable to target environment
- [ ] Check Windows systems for indicators of Indirect Command Execution
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Indirect Command Execution - pcalua.exe

The Program Compatibility Assistant (pcalua.exe) may invoke the execution of programs and commands from a Command-Line Interface.
[Reference](https://twitter.com/KyleHanslovan/status/912659279806640128)
Upon execution, calc.exe should open

**Supported Platforms:** windows

```cmd
pcalua.exe -a #{process}
pcalua.exe -a #{payload_path}
```

### Atomic Test 2: Indirect Command Execution - forfiles.exe

forfiles.exe may invoke the execution of programs and commands from a Command-Line Interface.
[Reference](https://github.com/LOLBAS-Project/LOLBAS/blob/master/yml/OSBinaries/Forfiles.yml)
"This is basically saying for each occurrence of notepad.exe in c:\windows\system32 run calc.exe"
Upon execution calc.exe will be opened.

**Supported Platforms:** windows

```cmd
forfiles /p c:\windows\system32 /m notepad.exe /c #{process}
```

### Atomic Test 3: Indirect Command Execution - conhost.exe

conhost.exe refers to a host process for the console window. It provide an interface between command prompt and Windows explorer.
Executing it through command line can create process ancestry anomalies
[Reference] (http://www.hexacorn.com/blog/2020/05/25/how-to-con-your-host/)

**Supported Platforms:** windows

```cmd
conhost.exe "#{process}"
```

### Atomic Test 4: Indirect Command Execution - Scriptrunner.exe

The "ScriptRunner.exe" binary can be abused to proxy execution through it and bypass possible whitelisting. Upon test execution, calc.exe should open
Reference: https://x.com/NickTyrer/status/914234924655312896

**Supported Platforms:** windows

```powershell
Scriptrunner.exe -appvscript "#{payload_path}"
```

### Atomic Test 5: Indirect Command Execution - RunMRU Dialog

Simulates execution of commands via the Windows Run dialog (Win+R) by programmatically opening the Run dialog,
copying a command to clipboard, and automating the paste and execution. This generates artifacts in the RunMRU registry key,
which is commonly abused by threat actors to execute malicious commands disguised as CAPTCHA verification steps.
Upon execution, a test PowerShell command will be executed through the Run dialog.

**Supported Platforms:** windows

```powershell
# Copy command to clipboard
Set-Clipboard -Value '#{command}'

# Open Run dialog
Start-Process -FilePath "powershell" -ArgumentList "-c (New-Object -ComObject 'Shell.Application').FileRun()" -WindowStyle Hidden

# Wait for Run dialog to open
Start-Sleep -Seconds 1

# Paste command and execute
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Indirect Command Execution by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1202 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Indirect Command Execution – Windows utility abuse behavior chain

## Risk Assessment

| Finding                                         | Severity | Impact          |
| ----------------------------------------------- | -------- | --------------- |
| Indirect Command Execution technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Bleeping Computer - Scriptrunner.exe](https://www.bleepingcomputer.com/news/security/hackers-abuse-windows-error-reporting-tool-to-deploy-malware/)
- [Threat Actor Targets the Manufacturing industry with Lumma Stealer and Amadey Bot](https://cyble.com/blog/threat-actor-targets-manufacturing-industry-with-malware/)
- [Evi1cg Forfiles Nov 2017](https://x.com/Evi1cg/status/935027922397573120)
- [RSA Forfiles Aug 2017](https://community.rsa.com/community/products/netwitness/blog/2017/08/14/are-you-looking-out-for-forfilesexe-if-you-are-watching-for-cmdexe)
- [Secure Team - Scriptrunner.exe](https://secureteam.co.uk/2023/01/08/windows-error-reporting-tool-abused-to-load-malware/)
- [SS64](https://ss64.com/nt/scriptrunner.html)
- [VectorSec ForFiles Aug 2017](https://x.com/vector_sec/status/896049052642533376)
- [Atomic Red Team - T1202](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1202)
- [MITRE ATT&CK - T1202](https://attack.mitre.org/techniques/T1202)
