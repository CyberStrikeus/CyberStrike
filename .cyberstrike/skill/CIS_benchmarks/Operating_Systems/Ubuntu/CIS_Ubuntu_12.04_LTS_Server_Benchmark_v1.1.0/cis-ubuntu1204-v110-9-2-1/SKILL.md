---
name: cis-ubuntu1204-v110-9-2-1
description: "Set Password Creation Requirement Parameters Using pam_cracklib"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, pam, password-policy]
cis_id: "9.2.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.2.1 Set Password Creation Requirement Parameters Using pam_cracklib (Scored)

## Profile Applicability
- Level 1

## Description
The `pam_cracklib` module checks the strength of passwords. It performs checks such as making sure a password is not a dictionary word, it is a certain length, contains a mix of characters (e.g. alphabet, numeric, other) and more. The following are definitions of the `pam_cracklib.so` options:

- `retry=3` - Allow 3 tries before sending back a failure.
- `minlen=14` - password must be 14 characters or more
- `dcredit=-1` - provide at least one digit
- `ucredit=-1` - provide at least one uppercase character
- `ocredit=-1` - provide at least one special character
- `lcredit=-1` - provide at least one lowercase character

The setting shown above is one possible policy. Alter these values to conform to your own organization's password policies.

## Rationale
Strong passwords protect systems from being hacked through brute force methods.

## Audit Procedure
### Using Command Line
Perform the following to determine the current settings in the `/etc/pam.d/common-password` file:
```bash
grep pam_cracklib.so /etc/pam.d/common-password
```

## Expected Result
```
password required pam_cracklib.so retry=3 minlen=14 dcredit=-1 ucredit=-1 ocredit=-1 lcredit=-1
```

## Remediation
### Using Command Line
Set the `pam_cracklib.so` parameters as follows in `/etc/pam.d/common-password`:
```bash
password required pam_cracklib.so retry=3 minlen=14 dcredit=-1 ucredit=-1 ocredit=-1 lcredit=-1
```

## Default Value
No password creation requirements are set by default.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
