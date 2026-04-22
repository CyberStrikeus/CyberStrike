---
name: cis-ubuntu1804-v220-4-5-1-7
description: "Ensure password dictionary check is enabled"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, password-policy]
cis_id: "4.5.1.7"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.1.7

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pwquality` `dictcheck` option sets whether to check for the words from the `cracklib` dictionary.

## Rationale

If the operating system allows the user to select passwords based on dictionary words, this increases the chances of password compromise by increasing the opportunity for successful guesses, and brute-force attacks.

## Audit Procedure

### Command Line

Run the following command to verify that the `dictcheck` option in `/etc/security/pwquality.conf` is not set to `0`:

```bash
grep -Pi -- '^\h*dictcheck\h*=\h*0\b' /etc/security/pwquality.conf
```

### Expected Result

Nothing should be returned.

## Remediation

### Command Line

Edit or add the following line in `/etc/security/pwquality.conf` to a value of `1`:

```
dictcheck = 1
```

## Default Value

dictcheck = 1

## References

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

v8 - 5.2 Use Unique Passwords - Use unique passwords for all enterprise assets.

v7 - 4.4 Use Unique Passwords.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
