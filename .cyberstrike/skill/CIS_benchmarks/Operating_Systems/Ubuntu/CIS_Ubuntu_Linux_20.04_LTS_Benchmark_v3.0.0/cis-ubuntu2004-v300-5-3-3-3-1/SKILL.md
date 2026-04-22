---
name: cis-ubuntu2004-v300-5-3-3-3-1
description: "Ensure password history remember is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.3.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.3.1 Ensure password history remember is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/security/opasswd` file stores the users' old passwords and can be checked to ensure that users are not recycling recent passwords. The number of passwords remembered is set via the remember argument value in set for the `pam_pwhistory` module.

- remember=<N> - <N> is the number of old passwords to remember

## Rationale

Requiring users not to reuse their passwords make it less likely that an attacker will be able to guess the password or use a compromised password.

Note: These change only apply to accounts configured on the local system.

## Audit Procedure

### Command Line

Run the following command and verify:

- The `pwhistory` line in `/etc/pam.d/common-password` includes `remember=<N>`
- The value of <N> is `24` or more
- The value meets local site policy

```bash
# grep -Psi -- '^\h*password\h+[^#\n\r]+\h+pam_pwhistory\.so\h+([^#\n\r]+\h+)?remember=\d+\h' /etc/pam.d/common-password
```

## Expected Result

Output should be similar to:

```
password   requisite   pam_pwhistory.so remember=24 enforce_for_root use_authtok
```

## Remediation

### Command Line

Run the following command:

```bash
# awk '/Password-Type:/{ f = 1;next } /-Type:/{ f = 0 } f {if (/pam_pwhistory\.so/) print FILENAME}' /usr/share/pam-configs/*
```

Edit any returned files and edit or add the `remember=` argument, with a value of `24` or more, that meets local site policy to the `pam_pwhistory` line in the `Password` section:

Example File:

```
Name: pwhistory password history checking
Default: yes
Priority: 1024
Password-Type: Primary
Password:
   requisite   pam_pwhistory.so remember=24 enforce_for_root use_authtok # <- **ensure line includes remember=<N>**
```

Run the following command to update the files in the `/etc/pam.d/` directory:

```bash
# pam-auth-update --enable <MODIFIED_PROFILE_NAME>
```

Example:

```bash
# pam-auth-update --enable pwhistory
```

## References

1. NIST SP 800-53 Rev. 5: IA-5(1)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | * | * | * |
| v7 | 4.4 Use Unique Passwords | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078, T1078.001, T1078.002, T1078.003, T1078.004, T1110, T1110.004 | | |
