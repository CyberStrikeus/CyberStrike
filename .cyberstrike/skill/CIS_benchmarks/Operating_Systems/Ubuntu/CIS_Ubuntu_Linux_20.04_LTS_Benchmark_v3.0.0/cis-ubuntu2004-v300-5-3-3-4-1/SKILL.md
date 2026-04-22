---
name: cis-ubuntu2004-v300-5-3-3-4-1
description: "Ensure pam_unix does not include nullok"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.4.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.4.1 Ensure pam_unix does not include nullok (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `nullok` argument overrides the default action of `pam_unix.so` to not permit the user access to a service if their official password is blank.

## Rationale

Using a strong password is essential to helping protect personal and sensitive information from unauthorized access.

## Audit Procedure

### Command Line

Run the following command to verify that the nullok argument is not set on the pam_unix.so module:

```bash
# grep -PHs -- '^\h*[^#\n\r]+\h+pam_unix\.so\h+([^#\n\r]+\h+)?nullok\b' /etc/pam.d/common-{password,auth,account,session,session-noninteractive}
```

## Expected Result

Nothing should be returned.

## Remediation

### Command Line

Run the following command:

```bash
# grep -PH -- '^\h*([^#\n\r]+\h+)?pam_unix\.so\h+([^#\n\r]+\h+)?nullok\b' /usr/share/pam-configs/*
```

Edit any files returned and remove the `nullok` argument for the `pam_unix` lines.

Example File:

```
Name: Unix authentication
Default: yes
Priority: 256
Auth-Type: Primary
Auth:
        [success=end default=ignore]    pam_unix.so try_first_pass # <- **ensure line does not include nullok nullok**
Auth-Initial:
        [success=end default=ignore]    pam_unix.so # <- **ensure line does not include nullok nullok**
Account-Type: Primary
Account:
        [success=end new_authtok_reqd=done default=ignore]    pam_unix.so
Account-Initial:
        [success=end new_authtok_reqd=done default=ignore]    pam_unix.so
Session-Type: Additional
Session:
        required        pam_unix.so
Session-Initial:
        required        pam_unix.so
Password-Type: Primary
Password:
        [success=end default=ignore]    pam_unix.so obscure use_authtok try_first_pass yescrypt
Password-Initial:
        [success=end default=ignore]    pam_unix.so obscure yescrypt
```

Run the following command to update the files in the `/etc/pam.d/` directory:

```bash
# pam-auth-update --enable <EDITED_PROFILE_NAME>
```

Example:

```bash
# pam-auth-update --enable unix
```

Note: If custom files are being used, the corresponding files in `/etc/pam.d/` would need to be edited directly, and the `pam-auth-update --enable <EDITED_PROFILE_NAME>` command skipped.

## References

None listed.

## CIS Controls

| Controls Version | Control                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------ | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords | \*   | \*   | \*   |
| v7               | 4.4 Use Unique Passwords |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1003, T1003.008, T1110, T1110.002 | TA0006  | M1041       |
