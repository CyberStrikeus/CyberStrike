---
name: "T1497.003_time-based-checks"
description: "Adversaries may employ various time-based methods to detect virtualization and analysis environments, particularly those that attempt to manipulate time mechanisms to simulate longer elapses of time."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1497.003
  - defense-evasion
  - discovery
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1497.003"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1497/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1497
  - T1497.001
  - T1497.002
prerequisites:
  - T1497
severity_boost:
  T1497: "Chain with T1497 for deeper attack path"
  T1497.001: "Chain with T1497.001 for deeper attack path"
  T1497.002: "Chain with T1497.002 for deeper attack path"
---

# T1497.003 Time Based Checks

> **Sub-technique of:** T1497

## High-Level Description

Adversaries may employ various time-based methods to detect virtualization and analysis environments, particularly those that attempt to manipulate time mechanisms to simulate longer elapses of time. This may include enumerating time-based properties, such as uptime or the system clock.

Adversaries may use calls like `GetTickCount` and `GetSystemTimeAsFileTime` to discover if they are operating within a virtual machine or sandbox, or may be able to identify a sandbox accelerating time by sampling and calculating the expected value for an environment's timestamp before and after execution of a sleep function.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Time Based Checks technique is applicable to target environment
- [ ] Check Linux systems for indicators of Time Based Checks
- [ ] Check macOS systems for indicators of Time Based Checks
- [ ] Check Windows systems for indicators of Time Based Checks
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Delay execution with ping

Uses the ping command to introduce a delay before executing a malicious payload.

**Supported Platforms:** linux, macos

```bash
ping -c #{ping_count} 8.8.8.8 > /dev/null
#{evil_command}
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Time Based Checks by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1497.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Time-Based Evasion via Sleep, Timer Loops, and Delayed Execution

## Risk Assessment

| Finding                                | Severity | Impact          |
| -------------------------------------- | -------- | --------------- |
| Time Based Checks technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [ISACA Malware Tricks](https://www.isaca.org/resources/isaca-journal/issues/2017/volume-6/evasive-malware-tricks-how-malware-evades-detection-by-sandboxes)
- [Atomic Red Team - T1497.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1497.003)
- [MITRE ATT&CK - T1497.003](https://attack.mitre.org/techniques/T1497/003)
