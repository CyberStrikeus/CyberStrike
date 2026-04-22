---
name: "T1553_subvert-trust-controls"
description: "Adversaries may undermine security controls that will either warn users of untrusted activity or prevent execution of untrusted programs."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1553
  - defense-evasion
  - windows
  - macos
  - linux
technique_id: "T1553"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Windows
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1553"
tech_stack:
  - windows
  - macos
  - linux
cwe_ids:
  - CWE-693
chains_with:
  - T1553.001
  - T1553.002
  - T1553.003
  - T1553.004
  - T1553.005
  - T1553.006
prerequisites:
  []
severity_boost:
  T1553.001: "Chain with T1553.001 for deeper attack path"
  T1553.002: "Chain with T1553.002 for deeper attack path"
  T1553.003: "Chain with T1553.003 for deeper attack path"
---

# T1553 Subvert Trust Controls

## High-Level Description

Adversaries may undermine security controls that will either warn users of untrusted activity or prevent execution of untrusted programs. Operating systems and security products may contain mechanisms to identify programs or websites as possessing some level of trust. Examples of such features would include a program being allowed to run because it is signed by a valid code signing certificate, a program prompting the user with a warning because it has an attribute set from being downloaded from the Internet, or getting an indication that you are about to connect to an untrusted site.

Adversaries may attempt to subvert these trust mechanisms. The method adversaries use will depend on the specific mechanism they seek to subvert. Adversaries may conduct File and Directory Permissions Modification or Modify Registry in support of subverting these controls. Adversaries may also create or steal code signing certificates to acquire trust on target systems.

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Windows, macOS, Linux

## What to Check

- [ ] Identify if Subvert Trust Controls technique is applicable to target environment
- [ ] Check Windows systems for indicators of Subvert Trust Controls
- [ ] Check macOS systems for indicators of Subvert Trust Controls
- [ ] Check Linux systems for indicators of Subvert Trust Controls
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Subvert Trust Controls by examining the target platforms (Windows, macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1553 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1038 Execution Prevention
System settings can prevent applications from running that haven't been downloaded through the Apple Store (or other legitimate repositories) which can help mitigate some of these issues. Also enable application control solutions such as AppLocker and/or Device Guard to block the loading of malicious content.

### M1028 Operating System Configuration
Windows Group Policy can be used to manage root certificates and the <code>Flags</code> value of <code>HKLM\\SOFTWARE\\Policies\\Microsoft\\SystemCertificates\\Root\\ProtectedRoots</code> can be set to 1 to prevent non-administrator users from making further root installations into their own HKCU certificate store.

### M1026 Privileged Account Management
Manage the creation, modification, use, and permissions associated to privileged accounts, including SYSTEM and root.

### M1024 Restrict Registry Permissions
Ensure proper permissions are set for Registry hives to prevent users from modifying keys related to SIP and trust provider components. Components may still be able to be hijacked to suitable functions already present on disk if malicious modifications to Registry keys are not prevented.

### M1054 Software Configuration
HTTP Public Key Pinning (HPKP) is one method to mitigate potential Adversary-in-the-Middle situations where and adversary uses a mis-issued or fraudulent certificate to intercept encrypted communications by enforcing use of an expected certificate.


## Detection

### Detect Subversion of Trust Controls via Certificate, Registry, and Attribute Manipulation


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Subvert Trust Controls technique applicable | Low | Defense Evasion |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-693 | Protection Mechanism Failure |


## References

- [SpectorOps Code Signing Dec 2017](https://posts.specterops.io/code-signing-certificate-cloning-attacks-and-defenses-6f98657fc6ec)
- [SpectorOps Subverting Trust Sept 2017](https://specterops.io/assets/resources/SpecterOps_Subverting_Trust_in_Windows.pdf)
- [Securelist Digital Certificates](https://securelist.com/why-you-shouldnt-completely-trust-files-signed-with-digital-certificates/68593/)
- [Symantec Digital Certificates](http://www.symantec.com/connect/blogs/how-attackers-steal-private-keys-digital-certificates)
- [Atomic Red Team - T1553](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1553)
- [MITRE ATT&CK - T1553](https://attack.mitre.org/techniques/T1553)
