---
name: "T1036.009_break-process-trees"
description: "An adversary may attempt to evade process tree-based analysis by modifying executed malware's parent process ID (PPID)."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1036.009
  - defense-evasion
  - linux
  - macos
  - sub-technique
technique_id: "T1036.009"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1036/009"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1036
  - T1036.001
  - T1036.002
  - T1036.003
  - T1036.004
  - T1036.005
  - T1036.006
  - T1036.007
  - T1036.008
  - T1036.010
  - T1036.011
  - T1036.012
prerequisites:
  - T1036
severity_boost:
  T1036: "Chain with T1036 for deeper attack path"
  T1036.001: "Chain with T1036.001 for deeper attack path"
  T1036.002: "Chain with T1036.002 for deeper attack path"
---

# T1036.009 Break Process Trees

> **Sub-technique of:** T1036

## High-Level Description

An adversary may attempt to evade process tree-based analysis by modifying executed malware's parent process ID (PPID). If endpoint protection software leverages the “parent-child" relationship for detection, breaking this relationship could result in the adversary’s behavior not being associated with previous process tree activity. On Unix-based systems breaking this process tree is common practice for administrators to execute software using scripts and programs.

On Linux systems, adversaries may execute a series of Native API calls to alter malware's process tree. For example, adversaries can execute their payload without any arguments, call the `fork()` API call twice, then have the parent process exit. This creates a grandchild process with no parent process that is immediately adopted by the `init` system process (PID 1), which successfully disconnects the execution of the adversary's payload from its previous process tree.

Another example is using the “daemon” syscall to detach from the current parent process and run in the background.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Break Process Trees technique is applicable to target environment
- [ ] Check Linux systems for indicators of Break Process Trees
- [ ] Check macOS systems for indicators of Break Process Trees
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Break Process Trees by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1036.009 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Masquerading via Breaking Process Trees

## Risk Assessment

| Finding                                  | Severity | Impact          |
| ---------------------------------------- | -------- | --------------- |
| Break Process Trees technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [3OHA double-fork 2022](https://0xjet.github.io/3OHA/2022/04/11/post.html)
- [Microsoft XorDdos Linux Stealth 2022](https://www.microsoft.com/en-us/security/blog/2022/05/19/rise-in-xorddos-a-deeper-look-at-the-stealthy-ddos-malware-targeting-linux-devices/)
- [Sandfly BPFDoor 2022](https://sandflysecurity.com/blog/bpfdoor-an-evasive-linux-backdoor-technical-analysis/)
- [Atomic Red Team - T1036.009](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1036.009)
- [MITRE ATT&CK - T1036.009](https://attack.mitre.org/techniques/T1036/009)
