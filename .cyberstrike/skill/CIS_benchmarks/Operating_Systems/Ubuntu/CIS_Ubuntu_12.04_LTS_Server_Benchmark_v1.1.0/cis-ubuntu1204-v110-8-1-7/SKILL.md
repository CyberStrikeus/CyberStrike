---
name: cis-ubuntu1204-v110-8-1-7
description: "Record Events That Modify the System's Mandatory Access Controls"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, mac, selinux]
cis_id: "8.1.7"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.7 Record Events That Modify the System's Mandatory Access Controls (Scored)

## Profile Applicability
- Level 2

## Description
Monitor SELinux mandatory access controls. The parameters below monitor any write access (potential additional, deletion or modification of files in the directory) or attribute changes to the `/etc/selinux/` directory.

## Rationale
Changes to files in this directory could indicate that an unauthorized user is attempting to modify access controls and change security contexts, leading to a compromise of the system.

## Audit Procedure
### Using Command Line
Perform the following to determine if events that modify the system's mandatory access controls are recorded:
```bash
grep MAC-policy /etc/audit/audit.rules
```

## Expected Result
```
-w /etc/selinux/ -p wa -k MAC-policy
```

## Remediation
### Using Command Line
Add the following lines to the `/etc/audit/audit.rules` file:
```bash
-w /etc/selinux/ -p wa -k MAC-policy
# Execute the following command to restart auditd
# pkill -P 1-HUP auditd
```

## Default Value
By default, mandatory access control modification events are not audited.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 2 - Scored
