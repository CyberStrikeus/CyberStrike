---
name: "T1204.001_malicious-link"
description: "An adversary may rely upon a user clicking a malicious link in order to gain execution."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1204.001
  - execution
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1204.001"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1204/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-94
chains_with:
  - T1204
  - T1204.002
  - T1204.003
  - T1204.004
  - T1204.005
prerequisites:
  - T1204
severity_boost:
  T1204: "Chain with T1204 for deeper attack path"
  T1204.002: "Chain with T1204.002 for deeper attack path"
  T1204.003: "Chain with T1204.003 for deeper attack path"
---

# T1204.001 Malicious Link

> **Sub-technique of:** T1204

## High-Level Description

An adversary may rely upon a user clicking a malicious link in order to gain execution. Users may be subjected to social engineering to get them to click on a link that will lead to code execution. This user action will typically be observed as follow-on behavior from Spearphishing Link. Clicking on a link may also lead to other execution techniques such as exploitation of a browser or application vulnerability via Exploitation for Client Execution. Links may also lead users to download files that require execution via Malicious File.

## Kill Chain Phase

- Execution (TA0002)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Malicious Link technique is applicable to target environment
- [ ] Check Linux systems for indicators of Malicious Link
- [ ] Check macOS systems for indicators of Malicious Link
- [ ] Check Windows systems for indicators of Malicious Link
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Malicious Link by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1204.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1031 Network Intrusion Prevention
If a link is being visited by a user, network intrusion prevention systems and systems designed to scan and remove malicious downloads can be used to block activity.

### M1017 User Training
Use user training as a way to bring awareness to common phishing and spearphishing techniques and how to raise suspicion for potentially malicious events.

### M1021 Restrict Web-Based Content
If a link is being visited by a user, block unknown or unused files in transit by default that should not be downloaded or by policy from suspicious sites as a best practice to prevent some vectors, such as .scr, .exe, .pif, .cpl, etc. Some download scanning devices can open and analyze compressed and encrypted formats, such as zip and rar that may be used to conceal malicious files.


## Detection

### User Execution – Malicious Link (click → suspicious egress → download/write → follow-on activity)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Malicious Link technique applicable | High | Execution |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-94 | Improper Control of Generation of Code |


## References

- [Atomic Red Team - T1204.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1204.001)
- [MITRE ATT&CK - T1204.001](https://attack.mitre.org/techniques/T1204/001)
