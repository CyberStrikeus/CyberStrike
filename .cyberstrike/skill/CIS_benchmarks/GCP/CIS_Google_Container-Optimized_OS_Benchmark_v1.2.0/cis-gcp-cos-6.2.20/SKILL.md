---
name: cis-gcp-cos-6.2.20
description: "Ensure shadow group is empty"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, group-settings, user-accounts]
cis_id: "6.2.20"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.20 Ensure shadow group is empty (Automated)

## Description

The shadow group allows system programs which require access the ability to read the /etc/shadow file. No users should be assigned to the shadow group.

## Rationale

Any users assigned to the shadow group would be granted read access to the /etc/shadow file. If attackers can gain read access to the `/etc/shadow` file, they can easily run a password cracking program against the hashed passwords to break them. Other security information that is stored in the `/etc/shadow` file (such as expiration) could also be useful to subvert additional user accounts.

## Audit Procedure

Run the following commands and verify no results are returned:

```bash
# grep ^shadow:[^:]*:[^:]*:[^:]+ /etc/group
# awk -F: '($4 == "<shadow-gid>") { print }' /etc/passwd
```

## Expected Result

No results should be returned.

## Remediation

Remove all users from the shadow group, and change the primary group of any users with shadow as their primary group.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## Profile

- Level 1 - Server
