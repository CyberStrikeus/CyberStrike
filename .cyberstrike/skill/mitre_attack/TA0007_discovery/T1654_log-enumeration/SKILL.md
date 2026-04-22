---
name: "T1654_log-enumeration"
description: "Adversaries may enumerate system and service logs to find useful data."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1654
  - discovery
  - esxi
  - iaas
  - linux
  - macos
  - windows
technique_id: "T1654"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - ESXi
  - IaaS
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1654"
tech_stack:
  - esxi
  - cloud
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1654 Log Enumeration

## High-Level Description

Adversaries may enumerate system and service logs to find useful data. These logs may highlight various types of valuable insights for an adversary, such as user authentication records (Account Discovery), security or vulnerable software (Software Discovery), or hosts within a compromised network (Remote System Discovery).

Host binaries may be leveraged to collect system logs. Examples include using `wevtutil.exe` or PowerShell on Windows to access and/or export security event information. In cloud environments, adversaries may leverage utilities such as the Azure VM Agent’s `CollectGuestLogs.exe` to collect security logs from cloud hosted infrastructure.

Adversaries may also target centralized logging infrastructure such as SIEMs. Logs may also be bulk exported and sent to adversary-controlled infrastructure for offline analysis.

In addition to gaining a better understanding of the environment, adversaries may also monitor logs in real time to track incident response procedures. This may allow them to adjust their techniques in order to maintain persistence or evade defenses.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** ESXi, IaaS, Linux, macOS, Windows

## What to Check

- [ ] Identify if Log Enumeration technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Log Enumeration
- [ ] Check IaaS systems for indicators of Log Enumeration
- [ ] Check Linux systems for indicators of Log Enumeration
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Get-EventLog To Enumerate Windows Security Log

Uses the built-in PowerShell commandlet Get-EventLog to search for 'SYSTEM' keyword and saves results to a text file.

This technique was observed in a [TheDFIRReport case](https://thedfirreport.com/2023/04/03/malicious-iso-file-leads-to-domain-wide-ransomware/)
where the threat actor enumerated the Windows Security audit log to determine user accounts and associated IPv4 addresses.

Successful execution will save matching log events to the users temp folder.

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
powershell -c {get-eventlog 'Security' | where {$_.Message -like '*SYSTEM*'} | export-csv $env:temp\T1654_events.txt}
```

### Atomic Test 2: Enumerate Windows Security Log via WevtUtil

WevtUtil is a command line tool that can be utilised by adversaries to gather intelligence on a targeted Windows system's logging infrastructure.

By executing this command, malicious actors can enumerate all available event logs, including both default logs such as Application, Security, and System
as well as any custom logs created by administrators.

This information provides valuable insight into the system's logging mechanisms, potentially allowing attackers to identify gaps or weaknesses in the logging configuration

**Supported Platforms:** windows

```cmd
wevtutil enum-logs
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Log Enumeration by examining the target platforms (ESXi, IaaS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1654 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management

Limit the ability to access and export sensitive logs to privileged accounts where possible.

## Detection

### Detection Strategy for Log Enumeration

## Risk Assessment

| Finding                              | Severity | Impact    |
| ------------------------------------ | -------- | --------- |
| Log Enumeration technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Permiso GUI-Vil 2023](https://permiso.io/blog/s/unmasking-guivil-new-cloud-threat-actor/)
- [SIM Swapping and Abuse of the Microsoft Azure Serial Console](https://www.mandiant.com/resources/blog/sim-swapping-abuse-azure-serial)
- [Cadet Blizzard emerges as novel threat actor](https://www.microsoft.com/en-us/security/blog/2023/06/14/cadet-blizzard-emerges-as-a-novel-and-distinct-russian-threat-actor/)
- [WithSecure Lazarus-NoPineapple Threat Intel Report 2023](https://labs.withsecure.com/content/dam/labs/docs/WithSecure-Lazarus-No-Pineapple-Threat-Intelligence-Report-2023.pdf)
- [Atomic Red Team - T1654](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1654)
- [MITRE ATT&CK - T1654](https://attack.mitre.org/techniques/T1654)
