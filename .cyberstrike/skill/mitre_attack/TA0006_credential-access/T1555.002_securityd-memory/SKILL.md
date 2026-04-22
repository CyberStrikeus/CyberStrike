---
name: "T1555.002_securityd-memory"
description: "An adversary with root access may gather credentials by reading `securityd`’s memory."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1555.002
  - credential-access
  - linux
  - macos
  - sub-technique
technique_id: "T1555.002"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1555/002"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-522
chains_with:
  - T1555
  - T1555.001
  - T1555.003
  - T1555.004
  - T1555.005
  - T1555.006
prerequisites:
  - T1555
severity_boost:
  T1555: "Chain with T1555 for deeper attack path"
  T1555.001: "Chain with T1555.001 for deeper attack path"
  T1555.003: "Chain with T1555.003 for deeper attack path"
---

# T1555.002 Securityd Memory

> **Sub-technique of:** T1555

## High-Level Description

An adversary with root access may gather credentials by reading `securityd`’s memory. `securityd` is a service/daemon responsible for implementing security protocols such as encryption and authorization. A privileged adversary may be able to scan through `securityd`'s memory to find the correct sequence of keys to decrypt the user’s logon keychain. This may provide the adversary with various plaintext passwords, such as those for users, WiFi, mail, browsers, certificates, secure notes, etc.

In OS X prior to El Capitan, users with root access can read plaintext keychain passwords of logged-in users because Apple’s keychain implementation allows these credentials to be cached so that users are not repeatedly prompted for passwords. Apple’s `securityd` utility takes the user’s logon password, encrypts it with PBKDF2, and stores this master key in memory. Apple also uses a set of keys and algorithms to encrypt the user’s password, but once the master key is found, an adversary need only iterate over the other values to unlock the final password.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Securityd Memory technique is applicable to target environment
- [ ] Check Linux systems for indicators of Securityd Memory
- [ ] Check macOS systems for indicators of Securityd Memory
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Securityd Memory by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1555.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detect Suspicious Access to securityd Memory for Credential Extraction

## Risk Assessment

| Finding                               | Severity | Impact            |
| ------------------------------------- | -------- | ----------------- |
| Securityd Memory technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [External to DA, the OS X Way](https://www.slideshare.net/slideshow/external-to-da-the-os-x-way/62021418)
- [Apple Dev SecurityD](https://developer.apple.com/library/archive/documentation/Security/Conceptual/Security_Overview/Architecture/Architecture.html)
- [OS X Keychain](https://web.archive.org/web/20130106164109/https://juusosalonen.com/post/30923743427/breaking-into-the-os-x-keychain)
- [OSX Keydnap malware](https://www.welivesecurity.com/2016/07/06/new-osxkeydnap-malware-hungry-credentials/)
- [Atomic Red Team - T1555.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1555.002)
- [MITRE ATT&CK - T1555.002](https://attack.mitre.org/techniques/T1555/002)
