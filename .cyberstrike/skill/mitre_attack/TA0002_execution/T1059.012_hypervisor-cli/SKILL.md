---
name: "T1059.012_hypervisor-cli"
description: "Adversaries may abuse hypervisor command line interpreters (CLIs) to execute malicious commands."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1059.012
  - execution
  - esxi
  - sub-technique
technique_id: "T1059.012"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1059/012"
tech_stack:
  - esxi
cwe_ids:
  - CWE-94
chains_with:
  - T1059
  - T1059.001
  - T1059.002
  - T1059.003
  - T1059.004
  - T1059.005
  - T1059.006
  - T1059.007
  - T1059.008
  - T1059.009
  - T1059.010
  - T1059.011
  - T1059.013
prerequisites:
  - T1059
severity_boost:
  T1059: "Chain with T1059 for deeper attack path"
  T1059.001: "Chain with T1059.001 for deeper attack path"
  T1059.002: "Chain with T1059.002 for deeper attack path"
---

# T1059.012 Hypervisor CLI

> **Sub-technique of:** T1059

## High-Level Description

Adversaries may abuse hypervisor command line interpreters (CLIs) to execute malicious commands. Hypervisor CLIs typically enable a wide variety of functionality for managing both the hypervisor itself and the guest virtual machines it hosts.

For example, on ESXi systems, tools such as `esxcli` and `vim-cmd` allow administrators to configure firewall rules and log forwarding on the hypervisor, list virtual machines, start and stop virtual machines, and more. Adversaries may be able to leverage these tools in order to support further actions, such as File and Directory Discovery or Data Encrypted for Impact.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** ESXi

## What to Check

- [ ] Identify if Hypervisor CLI technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Hypervisor CLI
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Hypervisor CLI by examining the target platforms (ESXi).

2. **Assess Existing Defenses**: Review whether mitigations for T1059.012 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for ESXi Hypervisor CLI Abuse

## Risk Assessment

| Finding                             | Severity | Impact    |
| ----------------------------------- | -------- | --------- |
| Hypervisor CLI technique applicable | Medium   | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [Broadcom ESXCLI Reference](https://developer.broadcom.com/xapis/esxcli-command-reference/latest/)
- [LOLESXi](https://lolesxi-project.github.io/LOLESXi/)
- [Crowdstrike Hypervisor Jackpotting Pt 2 2021](https://www.crowdstrike.com/en-us/blog/hypervisor-jackpotting-ecrime-actors-increase-targeting-of-esxi-servers/)
- [Atomic Red Team - T1059.012](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1059.012)
- [MITRE ATT&CK - T1059.012](https://attack.mitre.org/techniques/T1059/012)
