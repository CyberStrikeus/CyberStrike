---
name: "T1559.002_dynamic-data-exchange"
description: "Adversaries may use Windows Dynamic Data Exchange (DDE) to execute arbitrary commands."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1559.002
  - execution
  - windows
  - sub-technique
technique_id: "T1559.002"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1559/002"
tech_stack:
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1559
  - T1559.001
  - T1559.003
prerequisites:
  - T1559
severity_boost:
  T1559: "Chain with T1559 for deeper attack path"
  T1559.001: "Chain with T1559.001 for deeper attack path"
  T1559.003: "Chain with T1559.003 for deeper attack path"
---

# T1559.002 Dynamic Data Exchange

> **Sub-technique of:** T1559

## High-Level Description

Adversaries may use Windows Dynamic Data Exchange (DDE) to execute arbitrary commands. DDE is a client-server protocol for one-time and/or continuous inter-process communication (IPC) between applications. Once a link is established, applications can autonomously exchange transactions consisting of strings, warm data links (notifications when a data item changes), hot data links (duplications of changes to a data item), and requests for command execution.

Object Linking and Embedding (OLE), or the ability to link data between documents, was originally implemented through DDE. Despite being superseded by Component Object Model, DDE may be enabled in Windows 10 and most of Microsoft Office 2016 via Registry keys.

Microsoft Office documents can be poisoned with DDE commands, directly or through embedded files, and used to deliver execution via Phishing campaigns or hosted Web content, avoiding the use of Visual Basic for Applications (VBA) macros. Similarly, adversaries may infect payloads to execute applications and/or commands on a victim device by way of embedding DDE formulas within a CSV file intended to be opened through a Windows spreadsheet program.

DDE could also be leveraged by an adversary operating on a compromised machine who does not have direct access to a Command and Scripting Interpreter. DDE execution can be invoked remotely via Remote Services such as Distributed Component Object Model (DCOM).

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Windows

## What to Check

- [ ] Identify if Dynamic Data Exchange technique is applicable to target environment
- [ ] Check Windows systems for indicators of Dynamic Data Exchange
- [ ] Verify mitigations are bypassed or absent (4 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Execute Commands

Executes commands via DDE using Microsfot Word

**Supported Platforms:** windows

### Atomic Test 2: Execute PowerShell script via Word DDE

When the word document opens it will prompt the user to click ok on a dialogue box, then attempt to run PowerShell with DDEAUTO to download and execute a powershell script

**Supported Platforms:** windows

```cmd
start "$PathToAtomicsFolder\T1559.002\bin\DDE_Document.docx"
```

### Atomic Test 3: DDEAUTO

TrustedSec - Unicorn - https://github.com/trustedsec/unicorn

SensePost DDEAUTO - https://sensepost.com/blog/2017/macro-less-code-exec-in-msword/

Word VBA Macro

[Dragon's Tail](https://github.com/redcanaryco/atomic-red-team/tree/master/ARTifacts/Adversary/Dragons_Tail)

**Supported Platforms:** windows


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Dynamic Data Exchange by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1559.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint
On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent DDE attacks and spawning of child processes from Office programs.

### M1048 Application Isolation and Sandboxing
Ensure Protected View is enabled.

### M1054 Software Configuration
Consider disabling embedded files in Office programs, such as OneNote, that do not work with Protected View.

### M1042 Disable or Remove Feature or Program
Registry keys specific to Microsoft Office feature control security can be set to disable automatic DDE/OLE execution. Microsoft also created, and enabled by default, Registry keys to completely disable DDE execution in Word and Excel.


## Detection

### Detect Abuse of Dynamic Data Exchange (T1559.002)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Dynamic Data Exchange technique applicable | High | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)
- [CSV Excel Macro Injection ](https://blog.securelayer7.net/how-to-perform-csv-excel-macro-injection/)
- [BleepingComputer DDE Disabled in Word Dec 2017](https://www.bleepingcomputer.com/news/microsoft/microsoft-disables-dde-feature-in-word-to-prevent-further-malware-attacks/)
- [SensePost PS DDE May 2016](https://sensepost.com/blog/2016/powershell-c-sharp-and-dde-the-power-within/)
- [Fireeye Hunting COM June 2019](https://www.fireeye.com/blog/threat-research/2019/06/hunting-com-objects.html)
- [Kettle CSV DDE Aug 2014](https://www.contextis.com/blog/comma-separated-vulnerabilities)
- [Microsoft ADV170021 Dec 2017](https://portal.msrc.microsoft.com/security-guidance/advisory/ADV170021)
- [Microsoft DDE Advisory Nov 2017](https://technet.microsoft.com/library/security/4053440)
- [Enigma Reviving DDE Jan 2018](https://posts.specterops.io/reviving-dde-using-onenote-and-excel-for-code-execution-d7226864caee)
- [NVisio Labs DDE Detection Oct 2017](https://blog.nviso.be/2017/10/11/detecting-dde-in-ms-office-documents/)
- [SensePost MacroLess DDE Oct 2017](https://sensepost.com/blog/2017/macro-less-code-exec-in-msword/)
- [Atomic Red Team - T1559.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1559.002)
- [MITRE ATT&CK - T1559.002](https://attack.mitre.org/techniques/T1559/002)
