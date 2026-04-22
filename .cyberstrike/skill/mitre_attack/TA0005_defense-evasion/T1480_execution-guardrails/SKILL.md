---
name: "T1480_execution-guardrails"
description: "Adversaries may use execution guardrails to constrain execution or actions based on adversary supplied and environment specific conditions that are expected to be present on the target."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1480
  - defense-evasion
  - esxi
  - linux
  - macos
  - windows
technique_id: "T1480"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1480"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1480.001
  - T1480.002
prerequisites:
  []
severity_boost:
  T1480.001: "Chain with T1480.001 for deeper attack path"
  T1480.002: "Chain with T1480.002 for deeper attack path"
---

# T1480 Execution Guardrails

## High-Level Description

Adversaries may use execution guardrails to constrain execution or actions based on adversary supplied and environment specific conditions that are expected to be present on the target. Guardrails ensure that a payload only executes against an intended target and reduces collateral damage from an adversary’s campaign. Values an adversary can provide about a target system or environment to use as guardrails may include specific network share names, attached physical devices, files, joined Active Directory (AD) domains, and local/external IP addresses.

Guardrails can be used to prevent exposure of capabilities in environments that are not intended to be compromised or operated within. This use of guardrails is distinct from typical Virtualization/Sandbox Evasion. While use of Virtualization/Sandbox Evasion may involve checking for known sandbox values and continuing with execution only if there is no match, the use of guardrails will involve checking for an expected target-specific value and only continuing with execution if there is such a match.

Adversaries may identify and block certain user-agents to evade defenses and narrow the scope of their attack to victims and platforms on which it will be most effective. A user-agent self-identifies data such as a user's software application, operating system, vendor, and version. Adversaries may check user-agents for operating system identification and then only serve malware for the exploitable software while ignoring all other operating systems.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Execution Guardrails technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Execution Guardrails
- [ ] Check Linux systems for indicators of Execution Guardrails
- [ ] Check macOS systems for indicators of Execution Guardrails
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Execution Guardrails by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1480 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1055 Do Not Mitigate
Execution Guardrails likely should not be mitigated with preventative controls because it may protect unintended targets from being compromised. If targeted, efforts should be focused on preventing adversary tools from running earlier in the chain of activity and on identifying subsequent malicious behavior if compromised.


## Detection

### Multi-Platform Execution Guardrails Environmental Validation Detection Strategy


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Execution Guardrails technique applicable | High | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [FireEye Outlook Dec 2019](https://www.fireeye.com/blog/threat-research/2019/12/breaking-the-rules-tough-outlook-for-home-page-attacks.html)
- [Trellix-Qakbot](https://www.trellix.com/blogs/research/qakbot-evolves-to-onenote-malware-distribution/)
- [FireEye Kevin Mandia Guardrails](https://www.cyberscoop.com/kevin-mandia-fireeye-u-s-malware-nice/)
- [Atomic Red Team - T1480](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1480)
- [MITRE ATT&CK - T1480](https://attack.mitre.org/techniques/T1480)
