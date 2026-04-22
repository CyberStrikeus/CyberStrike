---
name: "T1053_scheduled-taskjob"
description: "Adversaries may abuse task scheduling functionality to facilitate initial or recurring execution of malicious code."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1053
  - execution
  - persistence
  - privilege-escalation
  - windows
  - linux
  - macos
  - containers
  - esxi
technique_id: "T1053"
tactic: "execution"
all_tactics:
  - execution
  - persistence
  - privilege-escalation
platforms:
  - Windows
  - Linux
  - macOS
  - Containers
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1053"
tech_stack:
  - windows
  - linux
  - macos
  - containers
  - esxi
cwe_ids:
  - CWE-94
chains_with:
  - T1053.002
  - T1053.003
  - T1053.005
  - T1053.006
  - T1053.007
prerequisites: []
severity_boost:
  T1053.002: "Chain with T1053.002 for deeper attack path"
  T1053.003: "Chain with T1053.003 for deeper attack path"
  T1053.005: "Chain with T1053.005 for deeper attack path"
---

# T1053 Scheduled Task/Job

## High-Level Description

Adversaries may abuse task scheduling functionality to facilitate initial or recurring execution of malicious code. Utilities exist within all major operating systems to schedule programs or scripts to be executed at a specified date and time. A task can also be scheduled on a remote system, provided the proper authentication is met (ex: RPC and file and printer sharing in Windows environments). Scheduling a task on a remote system typically may require being a member of an admin or otherwise privileged group on the remote system.

Adversaries may use task scheduling to execute programs at system startup or on a scheduled basis for persistence. These mechanisms can also be abused to run a process under the context of a specified account (such as one with elevated permissions/privileges). Similar to System Binary Proxy Execution, adversaries have also abused task scheduling to potentially mask one-time execution under a trusted system process.

## Kill Chain Phase

- Execution (TA0002)
- Persistence (TA0003)
- Privilege Escalation (TA0004)

**Platforms:** Windows, Linux, macOS, Containers, ESXi

## What to Check

- [ ] Identify if Scheduled Task/Job technique is applicable to target environment
- [ ] Check Windows systems for indicators of Scheduled Task/Job
- [ ] Check Linux systems for indicators of Scheduled Task/Job
- [ ] Check macOS systems for indicators of Scheduled Task/Job
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Scheduled Task/Job by examining the target platforms (Windows, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1053 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1018 User Account Management

Limit privileges of user accounts and remediate Privilege Escalation vectors so only authorized administrators can create scheduled tasks on remote systems.

### M1028 Operating System Configuration

Configure settings for scheduled tasks to force tasks to run under the context of the authenticated account instead of allowing them to run as SYSTEM. The associated Registry key is located at <code>HKLM\SYSTEM\CurrentControlSet\Control\Lsa\SubmitControl</code>. The setting can be configured through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > Security Options: Domain Controller: Allow server operators to schedule tasks, set to disabled.

### M1022 Restrict File and Directory Permissions

Restrict access by setting directory and file permissions that are not specific to users or privileged accounts.

### M1026 Privileged Account Management

Configure the Increase Scheduling Priority option to only allow the Administrators group the rights to schedule a priority process. This can be can be configured through GPO: Computer Configuration > [Policies] > Windows Settings > Security Settings > Local Policies > User Rights Assignment: Increase scheduling priority.

### M1047 Audit

Toolkits like the PowerSploit framework contain PowerUp modules that can be used to explore systems for permission weaknesses in scheduled tasks that could be used to escalate privileges.

## Detection

### Cross-Platform Behavioral Detection of Scheduled Task/Job Abuse

## Risk Assessment

| Finding                                 | Severity | Impact    |
| --------------------------------------- | -------- | --------- |
| Scheduled Task/Job technique applicable | High     | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [ProofPoint Serpent](https://www.proofpoint.com/us/blog/threat-insight/serpent-no-swiping-new-backdoor-targets-french-entities-unique-attack-chain)
- [TechNet Task Scheduler Security](https://technet.microsoft.com/en-us/library/cc785125.aspx)
- [Atomic Red Team - T1053](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1053)
- [MITRE ATT&CK - T1053](https://attack.mitre.org/techniques/T1053)
