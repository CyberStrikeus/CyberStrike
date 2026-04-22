---
name: "T1556.005_reversible-encryption"
description: "An adversary may abuse Active Directory authentication encryption properties to gain access to credentials on Windows systems."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.005
  - credential-access
  - defense-evasion
  - persistence
  - windows
  - sub-technique
technique_id: "T1556.005"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1556/005"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1556
  - T1556.001
  - T1556.002
  - T1556.003
  - T1556.004
  - T1556.006
  - T1556.007
  - T1556.008
  - T1556.009
prerequisites:
  - T1556
severity_boost:
  T1556: "Chain with T1556 for deeper attack path"
  T1556.001: "Chain with T1556.001 for deeper attack path"
  T1556.002: "Chain with T1556.002 for deeper attack path"
---

# T1556.005 Reversible Encryption

> **Sub-technique of:** T1556

## High-Level Description

An adversary may abuse Active Directory authentication encryption properties to gain access to credentials on Windows systems. The <code>AllowReversiblePasswordEncryption</code> property specifies whether reversible password encryption for an account is enabled or disabled. By default this property is disabled (instead storing user credentials as the output of one-way hashing functions) and should not be enabled unless legacy or other software require it.

If the property is enabled and/or a user changes their password after it is enabled, an adversary may be able to obtain the plaintext of passwords created/changed after the property was enabled. To decrypt the passwords, an adversary needs four components:

1. Encrypted password (<code>G$RADIUSCHAP</code>) from the Active Directory user-structure <code>userParameters</code>
2. 16 byte randomly-generated value (<code>G$RADIUSCHAPKEY</code>) also from <code>userParameters</code>
3. Global LSA secret (<code>G$MSRADIUSCHAPKEY</code>)
4. Static key hardcoded in the Remote Access Subauthentication DLL (<code>RASSFM.DLL</code>)

With this information, an adversary may be able to reproduce the encryption key and subsequently decrypt the encrypted password value.

An adversary may set this property at various scopes through Local Group Policy Editor, user properties, Fine-Grained Password Policy (FGPP), or via the ActiveDirectory PowerShell module. For example, an adversary may implement and apply a FGPP to users or groups if the Domain Functional Level is set to "Windows Server 2008" or higher. In PowerShell, an adversary may make associated changes to user settings using commands similar to <code>Set-ADUser -AllowReversiblePasswordEncryption $true</code>.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Windows

## What to Check

- [ ] Identify if Reversible Encryption technique is applicable to target environment
- [ ] Check Windows systems for indicators of Reversible Encryption
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Reversible Encryption by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1026 Privileged Account Management

Audit domain and local accounts as well as their permission levels routinely to look for situations that could allow an adversary to gain wide access by obtaining credentials of a privileged account. These audits should also include if default accounts have been enabled, or if new local accounts are created that have not be authorized. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

### M1027 Password Policies

Ensure that <code>AllowReversiblePasswordEncryption</code> property is set to disabled unless there are application requirements.

## Detection

### Detect Modification of Authentication Process via Reversible Encryption

## Risk Assessment

| Finding                                    | Severity | Impact            |
| ------------------------------------------ | -------- | ----------------- |
| Reversible Encryption technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [dump_pwd_dcsync](https://adsecurity.org/?p=2053)
- [store_pwd_rev_enc](https://docs.microsoft.com/en-us/windows/security/threat-protection/security-policy-settings/store-passwords-using-reversible-encryption)
- [how_pwd_rev_enc_1](http://blog.teusink.net/2009/08/passwords-stored-using-reversible.html)
- [how_pwd_rev_enc_2](http://blog.teusink.net/2009/08/passwords-stored-using-reversible_26.html)
- [Atomic Red Team - T1556.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.005)
- [MITRE ATT&CK - T1556.005](https://attack.mitre.org/techniques/T1556/005)
