---
name: "T1027.011_fileless-storage"
description: "Adversaries may store data in \"fileless\" formats to conceal malicious activity from defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1027.011
  - defense-evasion
  - windows
  - linux
  - sub-technique
technique_id: "T1027.011"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1027/011"
tech_stack:
  - windows
  - linux
cwe_ids:
  - CWE-693
chains_with:
  - T1027
  - T1027.001
  - T1027.002
  - T1027.003
  - T1027.004
  - T1027.005
  - T1027.006
  - T1027.007
  - T1027.008
  - T1027.009
  - T1027.010
  - T1027.012
  - T1027.013
  - T1027.014
  - T1027.015
  - T1027.016
  - T1027.017
prerequisites:
  - T1027
severity_boost:
  T1027: "Chain with T1027 for deeper attack path"
  T1027.001: "Chain with T1027.001 for deeper attack path"
  T1027.002: "Chain with T1027.002 for deeper attack path"
---

# T1027.011 Fileless Storage

> **Sub-technique of:** T1027

## High-Level Description

Adversaries may store data in "fileless" formats to conceal malicious activity from defenses. Fileless storage can be broadly defined as any format other than a file. Common examples of non-volatile fileless storage in Windows systems include the Windows Registry, event logs, or WMI repository. Shared memory directories on Linux systems (`/dev/shm`, `/run/shm`, `/var/run`, and `/var/lock`) and volatile directories on Network Devices (`/tmp` and `/volatile`) may also be considered fileless storage, as files written to these directories are mapped directly to RAM and not stored on the disk..

Similar to fileless in-memory behaviors such as Reflective Code Loading and Process Injection, fileless data storage may remain undetected by anti-virus and other endpoint security tools that can only access specific file formats from disk storage. Leveraging fileless storage may also allow adversaries to bypass the protections offered by read-only file systems in Linux.

Adversaries may use fileless storage to conceal various types of stored data, including payloads/shellcode (potentially being used as part of Persistence) and collected data not yet exfiltrated from the victim (e.g., Local Data Staging). Adversaries also often encrypt, encode, splice, or otherwise obfuscate this fileless data when stored. 

Some forms of fileless storage activity may indirectly create artifacts in the file system, but in central and otherwise difficult to inspect formats such as the WMI (e.g., `%SystemRoot%\System32\Wbem\Repository`) or Registry (e.g., `%SystemRoot%\System32\Config`) physical files.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, Linux

## What to Check

- [ ] Identify if Fileless Storage technique is applicable to target environment
- [ ] Check Windows systems for indicators of Fileless Storage
- [ ] Check Linux systems for indicators of Fileless Storage
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Fileless Storage by examining the target platforms (Windows, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1027.011 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit
Consider periodic review of common fileless storage locations (such as the Registry or WMI repository) to potentially identify abnormal and malicious data.


## Detection

### Detection Strategy for Fileless Storage via Registry, WMI, and Shared Memory


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Fileless Storage technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Aquasec Muhstik Malware 2024](https://www.aquasec.com/blog/muhstik-malware-targets-message-queuing-services-applications/)
- [Bitsight 7777 Botnet](https://www.bitsight.com/blog/7777-botnet-insights-multi-target-botnet)
- [CISCO Nexus 900 Config](https://www.cisco.com/c/en/us/td/docs/switches/datacenter/nexus9000/sw/7-x/fundamentals/configuration/guide/b_Cisco_Nexus_9000_Series_NX-OS_Fundamentals_Configuration_Guide_7x/b_Cisco_Nexus_9000_Series_NX-OS_Fundamentals_Configuration_Guide_7x_chapter_01000.html)
- [Elastic Binary Executed from Shared Memory Directory](https://www.elastic.co/guide/en/security/7.17/prebuilt-rule-7-16-3-binary-executed-from-shared-memory-directory.html)
- [SecureList Fileless](https://securelist.com/a-new-secret-stash-for-fileless-malware/106393/)
- [Microsoft Fileless](https://learn.microsoft.com/microsoft-365/security/intelligence/fileless-threats)
- [Sysdig Fileless Malware 23022](https://sysdig.com/blog/containers-read-only-fileless-malware/)
- [Akami Frog4Shell 2024](https://www.akamai.com/blog/security-research/fritzfrog-botnet-new-capabilities-log4shell)
- [Atomic Red Team - T1027.011](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1027.011)
- [MITRE ATT&CK - T1027.011](https://attack.mitre.org/techniques/T1027/011)
