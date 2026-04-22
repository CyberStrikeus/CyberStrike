---
name: "T1569.001_launchctl"
description: "Adversaries may abuse launchctl to execute commands or programs."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1569.001
  - execution
  - macos
  - sub-technique
technique_id: "T1569.001"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1569/001"
tech_stack:
  - macos
cwe_ids:
  - CWE-94
chains_with:
  - T1569
  - T1569.002
  - T1569.003
prerequisites:
  - T1569
severity_boost:
  T1569: "Chain with T1569 for deeper attack path"
  T1569.002: "Chain with T1569.002 for deeper attack path"
  T1569.003: "Chain with T1569.003 for deeper attack path"
---

# T1569.001 Launchctl

> **Sub-technique of:** T1569

## High-Level Description

Adversaries may abuse launchctl to execute commands or programs. Launchctl interfaces with launchd, the service management framework for macOS. Launchctl supports taking subcommands on the command-line, interactively, or even redirected from standard input.

Adversaries use launchctl to execute commands and programs as Launch Agents or Launch Daemons. Common subcommands include: <code>launchctl load</code>,<code>launchctl unload</code>, and <code>launchctl start</code>. Adversaries can use scripts or manually run the commands <code>launchctl load -w "%s/Library/LaunchAgents/%s"</code> or <code>/bin/launchctl load</code> to execute Launch Agents or Launch Daemons.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** macOS

## What to Check

- [ ] Identify if Launchctl technique is applicable to target environment
- [ ] Check macOS systems for indicators of Launchctl
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Launchctl

Utilize launchctl

**Supported Platforms:** macos

```bash
launchctl submit -l #{label_name} -- #{executable_path}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Launchctl by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1569.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1018 User Account Management
Prevent users from installing their own launch agents or launch daemons.


## Detection

### Detection Strategy for System Services: Launchctl


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Launchctl technique applicable | Low | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Sofacy Komplex Trojan](https://researchcenter.paloaltonetworks.com/2016/09/unit42-sofacys-komplex-os-x-trojan/)
- [20 macOS Common Tools and Techniques](https://labs.sentinelone.com/20-common-tools-techniques-used-by-macos-threat-actors-malware/)
- [Launchctl Man](https://ss64.com/osx/launchctl.html)
- [Atomic Red Team - T1569.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1569.001)
- [MITRE ATT&CK - T1569.001](https://attack.mitre.org/techniques/T1569/001)
