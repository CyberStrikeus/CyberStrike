---
name: cis-ubuntu2004-v300-5-3-3-4-4
description: "Ensure pam_unix includes use_authtok"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.4.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.4.4 Ensure pam_unix includes use_authtok (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`use_authtok` - When password changing enforce the module to set the new password to the one provided by a previously stacked password module.

## Rationale

`use_authtok` allows multiple pam modules to confirm a new password before it is accepted.

## Audit Procedure

### Command Line

Run the following command to verify that `use_authtok` is set on the pam_unix.so module lines in the password stack:

```bash
# grep -PH -- '^\h*password\h+([^#\n\r]+)\h+pam_unix\.so\h+([^#\n\r]+\h+)?use_authtok\b' /etc/pam.d/common-password
```

## Expected Result

Output should be similar to:

```
/etc/pam.d/common-password:password   [success=1 default=ignore]   pam_unix.so obscure use_authtok try_first_pass yescrypt
```

Verify that the line(s) include `use_authtok`.

## Remediation

### Command Line

Run the following command:

```bash
# awk '/Password-Type:/{ f = 1;next } /-Type:/{ f = 0 } f {if (/pam_unix\.so/) print FILENAME}' /usr/share/pam-configs/*
```

Edit any returned files add `use_authtok` to the `pam_unix` line in the `Password` section under `Password:` subsection.

Note: The if the file's `Password` section includes a `Password-Initial:` subsection, `use_authtok` should not be added to the `pam_unix` line in the `Password-Initial:` subsection.

Example File:

```
Name: Unix authentication
Default: yes
Priority: 256
Auth-Type: Primary # <- Start of "Auth" section
Auth:
        [success=end default=ignore]    pam_unix.so try_first_pass
Auth-Initial:
        [success=end default=ignore]    pam_unix.so
Account-Type: Primary # <- Start of "Account" section
Account:
        [success=end new_authtok_reqd=done default=ignore]    pam_unix.so
Account-Initial:
        [success=end new_authtok_reqd=done default=ignore]    pam_unix.so
Session-Type: Additional  # <- Start of "Session" section
Session:
        required        pam_unix.so
Session-Initial:
        required        pam_unix.so
Password-Type: Primary # <- Start of "Password" section
Password:
        [success=end default=ignore]    pam_unix.so obscure use_authtok try_first_pass yescrypt # <- **ensure line includes use_authtok**
Password-Initial:
        [success=end default=ignore]    pam_unix.so obscure yescrypt # <- **Password-Initial: subsection does not include use_authtok
```

Run the following command to update the files in the `/etc/pam.d/` directory:

```bash
# pam-auth-update --enable <MODIFIED_PROFILE_NAME>
```

Example:

```bash
# pam-auth-update --enable unix
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
