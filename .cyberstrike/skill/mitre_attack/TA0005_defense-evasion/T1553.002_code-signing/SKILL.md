---
name: "T1553.002_code-signing"
description: "Adversaries may create, acquire, or steal code signing materials to sign their malware or tools."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1553.002
  - defense-evasion
  - macos
  - windows
  - sub-technique
technique_id: "T1553.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1553/002"
tech_stack:
  - macos
  - windows
cwe_ids:
  - CWE-693
chains_with:
  - T1553
  - T1553.001
  - T1553.003
  - T1553.004
  - T1553.005
  - T1553.006
prerequisites:
  - T1553
severity_boost:
  T1553: "Chain with T1553 for deeper attack path"
  T1553.001: "Chain with T1553.001 for deeper attack path"
  T1553.003: "Chain with T1553.003 for deeper attack path"
---

# T1553.002 Code Signing

> **Sub-technique of:** T1553

## High-Level Description

Adversaries may create, acquire, or steal code signing materials to sign their malware or tools. Code signing provides a level of authenticity on a binary from the developer and a guarantee that the binary has not been tampered with. The certificates used during an operation may be created, acquired, or stolen by the adversary. Unlike Invalid Code Signature, this activity will result in a valid signature.

Code signing to verify software on first run can be used on modern Windows and macOS systems. It is not used on Linux due to the decentralized nature of the platform. 

Code signing certificates may be used to bypass security policies that require signed code to execute on a system.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** macOS, Windows

## What to Check

- [ ] Identify if Code Signing technique is applicable to target environment
- [ ] Check macOS systems for indicators of Code Signing
- [ ] Check Windows systems for indicators of Code Signing
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Code Signing by examining the target platforms (macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1553.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Suspicious or Malicious Code Signing Abuse


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Code Signing technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [EclecticLightChecksonEXECodeSigning](https://eclecticlight.co/2020/11/16/checks-on-executable-code-in-catalina-and-big-sur-a-first-draft/)
- [Securelist Digital Certificates](https://securelist.com/why-you-shouldnt-completely-trust-files-signed-with-digital-certificates/68593/)
- [Symantec Digital Certificates](http://www.symantec.com/connect/blogs/how-attackers-steal-private-keys-digital-certificates)
- [Wikipedia Code Signing](https://en.wikipedia.org/wiki/Code_signing)
- [Atomic Red Team - T1553.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1553.002)
- [MITRE ATT&CK - T1553.002](https://attack.mitre.org/techniques/T1553/002)
