---
name: cis-gcp-cos-6.2.1
description: "Ensure password fields are not empty"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, password-fields]
cis_id: "6.2.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.1 Ensure password fields are not empty (Automated)

## Description

An account with an empty password field means that anybody may log in as that user without providing a password.

## Rationale

All accounts must have passwords or be locked to prevent the account from being used by an unauthorized user.

## Audit Procedure

Run the following command and verify that no output is returned:

```bash
# awk -F: '($2 == "" ) { print $1 " does not have a password "}' /etc/shadow
```

## Expected Result

No output should be returned.

## Remediation

If any accounts in the `/etc/shadow` file do not have a password, run the following command to lock the account until it can be determined why it does not have a password:

```bash
# passwd -l <username>
```

Also, check to see if the account is logged in and investigate what it is being used for to determine if it needs to be forced off.

## CIS Controls

| Controls Version | Control                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------ | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords | x    | x    | x    |
| v7               | 4.4 Use Unique Passwords | x    | x    | x    |

## Profile

- Level 1 - Server
