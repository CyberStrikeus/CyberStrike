---
name: cis-ubuntu2004-v300-5-3-3-3-2
description: "Ensure password history is enforced for the root user"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.3.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.3.2 Ensure password history is enforced for the root user (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

If the `pwhistory enforce_for_root` option is enabled, the module will enforce password history for the root user as well.

## Rationale

Requiring users not to reuse their passwords make it less likely that an attacker will be able to guess the password or use a compromised password.

Note: These change only apply to accounts configured on the local system.

## Audit Procedure

### Command Line

Run the following command to verify that the `enforce_for_root` argument is exists on the `pwhistory` line in `/etc/pam.d/common-password`:

```bash
# grep -Psi -- '^\h*password\h+[^#\n\r]+\h+pam_pwhistory\.so\h+([^#\n\r]+\h+)?enforce_for_root\b' /etc/pam.d/common-password
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

Edit any returned files and add the `enforce_for_root` argument to the `pam_pwhistory` line in the `Password` section:

Example File:

```
Name: pwhistory password history checking
Default: yes
Priority: 1024
Password-Type: Primary
Password:
   requisite   pam_pwhistory.so remember=24 enforce_for_root use_authtok # <- **ensure line includes enforce_for_root**
```

Run the following command to update the files in the `/etc/pam.d/` directory:

```bash
# pam-auth-update --enable <MODIFIED_PROFILE_NAME>
```

Example:

```bash
# pam-auth-update --enable pwhistory
```

## Default Value

disabled

## References

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | * | * | * |
| v7 | 4.4 Use Unique Passwords | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1110, T1110.001, T1110.002, T1110.003, T1178.001, T1178.002, T1178.003, T1178.004 | TA0006 | M1027 |
