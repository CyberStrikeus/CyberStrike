---
name: cis-ubuntu2004-v300-5-3-3-4-2
description: "Ensure pam_unix does not include remember"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.4.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.4.2 Ensure pam_unix does not include remember (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `remember=n` argument saves the last n passwords for each user in `/etc/security/opasswd` in order to force password change history and keep the user from alternating between the same password too frequently. The MD5 password hash algorithm is used for storing the old passwords. Instead of this option the `pam_pwhistory` module should be used. The `pam_pwhistory` module saves the last n passwords for each user in `/etc/security/opasswd` using the password hash algorithm set on the `pam_unix` module. This allows for the `yescrypt` or `sha512` hash algorithm to be used.

## Rationale

The `remember=n` argument should be removed to ensure a strong password hashing algorithm is being used. A stronger hash provides additional protection to the system by increasing the level of effort needed for an attacker to successfully determine local user's old passwords stored in `/etc/security/opasswd`.

## Audit Procedure

### Command Line

Run the following command to verify that the `remember` argument is not set on the `pam_unix.so` module:

```bash
# grep -PHs -- '^\h*^\h*[^#\n\r]+\h+pam_unix\.so\h+([^#\n\r]+\h+)?remember=\d+\b' /etc/pam.d/common-{password,auth,account,session,session-noninteractive}
```

## Expected Result

Nothing should be returned.

## Remediation

### Command Line

Run the following command:

```bash
# grep -PH -- '^\h*([^#\n\r]+\h+)?pam_unix\.so\h+([^#\n\r]+\h+)?remember\b' /usr/share/pam-configs/*
```

Edit any files returned and remove the `remember=_<N>_` argument for the `pam_unix` lines.

Example output:

```
[success=end default=ignore]    pam_unix.so obscure use_authtok try_first_pass yescrypt remember=5 # **<- remove remember=<N>**
[success=end default=ignore]    pam_unix.so obscure yescrypt remember=5 # **<- remove remember=<N>**
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
