---
name: cis-ubuntu2004-v300-5-3-3-3-3
description: "Ensure pam_pwhistory includes use_authtok"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.3.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.3.3 Ensure pam_pwhistory includes use_authtok (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`use_authtok` - When password changing enforce the module to set the new password to the one provided by a previously stacked password module.

## Rationale

`use_authtok` allows multiple pam modules to confirm a new password before it is accepted.

## Audit Procedure

### Command Line

Run the following command to verify that the `use_authtok` argument exists on the `pwhistory` line in `/etc/pam.d/common-password`:

```bash
# grep -Psi -- '^\h*password\h+[^#\n\r]+\h+pam_pwhistory\.so\h+([^#\n\r]+\h+)?use_authtok\b' /etc/pam.d/common-password
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

Edit any returned files and add the `use_authtok` argument to the `pam_pwhistory` line in the `Password` section:

Example File:

```
Name: pwhistory password history checking
Default: yes
Priority: 1024
Password-Type: Primary
Password:
   requisite   pam_pwhistory.so remember=24 enforce_for_root use_authtok # <- **ensure line includes use_authtok**
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

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.11 Encrypt Sensitive Data at Rest                 |      | \*   | \*   |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1003, T1003.008, T1110, T1110.002 | TA0006  | M1041       |
