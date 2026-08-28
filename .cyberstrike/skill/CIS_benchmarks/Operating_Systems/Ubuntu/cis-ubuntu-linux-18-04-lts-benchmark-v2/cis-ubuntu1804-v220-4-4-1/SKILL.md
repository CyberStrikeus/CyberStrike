---
name: cis-ubuntu1804-v220-4-4-1
description: "Ensure password creation requirements are configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, pam, authentication]
cis_id: "4.4.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.4.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pam_pwquality.so` module checks the strength of passwords. It performs checks such as making sure a password is not a dictionary word, it is a certain length, contains a mix of characters (e.g. alphabet, numeric, other) and more. The following are definitions of the `pam_pwquality.so` options:

- `minlen = 14` - password must be 14 characters or more
- `minclass = 4` - The minimum number of required classes of characters for the new password (digits, uppercase, lowercase, others)

## Rationale

Strong passwords protect systems from being hacked through brute force methods.

## Audit Procedure

### Command Line

Run the following command to verify password creation requirements:

```bash
grep -Pi '^\h*minlen\h*=\h*(1[4-9]|[2-9][0-9]|[1-9][0-9]{2,})\b' /etc/security/pwquality.conf
grep -Pi '^\h*minclass\h*=\h*4\b' /etc/security/pwquality.conf
```

### Expected Result

```
minlen = 14
minclass = 4
```

Or higher values.

## Remediation

### Command Line

Edit or add the following lines in `/etc/security/pwquality.conf`:

```
minlen = 14
minclass = 4
```

Run the following command to verify that the `pam_pwquality` module is enabled:

```bash
grep -P '^\h*password\h+(requisite|required)\h+pam_pwquality\.so' /etc/pam.d/common-password
```

If the module is not enabled, add or edit the following line in `/etc/pam.d/common-password`:

```
password requisite pam_pwquality.so retry=3
```

## Default Value

minlen = 8
minclass = 0

## References

1. NIST SP 800-53 Rev. 5: IA-5(1)

## CIS Controls

v8 - 5.2 Use Unique Passwords - Use unique passwords for all enterprise assets.

v7 - 4.4 Use Unique Passwords - Where multi-factor authentication is not supported, accounts will use passwords that are unique to that system.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
