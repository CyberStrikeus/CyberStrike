---
name: cis-ubuntu1804-v220-4-4-4
description: "Ensure strong password hashing algorithm is configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, pam, authentication]
cis_id: "4.4.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.4.4

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The commands below change password encryption from md5 to yescrypt (a much stronger hashing algorithm). All existing accounts will need to perform a password change to upgrade the stored hashes to the new algorithm.

## Rationale

The yescrypt algorithm provides much stronger hashing than MD5, which provides protection of the password file even in the event of a system compromise. Note: these changes only apply to accounts configured on the local system.

## Audit Procedure

### Command Line

Run the following command to verify the password hashing algorithm is configured:

```bash
grep -Pi '^\h*password\h+(\S+\h+)+pam_unix\.so\h+([^#\n\r]+\h+)?(sha512|yescrypt)\b' /etc/pam.d/common-password
```

### Expected Result

Output should include `sha512` or `yescrypt`.

Also verify login.defs:

```bash
grep -Pi '^\h*ENCRYPT_METHOD\h+(SHA512|yescrypt)\b' /etc/login.defs
```

## Remediation

### Command Line

Edit `/etc/pam.d/common-password` to include `sha512` or `yescrypt` option to the `pam_unix.so` line:

```
password [success=1 default=ignore] pam_unix.so obscure use_authtok try_first_pass yescrypt
```

Edit `/etc/login.defs` to set:

```
ENCRYPT_METHOD yescrypt
```

## Default Value

ENCRYPT_METHOD SHA512 (in /etc/login.defs)

## References

1. NIST SP 800-53 Rev. 5: IA-5(1)

## CIS Controls

v8 - 3.11 Encrypt Sensitive Data at Rest - Encrypt sensitive data at rest on servers, applications, and databases containing sensitive data.

v7 - 16.4 Encrypt or Hash All Authentication Credentials.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
