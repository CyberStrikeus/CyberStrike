---
name: "T1562.011_spoof-security-alerting"
description: "Adversaries may spoof security alerting from tools, presenting false evidence to impair defenders’ awareness of malicious activity."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1562.011
  - defense-evasion
  - windows
  - macos
  - linux
  - sub-technique
technique_id: "T1562.011"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1562/011"
tech_stack:
  - windows
  - macos
  - linux
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
  - T1562.009
  - T1562.010
  - T1562.012
  - T1562.013
prerequisites:
  - T1562
severity_boost:
  T1562: "Chain with T1562 for deeper attack path"
  T1562.001: "Chain with T1562.001 for deeper attack path"
  T1562.002: "Chain with T1562.002 for deeper attack path"
---

# T1562.011 Spoof Security Alerting

> **Sub-technique of:** T1562

## High-Level Description

Adversaries may spoof security alerting from tools, presenting false evidence to impair defenders’ awareness of malicious activity. Messages produced by defensive tools contain information about potential security events as well as the functioning status of security software and the system. Security reporting messages are important for monitoring the normal operation of a system and identifying important events that can signal a security incident.

Rather than or in addition to Indicator Blocking, an adversary can spoof positive affirmations that security tools are continuing to function even after legitimate security tools have been disabled (e.g., Disable or Modify Tools). An adversary can also present a “healthy” system status even after infection. This can be abused to enable further malicious activity by delaying defender responses.

For example, adversaries may show a fake Windows Security GUI and tray icon with a “healthy” system status after Windows Defender and other system tools have been disabled.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, macOS, Linux

## What to Check

- [ ] Identify if Spoof Security Alerting technique is applicable to target environment
- [ ] Check Windows systems for indicators of Spoof Security Alerting
- [ ] Check macOS systems for indicators of Spoof Security Alerting
- [ ] Check Linux systems for indicators of Spoof Security Alerting
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Spoof Security Alerting by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1562.011 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention
Use application controls to mitigate installation and use of payloads that may be utilized to spoof security alerting.


## Detection

### Detection for Spoofing Security Alerting across OS Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Spoof Security Alerting technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [BlackBasta](https://www.sentinelone.com/labs/black-basta-ransomware-attacks-deploy-custom-edr-evasion-tools-tied-to-fin7-threat-actor/)
- [Atomic Red Team - T1562.011](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1562.011)
- [MITRE ATT&CK - T1562.011](https://attack.mitre.org/techniques/T1562/011)
