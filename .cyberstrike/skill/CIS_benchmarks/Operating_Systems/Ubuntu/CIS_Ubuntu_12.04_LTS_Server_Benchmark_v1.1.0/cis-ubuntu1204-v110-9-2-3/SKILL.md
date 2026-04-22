---
name: cis-ubuntu1204-v110-9-2-3
description: "Limit Password Reuse"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, pam, password-policy]
cis_id: "9.2.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.2.3 Limit Password Reuse (Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/security/opasswd` file stores the users' old passwords and can be checked to ensure that users are not recycling recent passwords.

## Rationale

Forcing users not to reuse their past 5 passwords make it less likely that an attacker will be able to guess the password.

Note that these change only apply to accounts configured on the local system.

## Audit Procedure

### Using Command Line

Perform the following to determine the current setting for reuse of older passwords:

```bash
grep "remember" /etc/pam.d/common-password
```

## Expected Result

```
password [success=1 default=ignore] pam_unix.so obscure sha512 remember=5
```

## Remediation

### Using Command Line

Set the `pam_unix.so remember` parameter to 5 in `/etc/pam.d/common-password`:

```bash
password sufficient pam_unix.so remember=5
```

**Note:** The default password setting in this document is the last 5 passwords. Change this number to conform to your site's password policy.

## Default Value

No password reuse limitation is configured by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
