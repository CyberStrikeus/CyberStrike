---
name: "CIS Ubuntu 14.04 LTS - 6.2.1 Ensure password fields are not empty"
description: "Verify all accounts in /etc/shadow have a password or are locked"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - user-accounts
cis_id: "6.2.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 6.2.1 Ensure password fields are not empty (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

An account with an empty password field means that anybody may log in as that user without providing a password.

## Rationale

All accounts must have passwords or be locked to prevent the account from being used by an unauthorized user.

## Audit Procedure

Run the following command and verify that no output is returned:

```bash
cat /etc/shadow | awk -F: '($2 == "" ) { print $1 " does not have a password "}'
```

## Expected Result

No output should be returned.

## Remediation

If any accounts in the `/etc/shadow` file do not have a password, run the following command to lock the account until it can be determined why it does not have a password:

```bash
passwd -l <username>
```

Also, check to see if the account is logged in and investigate what it is being used for to determine if it needs to be forced off.

## Default Value

Not applicable.

## References

None

## CIS Controls

16 Account Monitoring and Control - Account Monitoring and Control

## Profile

- Level 1
