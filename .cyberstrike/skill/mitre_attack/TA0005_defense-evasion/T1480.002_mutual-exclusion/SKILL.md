---
name: "T1480.002_mutual-exclusion"
description: "Adversaries may constrain execution or actions based on the presence of a mutex associated with malware."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1480.002
  - defense-evasion
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1480.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1480/002"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1480
  - T1480.001
prerequisites:
  - T1480
severity_boost:
  T1480: "Chain with T1480 for deeper attack path"
  T1480.001: "Chain with T1480.001 for deeper attack path"
---

# T1480.002 Mutual Exclusion

> **Sub-technique of:** T1480

## High-Level Description

Adversaries may constrain execution or actions based on the presence of a mutex associated with malware. A mutex is a locking mechanism used to synchronize access to a resource. Only one thread or process can acquire a mutex at a given time.

While local mutexes only exist within a given process, allowing multiple threads to synchronize access to a resource, system mutexes can be used to synchronize the activities of multiple processes. By creating a unique system mutex associated with a particular malware, adversaries can verify whether or not a system has already been compromised.

In Linux environments, malware may instead attempt to acquire a lock on a mutex file. If the malware is able to acquire the lock, it continues to execute; if it fails, it exits to avoid creating a second instance of itself.

Mutex names may be hard-coded or dynamically generated using a predictable algorithm.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Mutual Exclusion technique is applicable to target environment
- [ ] Check Linux systems for indicators of Mutual Exclusion
- [ ] Check macOS systems for indicators of Mutual Exclusion
- [ ] Check Windows systems for indicators of Mutual Exclusion
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Mutual Exclusion by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1480.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1055 Do Not Mitigate
Execution Guardrails likely should not be mitigated with preventative controls because it may protect unintended targets from being compromised. If targeted, efforts should be focused on preventing adversary tools from running earlier in the chain of activity and on identifying subsequent malicious behavior if compromised.


## Detection

### Detection of Mutex-Based Execution Guardrails Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Mutual Exclusion technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [Intezer RedXOR 2021](https://intezer.com/blog/malware-analysis/new-linux-backdoor-redxor-likely-operated-by-chinese-nation-state-actor/)
- [Sans Mutexes 2012](https://www.sans.org/blog/looking-at-mutex-objects-for-malware-discovery-indicators-of-compromise/)
- [ICS Mutexes 2015](https://isc.sans.edu/diary/How+Malware+Generates+Mutex+Names+to+Evade+Detection/19429/)
- [Microsoft Mutexes](https://learn.microsoft.com/en-us/dotnet/standard/threading/mutexes)
- [Deep Instinct BPFDoor 2023](https://www.deepinstinct.com/blog/bpfdoor-malware-evolves-stealthy-sniffing-backdoor-ups-its-game)
- [Atomic Red Team - T1480.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1480.002)
- [MITRE ATT&CK - T1480.002](https://attack.mitre.org/techniques/T1480/002)
