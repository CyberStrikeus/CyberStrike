---
name: "CIS Ubuntu 14.04 LTS - 5.3.4 Ensure password hashing algorithm is SHA-512"
description: "Verify PAM is configured to use SHA-512 hashing algorithm for password storage"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - pam
cis_id: "5.3.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 5.3.4 Ensure password hashing algorithm is SHA-512 (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The commands below change password encryption from `md5` to `sha512` (a much stronger hashing algorithm). All existing accounts will need to perform a password change to upgrade the stored hashes to the new algorithm.

## Rationale

The SHA-512 algorithm provides much stronger hashing than MD5, thus providing additional protection to the system by increasing the level of effort for an attacker to successfully determine passwords.

Note that these change only apply to accounts configured on the local system.

## Audit Procedure

Run the following commands and ensure the `sha512` option is included in all results:

```bash
egrep '^password\s+\S+\s+pam_unix.so' /etc/pam.d/common-password
```

## Expected Result

```
password sufficient pam_unix.so sha512
```

## Remediation

Edit the `/etc/pam.d/common-password` file to include the `sha512` option for `pam_unix.so` as shown:

```
password [success=1 default=ignore] pam_unix.so sha512
```

**Note:** If it is determined that the password algorithm being used is not SHA-512, once it is changed, it is recommended that all user ID's be immediately expired and forced to change their passwords on next login. To accomplish that, the following commands can be used:

```bash
cat /etc/passwd | awk -F: '( $3 >= 1000 && $1 != "nfsnobody" ) { print $1 }' | xargs -n 1 chage -d 0
```

## Default Value

sha512

## References

- CIS Controls: 16.14 - Encrypt/Hash All Authentication Files And Monitor Their Access

## Profile

- Level 1 - Server
- Level 1 - Workstation
