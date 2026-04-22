---
name: "T1204_user-execution"
description: "An adversary may rely upon specific actions by a user in order to gain execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1204
  - execution
  - linux
  - windows
  - macos
  - iaas
  - containers
technique_id: "T1204"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - Windows
  - macOS
  - IaaS
  - Containers
mitre_url: "https://attack.mitre.org/techniques/T1204"
tech_stack:
  - linux
  - windows
  - macos
  - cloud
  - containers
cwe_ids:
  - CWE-94
chains_with:
  - T1204.001
  - T1204.002
  - T1204.003
  - T1204.004
  - T1204.005
prerequisites: []
severity_boost:
  T1204.001: "Chain with T1204.001 for deeper attack path"
  T1204.002: "Chain with T1204.002 for deeper attack path"
  T1204.003: "Chain with T1204.003 for deeper attack path"
---

# T1204 User Execution

## High-Level Description

An adversary may rely upon specific actions by a user in order to gain execution. Users may be subjected to social engineering to get them to execute malicious code by, for example, opening a malicious document file or link. These user actions will typically be observed as follow-on behavior from forms of Phishing.

While User Execution frequently occurs shortly after Initial Access it may occur at other phases of an intrusion, such as when an adversary places a file in a shared directory or on a user's desktop hoping that a user will click on it. This activity may also be seen shortly after Internal Spearphishing.

Adversaries may also deceive users into performing actions such as:

- Enabling Remote Access Tools, allowing direct control of the system to the adversary
- Running malicious JavaScript in their browser, allowing adversaries to Steal Web Session Cookies
- Downloading and executing malware for User Execution
- Coerceing users to copy, paste, and execute malicious code manually

For example, tech support scams can be facilitated through Phishing, vishing, or various forms of user interaction. Adversaries can use a combination of these methods, such as spoofing and promoting toll-free numbers or call centers that are used to direct victims to malicious websites, to deliver and execute payloads containing malware or Remote Access Tools.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, Windows, macOS, IaaS, Containers

## What to Check

- [ ] Identify if User Execution technique is applicable to target environment
- [ ] Check Linux systems for indicators of User Execution
- [ ] Check Windows systems for indicators of User Execution
- [ ] Check macOS systems for indicators of User Execution
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to User Execution by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1204 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1017 User Training

Use user training as a way to bring awareness to common phishing and spearphishing techniques and how to raise suspicion for potentially malicious events.

### M1038 Execution Prevention

Application control may be able to prevent the running of executables masquerading as other files.

### M1040 Behavior Prevention on Endpoint

On Windows 10, enable Attack Surface Reduction (ASR) rules to prevent executable files from running unless they meet a prevalence, age, or trusted list criteria and to prevent Office applications from creating potentially malicious executable content by blocking malicious code from being written to disk. Note: cloud-delivered protection must be enabled to use certain rules.

### M1021 Restrict Web-Based Content

If a link is being visited by a user, block unknown or unused files in transit by default that should not be downloaded or by policy from suspicious sites as a best practice to prevent some vectors, such as .scr, .exe, .pif, .cpl, etc. Some download scanning devices can open and analyze compressed and encrypted formats, such as zip and rar that may be used to conceal malicious files.

### M1031 Network Intrusion Prevention

If a link is being visited by a user, network intrusion prevention systems and systems designed to scan and remove malicious downloads can be used to block activity.

### M1033 Limit Software Installation

Where possible, consider requiring developers to pull from internal repositories containing verified and approved packages rather than from external ones.

## Detection

### User Execution – multi-surface behavior chain (documents/links → helper/unpacker → LOLBIN/child → egress)

## Risk Assessment

| Finding                             | Severity | Impact    |
| ----------------------------------- | -------- | --------- |
| User Execution technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Krebs Discord Bookmarks 2023](https://krebsonsecurity.com/2023/05/discord-admins-hacked-by-malicious-bookmarks/)
- [Reliaquest-execution](https://www.reliaquest.com/blog/new-execution-technique-in-clearfake-campaign/)
- [Telephone Attack Delivery](https://www.proofpoint.com/us/blog/threat-insight/caught-beneath-landline-411-telephone-oriented-attack-delivery)
- [Talos Roblox Scam 2023](https://blog.talosintelligence.com/roblox-scam-overview/)
- [proofpoint-selfpwn](https://www.proofpoint.com/us/blog/threat-insight/clipboard-compromise-powershell-self-pwn)
- [Atomic Red Team - T1204](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1204)
- [MITRE ATT&CK - T1204](https://attack.mitre.org/techniques/T1204)
