---
name: cis-ubuntu1204-v110-12-7
description: "Find World Writable Files"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, file-permissions, world-writable, integrity]
cis_id: "12.7"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.7 Find World Writable Files (Not Scored)

## Profile Applicability

- Level 1

## Description

Unix-based systems support variable settings to control access to files. World writable files are the least secure. See the `chmod(2)` man page for more information.

## Rationale

Data in world-writable files can be modified and compromised by any user on the system. World writable files may also indicate an incorrectly written script or program that could potentially be the cause of a larger compromise to the system's integrity.

## Audit Procedure

### Using Command Line

```bash
#!/bin/bash
df --local -P | awk {'if (NR!=1) print $6'} | xargs -I '{}' find '{}' -xdev -type f -perm -0002 -print
```

## Expected Result

No files should be returned. If any world-writable files are found, they should be investigated and have their permissions corrected.

## Remediation

### Using Command Line

Removing write access for the "other" category (`chmod o-w <filename>`) is advisable, but always consult relevant vendor documentation to avoid breaking any application dependencies on a given file.

## Default Value

Various files may have world-writable permissions depending on installed packages.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
