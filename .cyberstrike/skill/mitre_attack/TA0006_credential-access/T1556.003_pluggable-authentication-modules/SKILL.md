---
name: "T1556.003_pluggable-authentication-modules"
description: "Adversaries may modify pluggable authentication modules (PAM) to access user credentials or enable otherwise unwarranted access to accounts."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1556.003
  - credential-access
  - defense-evasion
  - persistence
  - linux
  - macos
  - sub-technique
technique_id: "T1556.003"
tactic: "credential-access"
all_tactics:
  - credential-access
  - defense-evasion
  - persistence
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1556/003"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-522
chains_with:
  - T1556
  - T1556.001
  - T1556.002
  - T1556.004
  - T1556.005
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

# T1556.003 Pluggable Authentication Modules

> **Sub-technique of:** T1556

## High-Level Description

Adversaries may modify pluggable authentication modules (PAM) to access user credentials or enable otherwise unwarranted access to accounts. PAM is a modular system of configuration files, libraries, and executable files which guide authentication for many services. The most common authentication module is <code>pam_unix.so</code>, which retrieves, sets, and verifies account authentication information in <code>/etc/passwd</code> and <code>/etc/shadow</code>.

Adversaries may modify components of the PAM system to create backdoors. PAM components, such as <code>pam_unix.so</code>, can be patched to accept arbitrary adversary supplied values as legitimate credentials.

Malicious modifications to the PAM system may also be abused to steal credentials. Adversaries may infect PAM resources with code to harvest user credentials, since the values exchanged with PAM components may be plain-text since PAM does not store passwords.

## Kill Chain Phase

- Credential Access (TA0006)
- Defense Evasion (TA0005)
- Persistence (TA0003)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Pluggable Authentication Modules technique is applicable to target environment
- [ ] Check Linux systems for indicators of Pluggable Authentication Modules
- [ ] Check macOS systems for indicators of Pluggable Authentication Modules
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Malicious PAM rule

Inserts a rule into a PAM config and then tests it.

Upon successful execution, this test will insert a rule that allows every user to su to root without a password.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo sed -i "#{index}s,^,#{pam_rule}\n,g" #{path_to_pam_conf}
```

### Atomic Test 2: Malicious PAM rule (freebsd)

Inserts a rule into a PAM config and then tests it.

Upon successful execution, this test will insert a rule that allows every user to su to root without a password.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo sed -i "" "#{index}s,^,#{pam_rule}\n,g" #{path_to_pam_conf}
```

### Atomic Test 3: Malicious PAM module

Creates a PAM module, inserts a rule to use it, and then tests it.

Upon successful execution, this test will create a PAM module that allows every user to su to root without a password.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo sed -i "#{index}s,^,#{pam_rule}\n,g" #{path_to_pam_conf}
```

**Dependencies:**
- The PAM development library must be installed to build the PAM module
- The PAM module must exist on disk at specified location (#{path_to_pam_module})


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Pluggable Authentication Modules by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1556.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1032 Multi-factor Authentication
Integrating multi-factor authentication (MFA) as part of organizational policy can greatly reduce the risk of an adversary gaining control of valid credentials that may be used for additional tactics such as initial access, lateral movement, and collecting information.

### M1026 Privileged Account Management
Limit access to the root account and prevent users from modifying PAM components through proper privilege separation (ex SELinux, grsecurity, AppArmor, etc.) and limiting Privilege Escalation opportunities.


## Detection

### Detect Malicious Modification of Pluggable Authentication Modules (PAM)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Pluggable Authentication Modules technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Apple PAM](https://opensource.apple.com/source/dovecot/dovecot-239/dovecot/doc/wiki/PasswordDatabase.PAM.txt)
- [Man Pam_Unix](https://linux.die.net/man/8/pam_unix)
- [PAM Creds](https://web.archive.org/web/20240303094335/https://x-c3ll.github.io/posts/PAM-backdoor-DNS/)
- [Red Hat PAM](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/6/html/managing_smart_cards/pluggable_authentication_modules)
- [PAM Backdoor](https://github.com/zephrax/linux-pam-backdoor)
- [Atomic Red Team - T1556.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1556.003)
- [MITRE ATT&CK - T1556.003](https://attack.mitre.org/techniques/T1556/003)
