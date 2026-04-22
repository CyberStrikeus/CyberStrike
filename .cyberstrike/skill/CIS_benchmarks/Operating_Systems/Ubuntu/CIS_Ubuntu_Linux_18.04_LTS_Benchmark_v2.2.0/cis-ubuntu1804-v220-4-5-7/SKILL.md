---
name: cis-ubuntu1804-v220-4-5-7
description: "Ensure maximum number of same consecutive characters in a password is configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, password-policy]
cis_id: "4.5.7"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.7

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pwquality` `maxrepeat` option sets the maximum number of allowed same consecutive characters in a new password.

## Rationale

Use of a complex password helps to increase the time and resources required to compromise the password. Password complexity, or strength, is a measure of the effectiveness of a password in resisting attempts at guessing and brute-force attacks.

Password complexity is one factor of several that determines how long it takes to crack a password. The more complex the password, the greater the number of possible combinations that need to be tested before the password is compromised.

## Audit Procedure

### Command Line

Run the following command to verify that the `maxrepeat` option in `/etc/security/pwquality.conf` is set to `3` or less, and not `0`:

```bash
grep -Pi '^\h*maxrepeat\h*=\h*[1-3]\b' /etc/security/pwquality.conf
```

### Expected Result

```
maxrepeat = 3
```

Note: The check is disabled if the value is 0.

## Remediation

### Command Line

Edit or add the following line in `/etc/security/pwquality.conf` to a value of `3` or less and not `0`:

```
maxrepeat = 3
```

## Default Value

maxrepeat = 0

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
