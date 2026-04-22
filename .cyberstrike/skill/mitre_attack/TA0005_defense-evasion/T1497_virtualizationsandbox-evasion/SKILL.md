---
name: "T1497_virtualizationsandbox-evasion"
description: "Adversaries may employ various means to detect and avoid virtualization and analysis environments."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1497
  - defense-evasion
  - discovery
  - linux
  - macos
  - windows
technique_id: "T1497"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1497"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1497.001
  - T1497.002
  - T1497.003
prerequisites: []
severity_boost:
  T1497.001: "Chain with T1497.001 for deeper attack path"
  T1497.002: "Chain with T1497.002 for deeper attack path"
  T1497.003: "Chain with T1497.003 for deeper attack path"
---

# T1497 Virtualization/Sandbox Evasion

## High-Level Description

Adversaries may employ various means to detect and avoid virtualization and analysis environments. This may include changing behaviors based on the results of checks for the presence of artifacts indicative of a virtual machine environment (VME) or sandbox. If the adversary detects a VME, they may alter their malware to disengage from the victim or conceal the core functions of the implant. They may also search for VME artifacts before dropping secondary or additional payloads. Adversaries may use the information learned from Virtualization/Sandbox Evasion during automated discovery to shape follow-on behaviors.

Adversaries may use several methods to accomplish Virtualization/Sandbox Evasion such as checking for security monitoring tools (e.g., Sysinternals, Wireshark, etc.) or other system artifacts associated with analysis or virtualization. Adversaries may also check for legitimate user activity to help determine if it is in an analysis environment. Additional methods include use of sleep timers or loops within malware code to avoid operating within a temporary sandbox.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Virtualization/Sandbox Evasion technique is applicable to target environment
- [ ] Check Linux systems for indicators of Virtualization/Sandbox Evasion
- [ ] Check macOS systems for indicators of Virtualization/Sandbox Evasion
- [ ] Check Windows systems for indicators of Virtualization/Sandbox Evasion
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Virtualization/Sandbox Evasion by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1497 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for T1497 Virtualization/Sandbox Evasion

## Risk Assessment

| Finding                                             | Severity | Impact          |
| --------------------------------------------------- | -------- | --------------- |
| Virtualization/Sandbox Evasion technique applicable | Medium   | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Unit 42 Pirpi July 2015](https://unit42.paloaltonetworks.com/ups-observations-on-cve-2015-3113-prior-zero-days-and-the-pirpi-payload/)
- [Deloitte Environment Awareness](https://drive.google.com/file/d/1t0jn3xr4ff2fR30oQAUn_RsWSnMpOAQc/edit)
- [Atomic Red Team - T1497](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1497)
- [MITRE ATT&CK - T1497](https://attack.mitre.org/techniques/T1497)
