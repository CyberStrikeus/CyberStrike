---
name: "CIS Ubuntu 14.04 LTS - 6.2.20 Ensure shadow group is empty"
description: "Verify the shadow group has no users assigned to it"
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
cis_id: "6.2.20"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 6.2.20 Ensure shadow group is empty (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The shadow group allows system programs which require access the ability to read the /etc/shadow file. No users should be assigned to the shadow group.

## Rationale

Any users assigned to the shadow group would be granted read access to the /etc/shadow file. If attackers can gain read access to the `/etc/shadow` file, they can easily run a password cracking program against the hashed passwords to break them. Other security information that is stored in the `/etc/shadow` file (such as expiration) could also be useful to subvert additional user accounts.

## Audit Procedure

Run the following commands and verify no results are returned:

```bash
grep ^shadow:[^:]*:[^:]*:[^:]+ /etc/group
awk -F: '($4 == "<shadow-gid>") { print }' /etc/passwd
```

## Expected Result

No output should be returned.

## Remediation

Remove all users from the shadow group, and change the primary group of any users with shadow as their primary group.

## Default Value

The shadow group is empty by default.

## References

None

## CIS Controls

5.1 Minimize And Sparingly Use Administrative Privileges - Minimize administrative privileges and only use administrative accounts when they are required. Implement focused auditing on the use of administrative privileged functions and monitor for anomalous behavior.

## Profile

- Level 1
