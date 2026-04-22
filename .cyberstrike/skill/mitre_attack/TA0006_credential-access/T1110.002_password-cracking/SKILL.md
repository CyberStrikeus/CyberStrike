---
name: "T1110.002_password-cracking"
description: "Adversaries may use password cracking to attempt to recover usable credentials, such as plaintext passwords, when credential material such as password hashes are obtained."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1110.002
  - credential-access
  - linux
  - macos
  - windows
  - network-devices
  - office-suite
  - identity-provider
  - sub-technique
technique_id: "T1110.002"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - macOS
  - Windows
  - Network Devices
  - Office Suite
  - Identity Provider
mitre_url: "https://attack.mitre.org/techniques/T1110/002"
tech_stack:
  - linux
  - macos
  - windows
  - network devices
  - office
  - identity
cwe_ids:
  - CWE-522
chains_with:
  - T1110
  - T1110.001
  - T1110.003
  - T1110.004
prerequisites:
  - T1110
severity_boost:
  T1110: "Chain with T1110 for deeper attack path"
  T1110.001: "Chain with T1110.001 for deeper attack path"
  T1110.003: "Chain with T1110.003 for deeper attack path"
---

# T1110.002 Password Cracking

> **Sub-technique of:** T1110

## High-Level Description

Adversaries may use password cracking to attempt to recover usable credentials, such as plaintext passwords, when credential material such as password hashes are obtained. OS Credential Dumping can be used to obtain password hashes, this may only get an adversary so far when Pass the Hash is not an option. Further, adversaries may leverage Data from Configuration Repository in order to obtain hashed credentials for network devices.

Techniques to systematically guess the passwords used to compute hashes are available, or the adversary may use a pre-computed rainbow table to crack hashes. Cracking hashes is usually done on adversary-controlled systems outside of the target network. The resulting plaintext password resulting from a successfully cracked hash may be used to log into systems, resources, and services in which the account has access.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, macOS, Windows, Network Devices, Office Suite, Identity Provider

## What to Check

- [ ] Identify if Password Cracking technique is applicable to target environment
- [ ] Check Linux systems for indicators of Password Cracking
- [ ] Check macOS systems for indicators of Password Cracking
- [ ] Check Windows systems for indicators of Password Cracking
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Password Cracking with Hashcat

Execute Hashcat.exe with provided SAM file from registry of Windows and Password list to crack against

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
cd #{hashcat_exe}\..
#{hashcat_exe} -a 0 -m 1000 -r .\rules\Incisive-leetspeak.rule #{input_file_sam} #{input_file_passwords}
```

**Dependencies:**

- Hashcat must exist on disk at specified location (#{hashcat_exe})

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Password Cracking by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1110.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies

Refer to NIST guidelines when creating password policies.

### M1032 Multi-factor Authentication

Use multi-factor authentication. Where possible, also enable multi-factor authentication on externally facing services.

## Detection

### Post-Credential Dump Password Cracking Detection via Suspicious File Access and Hash Analysis Tools

## Risk Assessment

| Finding                                | Severity | Impact            |
| -------------------------------------- | -------- | ----------------- |
| Password Cracking technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [US-CERT-TA18-106A](https://www.us-cert.gov/ncas/alerts/TA18-106A)
- [Wikipedia Password cracking](https://en.wikipedia.org/wiki/Password_cracking)
- [Atomic Red Team - T1110.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1110.002)
- [MITRE ATT&CK - T1110.002](https://attack.mitre.org/techniques/T1110/002)
