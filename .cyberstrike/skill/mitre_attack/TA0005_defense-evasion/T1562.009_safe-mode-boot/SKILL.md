---
name: "T1562.009_safe-mode-boot"
description: "Adversaries may abuse Windows safe mode to disable endpoint defenses."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.009
  - defense-evasion
  - windows
  - sub-technique
technique_id: "T1562.009"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1562/009"
tech_stack:
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1562
  - T1562.001
  - T1562.002
  - T1562.003
  - T1562.004
  - T1562.006
  - T1562.007
  - T1562.008
  - T1562.010
  - T1562.011
  - T1562.012
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.009 Safe Mode Boot

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may abuse Windows safe mode to disable endpoint defenses. Safe mode starts up the Windows operating system with a limited set of drivers and services. Third-party security software such as endpoint detection and response (EDR) tools may not start after booting Windows in safe mode. There are two versions of safe mode: Safe Mode and Safe Mode with Networking. It is possible to start additional services after a safe mode boot.

Adversaries may abuse safe mode to disable endpoint defenses that may not start with a limited boot. Hosts can be forced into safe mode after the next reboot via modifications to Boot Configuration Data (BCD) stores, which are files that manage boot application settings.

Adversaries may also add their malicious applications to the list of minimal services that start in safe mode by modifying relevant Registry values (i.e. Modify Registry). Malicious Component Object Model (COM) objects may also be registered and loaded in safe mode.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows

## What to Check

- [ ] Identify if Safe Mode Boot technique is applicable to target environment
- [ ] Check Windows systems for indicators of Safe Mode Boot
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Safe Mode Boot

Allows adversaries to abuse safe mode to disable endpoint defenses that may not start with limited boot

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
bcdedit /set safeboot network
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Safe Mode Boot by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Restrict administrator accounts to as few individuals as possible, following least privilege principles, that may be abused to remotely boot a machine in safe mode.

### M1054 Software Configuration

Ensure that endpoint defenses run in safe mode.

## Detection

### Detection Strategy for Safe Mode Boot Abuse

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| Safe Mode Boot technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [BleepingComputer REvil 2021](https://www.bleepingcomputer.com/news/security/revil-ransomware-has-a-new-windows-safe-mode-encryption-mode/)
- [Cybereason Nocturnus MedusaLocker 2020](https://www.cybereason.com/blog/medusalocker-ransomware)
- [Microsoft Bootcfg](https://docs.microsoft.com/windows-server/administration/windows-commands/bootcfg)
- [Microsoft bcdedit 2021](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/bcdedit)
- [Microsoft Safe Mode](https://support.microsoft.com/en-us/windows/start-your-pc-in-safe-mode-in-windows-10-92c27cff-db89-8644-1ce4-b3e5e56fe234)
- [CyberArk Labs Safe Mode 2016](https://www.cyberark.com/resources/blog/cyberark-labs-from-safe-mode-to-domain-compromise)
- [Sophos Snatch Ransomware 2019](https://news.sophos.com/en-us/2019/12/09/snatch-ransomware-reboots-pcs-into-safe-mode-to-bypass-protection/)
- [Atomic Red Team - T1562.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.009)
- [MITRE ATT&CK - T1562.009](https://attack.mitre.org/techniques/T1562/009)
