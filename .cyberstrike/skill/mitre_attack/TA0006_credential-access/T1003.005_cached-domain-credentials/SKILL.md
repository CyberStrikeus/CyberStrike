---
name: "T1003.005_cached-domain-credentials"
description: "Adversaries may attempt to access cached domain credentials used to allow authentication to occur in the event a domain controller is unavailable."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003.005
  - credential-access
  - windows
  - linux
  - sub-technique
technique_id: "T1003.005"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1003/005"
tech_stack:
  - windows
  - linux
cwe_ids:
  - CWE-522
chains_with:
  - T1003
  - T1003.001
  - T1003.002
  - T1003.003
  - T1003.004
  - T1003.006
  - T1003.007
  - T1003.008
prerequisites:
  - T1003
severity_boost:
  T1003: "Chain with T1003 for deeper attack path"
  T1003.001: "Chain with T1003.001 for deeper attack path"
  T1003.002: "Chain with T1003.002 for deeper attack path"
---

# T1003.005 Cached Domain Credentials

> **Sub-technique of:** T1003

## High-Level Description

Adversaries may attempt to access cached domain credentials used to allow authentication to occur in the event a domain controller is unavailable.

On Windows Vista and newer, the hash format is DCC2 (Domain Cached Credentials version 2) hash, also known as MS-Cache v2 hash. The number of default cached credentials varies and can be altered per system. This hash does not allow pass-the-hash style attacks, and instead requires Password Cracking to recover the plaintext password.

On Linux systems, Active Directory credentials can be accessed through caches maintained by software like System Security Services Daemon (SSSD) or Quest Authentication Services (formerly VAS). Cached credential hashes are typically located at `/var/lib/sss/db/cache.[domain].ldb` for SSSD or `/var/opt/quest/vas/authcache/vas_auth.vdb` for Quest. Adversaries can use utilities, such as `tdbdump`, on these database files to dump the cached hashes and use Password Cracking to obtain the plaintext password.

With SYSTEM or sudo access, the tools/utilities such as Mimikatz, Reg, and secretsdump.py for Windows or Linikatz for Linux can be used to extract the cached credentials.

Note: Cached credentials for Windows Vista are derived using PBKDF2.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows, Linux

## What to Check

- [ ] Identify if Cached Domain Credentials technique is applicable to target environment
- [ ] Check Windows systems for indicators of Cached Domain Credentials
- [ ] Check Linux systems for indicators of Cached Domain Credentials
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Cached Credential Dump via Cmdkey

List credentials currently stored on the host via the built-in Windows utility cmdkey.exe
Credentials listed with Cmdkey only pertain to the current user
Passwords will not be displayed once they are stored
https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/cmdkey
https://www.peew.pw/blog/2017/11/26/exploring-cmdkey-an-edge-case-for-privilege-escalation

**Supported Platforms:** windows

```cmd
cmdkey /list
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Cached Domain Credentials by examining the target platforms (Windows, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1003.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1015 Active Directory Configuration

Consider adding users to the "Protected Users" Active Directory security group. This can help limit the caching of users' plaintext credentials.

### M1017 User Training

Limit credential overlap across accounts and systems by training users and administrators not to use the same password for multiple accounts.

### M1027 Password Policies

Ensure that local administrator accounts have complex, unique passwords across all systems on the network.

### M1028 Operating System Configuration

Consider limiting the number of cached credentials (HKLM\SOFTWARE\Microsoft\Windows NT\Current Version\Winlogon\cachedlogonscountvalue)

### M1026 Privileged Account Management

Do not put user or admin domain accounts in the local administrator groups across systems unless they are tightly controlled, as this is often equivalent to having a local administrator account with the same password on all systems. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

## Detection

### Detection of Cached Domain Credential Dumping via Local Hash Cache Access

## Risk Assessment

| Finding                                        | Severity | Impact            |
| ---------------------------------------------- | -------- | ----------------- |
| Cached Domain Credentials technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [PassLib mscache](https://passlib.readthedocs.io/en/stable/lib/passlib.hash.msdcc2.html)
- [ired mscache](https://ired.team/offensive-security/credential-access-and-credential-dumping/dumping-and-cracking-mscash-cached-domain-credentials)
- [Microsoft - Cached Creds](<https://docs.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/hh994565(v%3Dws.11)>)
- [Powersploit](https://github.com/mattifestation/PowerSploit)
- [Brining MimiKatz to Unix](https://labs.portcullis.co.uk/download/eu-18-Wadhwa-Brown-Where-2-worlds-collide-Bringing-Mimikatz-et-al-to-UNIX.pdf)
- [Atomic Red Team - T1003.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003.005)
- [MITRE ATT&CK - T1003.005](https://attack.mitre.org/techniques/T1003/005)
