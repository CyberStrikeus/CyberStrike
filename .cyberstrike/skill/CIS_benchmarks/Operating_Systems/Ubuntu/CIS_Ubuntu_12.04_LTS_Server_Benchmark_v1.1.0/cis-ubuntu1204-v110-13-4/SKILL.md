---
name: cis-ubuntu1204-v110-13-4
description: "Verify No Legacy \"+\" Entries Exist in /etc/group File"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, group, nis, legacy]
cis_id: "13.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.4 Verify No Legacy "+" Entries Exist in /etc/group File (Scored)

## Profile Applicability
- Level 1

## Description
The character `+` in various files used to be markers for systems to insert data from NIS maps at a certain point in a system configuration file. These entries are no longer required on most systems, but may exist in files that have been imported from other platforms.

## Rationale
These entries may provide an avenue for attackers to gain privileged access on the system.

## Audit Procedure
### Using Command Line
Run the following command and verify that no output is returned:
```bash
/bin/grep '^+:' /etc/group
```

## Expected Result
No output should be returned. Any output indicates legacy `+` entries exist in `/etc/group`.

## Remediation
### Using Command Line
Delete these entries if they exist.

## Default Value
No legacy `+` entries exist in `/etc/group` by default on Ubuntu 12.04.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
