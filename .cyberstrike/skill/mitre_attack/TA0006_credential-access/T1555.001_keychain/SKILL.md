---
name: "T1555.001_keychain"
description: "Adversaries may acquire credentials from Keychain."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1555.001
  - credential-access
  - macos
  - sub-technique
technique_id: "T1555.001"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1555/001"
tech_stack:
  - macos
cwe_ids:
  - CWE-522
chains_with:
  - T1555
  - T1555.002
  - T1555.003
  - T1555.004
  - T1555.005
  - T1555.006
prerequisites:
  - T1555
severity_boost:
  T1555: "Chain with T1555 for deeper attack path"
  T1555.002: "Chain with T1555.002 for deeper attack path"
  T1555.003: "Chain with T1555.003 for deeper attack path"
---

# T1555.001 Keychain

> **Sub-technique of:** T1555

## High-Level Description

Adversaries may acquire credentials from Keychain. Keychain (or Keychain Services) is the macOS credential management system that stores account names, passwords, private keys, certificates, sensitive application data, payment data, and secure notes. There are three types of Keychains: Login Keychain, System Keychain, and Local Items (iCloud) Keychain. The default Keychain is the Login Keychain, which stores user passwords and information. The System Keychain stores items accessed by the operating system, such as items shared among users on a host. The Local Items (iCloud) Keychain is used for items synced with Apple’s iCloud service. 

Keychains can be viewed and edited through the Keychain Access application or using the command-line utility <code>security</code>. Keychain files are located in <code>~/Library/Keychains/</code>, <code>/Library/Keychains/</code>, and <code>/Network/Library/Keychains/</code>.

Adversaries may gather user credentials from Keychain storage/memory. For example, the command <code>security dump-keychain –d</code> will dump all Login Keychain credentials from <code>~/Library/Keychains/login.keychain-db</code>. Adversaries may also directly read Login Keychain credentials from the <code>~/Library/Keychains/login.keychain</code> file. Both methods require a password, where the default password for the Login Keychain is the current user’s password to login to the macOS host.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** macOS

## What to Check

- [ ] Identify if Keychain technique is applicable to target environment
- [ ] Check macOS systems for indicators of Keychain
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Keychain Dump

This command will dump keychain credential information from login.keychain. 
Source: https://www.loobins.io/binaries/security/

### Keychain File path
  ~/Library/Keychains/
  /Library/Keychains/
  /Network/Library/Keychains/
  [Security Reference](https://developer.apple.com/legacy/library/documentation/Darwin/Reference/ManPages/man1/security.1.html)

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo security dump-keychain -d login.keychain
```

### Atomic Test 2: Export Certificate Item(s)

This command finds all certificate items and sends the output to local file in pem format.

**Supported Platforms:** macos

```bash
security find-certificate -a -p > #{cert_export}
```

### Atomic Test 3: Import Certificate Item(s) into Keychain

This command will import a certificate pem file into a keychain.

**Supported Platforms:** macos

```bash
security import #{cert_export} -k
```

### Atomic Test 4: Copy Keychain using cat utility

This command will copy the keychain using the cat utility in a manner similar to Atomic Stealer.

**Supported Platforms:** macos

```bash
cat ~/Library/Keychains/login.keychain-db > #{keychain_export}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Keychain by examining the target platforms (macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1555.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies
The password for the user's login keychain can be changed from the user's login password. This increases the complexity for an adversary because they need to know an additional password.


## Detection

### Detect Access to macOS Keychain for Credential Theft


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Keychain technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [External to DA, the OS X Way](https://www.slideshare.net/slideshow/external-to-da-the-os-x-way/62021418)
- [Keychain Services Apple](https://developer.apple.com/documentation/security/keychain_services)
- [Empire Keychain Decrypt](https://github.com/EmpireProject/Empire/blob/08cbd274bef78243d7a8ed6443b8364acd1fc48b/lib/modules/python/collection/osx/keychaindump_decrypt.py)
- [OSX Keychain Schaumann](https://www.netmeister.org/blog/keychain-passwords.html)
- [Keychain Decryption Passware](https://support.passware.com/hc/en-us/articles/4573379868567-A-Deep-Dive-into-Apple-Keychain-Decryption)
- [Atomic Red Team - T1555.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1555.001)
- [MITRE ATT&CK - T1555.001](https://attack.mitre.org/techniques/T1555/001)
