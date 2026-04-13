---
name: cis-gcp-cos-6.2.5
description: "Ensure root is the only UID 0 account"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, duplicate-ids]
cis_id: "6.2.5"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.5 Ensure root is the only UID 0 account (Automated)

## Description

Any account with UID 0 has superuser privileges on the system.

## Rationale

This access must be limited to only the default `root` account and only from the system console. Administrative access must be through an unprivileged account using an approved mechanism as noted in Item 5.6 Ensure access to the su command is restricted.

## Audit Procedure

Run the following command and verify that only "root" is returned:

```bash
# awk -F: '($3 == 0) { print $1 }' /etc/passwd

root
```

## Expected Result

Only "root" should be returned.

## Remediation

Remove any users other than `root` with UID `0` or assign them a new UID if appropriate.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## Profile

- Level 1 - Server
