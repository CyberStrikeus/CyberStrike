---
name: cis-gcp-cos-5.2.3
description: "Ensure password hashing algorithm is SHA-512"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, pam, password-policy, hashing]
cis_id: "5.2.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.3 Ensure password hashing algorithm is SHA-512 (Manual)

## Description

The commands below change password encryption from `md5` to `sha512` (a much stronger hashing algorithm). All existing accounts will need to perform a password change to upgrade the stored hashes to the new algorithm.

## Rationale

The SHA-512 algorithm provides much stronger hashing than MD5, thus providing additional protection to the system by increasing the level of effort for an attacker to successfully determine passwords.

Note that these changes only apply to accounts configured on the local system.

## Audit Procedure

Verify password hashing algorithm is sha512. This setting is commonly configured with the `pam_unix.so sha512` option found in `/etc/pam.d/common-password` or `/etc/pam.d/system-auth` and `/etc/pam.d/password-auth`. Example:

```bash
password required pam_unix.so sha512
```

## Expected Result

The `pam_unix.so` module should include the `sha512` option in the PAM password configuration.

## Remediation

Set password hashing algorithm to sha512. Many distributions provide tools for updating PAM configuration, consult your documentation for details. If no tooling is provided edit the appropriate `/etc/pam.d/` configuration file and add or modify the `pam_unix.so` lines to include the sha512 option:

```
password required pam_unix.so sha512
```

Additional Information:

Consult your documentation for the appropriate PAM file and module.

Additional module options may be set, recommendation only covers those listed here.

If it is determined that the password algorithm being used is not SHA-512, once it is changed, it is recommended that all user ID's be immediately expired and forced to change their passwords on next login. To accomplish that, the following commands can be used. Any system accounts that need to be expired should be carefully done separately by the system administrator to prevent any potential problems.

```bash
# cat /etc/passwd | awk -F: '( $3 >= 500 && $1 != "nfsnobody" ) { print $1 }' | xargs -n 1 chage -d 0
```

This command assumes a system UID split at 500. Some distributions split at `UID 1000` instead, consult your documentation and/or the `UID_MIN` setting in `/etc/login.defs` to determine which is appropriate for you.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | **3.11 Encrypt Sensitive Data at Rest** - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data. Storage-layer encryption, also known as server-side encryption, meets the minimum requirement of this Safeguard. | | x | x |
| v7 | **16.4 Encrypt or Hash all Authentication Credentials** - Encrypt or hash with a salt all authentication credentials when stored. | | x | x |

## Profile

- Level 2 - Server
