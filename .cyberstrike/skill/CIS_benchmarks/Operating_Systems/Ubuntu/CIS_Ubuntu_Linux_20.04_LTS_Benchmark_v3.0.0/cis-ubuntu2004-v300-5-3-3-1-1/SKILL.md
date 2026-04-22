---
name: cis-ubuntu2004-v300-5-3-3-1-1
description: "Ensure password failed attempts lockout is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.1.1 Ensure password failed attempts lockout is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `deny=<n>` option will deny access if the number of consecutive authentication failures for this user during the recent interval exceeds.

## Rationale

Locking out user IDs after n unsuccessful consecutive login attempts mitigates brute force password attacks against your systems.

## Audit Procedure

### Command Line

Run the following command to verify that Number of failed logon attempts before the account is locked is no greater than `5` and meets local site policy:

```bash
# grep -Pi -- '^\h*deny\h*=\h*[1-5]\b' /etc/security/faillock.conf
```

Expected output:

```
deny = 5
```

Run the following command to verify that the `deny` argument has not been set, or `5` or less and meets local site policy:

```bash
# grep -Pi -- '^\h*auth\h+(requisite|required|sufficient)\h+pam_faillock\.so\h+([^#\n\r]+\h+)?deny\h*=\h*(0|[6-9]|[1-9][0-9]+)\b' /etc/pam.d/common-auth
```

## Expected Result

Nothing should be returned from the second command.

## Remediation

### Command Line

Create or edit the following line in `/etc/security/faillock.conf` setting the `deny` option to `5` or less:

```
deny = 5
```

Run the following command:

```bash
# grep -Pl -- '\bpam_faillock\.so\h+([^#\n\r]+\h+)?deny\b' /usr/share/pam-configs/*
```

Edit any returned files and remove the `deny=<N>` arguments from the `pam_faillock.so` line(s).

## Default Value

deny = 3

## Additional Information

If a user has been locked out because they have reached the maximum consecutive failure count defined by `deny=` in the `pam_faillock.so` module, the user can be unlocked by issuing the command `faillock --user <USERNAME> --reset`. This command sets the failed count to 0, effectively unlocking the user.

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
