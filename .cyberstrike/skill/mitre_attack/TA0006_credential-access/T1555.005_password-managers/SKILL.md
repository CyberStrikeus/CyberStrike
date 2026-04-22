---
name: "T1555.005_password-managers"
description: "Adversaries may acquire user credentials from third-party password managers."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1555.005
  - credential-access
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1555.005"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1555/005"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1555
  - T1555.001
  - T1555.002
  - T1555.003
  - T1555.004
  - T1555.006
prerequisites:
  - T1555
severity_boost:
  T1555: "Chain with T1555 for deeper attack path"
  T1555.001: "Chain with T1555.001 for deeper attack path"
  T1555.002: "Chain with T1555.002 for deeper attack path"
---

# T1555.005 Password Managers

> **Sub-technique of:** T1555

## High-Level Description

Adversaries may acquire user credentials from third-party password managers. Password managers are applications designed to store user credentials, normally in an encrypted database. Credentials are typically accessible after a user provides a master password that unlocks the database. After the database is unlocked, these credentials may be copied to memory. These databases can be stored as files on disk.

Adversaries may acquire user credentials from password managers by extracting the master password and/or plain-text credentials from memory. Adversaries may extract credentials from memory via Exploitation for Credential Access.
Adversaries may also try brute forcing via Password Guessing to obtain the master password of a password manager.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Password Managers technique is applicable to target environment
- [ ] Check Linux systems for indicators of Password Managers
- [ ] Check macOS systems for indicators of Password Managers
- [ ] Check Windows systems for indicators of Password Managers
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Password Managers by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1555.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1051 Update Software

Regularly update web browsers, password managers, and all related software to the latest versions. Keeping software up-to-date reduces the risk of vulnerabilities being exploited by attackers to extract stored credentials or session cookies.

### M1018 User Account Management

Implement strict user account management policies to prevent unnecessary accounts from accessing sensitive systems. Regularly audit user accounts to identify and disable inactive accounts that may be targeted by attackers to extract credentials or gain unauthorized access.

### M1017 User Training

Provide user training on secure practices for managing credentials, including avoiding storing sensitive passwords in browsers and using password managers securely. Users should also be educated on identifying phishing attempts that could steal session cookies or credentials.

### M1054 Software Configuration

Consider re-locking password managers after a short timeout to limit the time plaintext credentials live in memory from decrypted databases.

### M1027 Password Policies

Refer to NIST guidelines when creating password policies for master passwords.

## Detection

### Detect Unauthorized Access to Password Managers

## Risk Assessment

| Finding                                | Severity | Impact            |
| -------------------------------------- | -------- | ----------------- |
| Password Managers technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Cyberreason Anchor December 2019](https://www.cybereason.com/blog/dropping-anchor-from-a-trickbot-infection-to-the-discovery-of-the-anchor-malware)
- [FoxIT Wocao December 2019](https://www.fox-it.com/media/kadlze5c/201912_report_operation_wocao.pdf)
- [ise Password Manager February 2019](https://www.ise.io/casestudies/password-manager-hacking/)
- [Github KeeThief](https://github.com/GhostPack/KeeThief)
- [NVD CVE-2019-3610](https://nvd.nist.gov/vuln/detail/CVE-2019-3610)
- [Atomic Red Team - T1555.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1555.005)
- [MITRE ATT&CK - T1555.005](https://attack.mitre.org/techniques/T1555/005)
