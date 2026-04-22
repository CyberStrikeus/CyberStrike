---
name: cis-ubuntu1204-v110-12-8
description: "Find Un-owned Files and Directories"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, file-ownership, unowned, integrity]
cis_id: "12.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.8 Find Un-owned Files and Directories (Scored)

## Profile Applicability

- Level 1

## Description

Sometimes when administrators delete users from the password file they neglect to remove all files owned by those users from the system.

## Rationale

A new user who is assigned the deleted user's user ID or group ID may then end up "owning" these files, and thus have more access on the system than was intended.

## Audit Procedure

### Using Command Line

```bash
#!/bin/bash
df --local -P | awk {'if (NR!=1) print $6'} | xargs -I '{}' find '{}' -xdev -nouser ls
```

## Expected Result

No files should be returned. If any un-owned files are found, they should be investigated and assigned to an appropriate user.

## Remediation

### Using Command Line

Locate files that are owned by users or groups not listed in the system configuration files, and reset the ownership of these files to some active user on the system as appropriate.

## Default Value

No un-owned files should exist on a properly maintained system.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
