---
name: cis-ubuntu2004-v300-5-3-2-2
description: "Ensure pam_faillock module is enabled"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.2.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.2.2 Ensure pam_faillock module is enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pam_faillock.so` module maintains a list of failed authentication attempts per user during a specified interval and locks the account in case there were more than the configured number of consecutive failed authentications (this is defined by the `deny` parameter in the faillock configuration). It stores the failure records into per-user files in the tally directory.

## Rationale

Locking out user IDs after n unsuccessful consecutive login attempts mitigates brute force password attacks against your systems.

## Audit Procedure

### Command Line

Run the following commands to verify that `pam_faillock` is enabled:

```bash
# grep -P -- '\bpam_faillock\.so\b' /etc/pam.d/common-{auth,account}
```

## Expected Result

Output should be similar to:

```
/etc/pam.d/common-auth:auth   requisite   pam_faillock.so preauth
/etc/pam.d/common-auth:auth   [default=die]   pam_faillock.so authfail
/etc/pam.d/common-account:account   required   pam_faillock.so
```

## Remediation

### Command Line

Create two pam-auth-update profiles in `/usr/share/pam-configs/`:

1. Create the `faillock` profile in `/usr/share/pam-configs/` with the following lines:

```
Name: Enable pam_faillock to deny access
Default: yes
Priority: 0
Auth-Type: Primary
Auth:
        [default=die]           pam_faillock.so authfail
```

Example Script:

```bash
#!/usr/bin/env bash

{
  arr=('Name: Enable pam_faillock to deny access' 'Default: yes' 'Priority: 0' 'Auth-Type: Primary' 'Auth:' '        [default=die]           pam_faillock.so authfail')
  printf '%s\n' "${arr[@]}" > /usr/share/pam-configs/faillock
}
```

2. Create the `faillock_notify` profile in `/usr/share/pam-configs/` with the following lines:

```
Name: Notify of failed login attempts and reset count upon success
Default: yes
Priority: 1024
Auth-Type: Primary
Auth:
        requisite           pam_faillock.so preauth
Account-Type: Primary
Account:
        required           pam_faillock.so
```

Example Script:

```bash
#!/usr/bin/env bash

{
  arr=('Name: Notify of failed login attempts and reset count upon success' 'Default: yes' 'Priority: 1024' 'Auth-Type: Primary' 'Auth:' '        requisite                       pam_faillock.so preauth' 'Account-Type: Primary' 'Account:' '        required                       pam_faillock.so')
  printf '%s\n' "${arr[@]}" > /usr/share/pam-configs/faillock_notify
}
```

Run the following command to update the `common-auth` and `common-account` PAM files with the new profiles:

```bash
# pam-auth-update --enable <profile_filename>
```

Example:

```bash
# pam-auth-update --enable faillock
# pam-auth-update --enable faillock_notify
```

Note:

- The name used for the file must be used in the `pam-auth-update --enable` command
- The `Name:` line should be easily recognizable and understood
- The `Priority:` Line is important as it effects the order of the lines in the `/etc/pam.d/` files
- If a site specific custom profile is being used in your environment to configure PAM that includes the configuration for the `pam_faillock` module, enable that module instead

## References

None listed.

## CIS Controls

| Controls Version | Control                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------ | ---- | ---- | ---- |
| v8               | 6.2 Establish an Access Revoking Process   | \*   | \*   | \*   |
| v7               | 16.7 Establish Process for Revoking Access |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1110, T1110.001, T1110.003 | TA0006  | M1027       |
