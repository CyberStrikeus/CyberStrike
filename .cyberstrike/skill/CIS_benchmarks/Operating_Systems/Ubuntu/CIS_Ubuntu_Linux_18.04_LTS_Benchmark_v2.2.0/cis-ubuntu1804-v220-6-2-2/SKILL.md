---
name: cis-ubuntu1804-v220-6-2-2
description: "Ensure /etc/shadow password fields are not empty"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users]
cis_id: "6.2.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.2 Ensure /etc/shadow password fields are not empty (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

An account with an empty password field means that anybody may log in as that user without providing a password.

## Rationale

All accounts must have passwords or be locked to prevent the account from being used by an unauthorized user.

## Audit Procedure

### Command Line

Run the following command and verify that no output is returned:

```bash
# awk -F: '($2 == "" ) { print $1 " does not have a password"}' /etc/shadow
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

If any accounts in the `/etc/shadow` file do not have a password, run the following command to lock the account until it can be determined why it does not have a password:

```bash
# passwd -l <username>
```

Also, check to see if the account is logged in and investigate what it is being used for to determine if it needs to be forced off.

## References

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

- v8: **5.2** Use Unique Passwords
- v7: **4.4** Use Unique Passwords
