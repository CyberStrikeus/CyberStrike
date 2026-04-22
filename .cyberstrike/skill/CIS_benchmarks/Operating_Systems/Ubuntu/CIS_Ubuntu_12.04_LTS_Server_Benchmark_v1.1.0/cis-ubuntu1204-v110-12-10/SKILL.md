---
name: cis-ubuntu1204-v110-12-10
description: "Find SUID System Executables"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, suid, file-permissions, privilege-escalation]
cis_id: "12.10"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.10 Find SUID System Executables (Not Scored)

## Profile Applicability
- Level 1

## Description
The owner of a file can set the file's permissions to run with the owner's or group's permissions, even if the user running the program is not the owner or a member of the group. The most common reason for a SUID program is to enable users to perform functions (such as changing their password) that require root privileges.

## Rationale
There are valid reasons for SUID programs, but it is important to identify and review such programs to ensure they are legitimate. Review the files returned by the action in the audit section and check to see if system binaries have a different md5 checksum than what from the package. This is an indication that the binary may have been replaced.

## Audit Procedure
### Using Command Line
```bash
#!/bin/bash
df --local -P | awk {'if (NR!=1) print $6'} | xargs -I '{}' find '{}' -xdev -type f -perm -4000 -print
```

## Expected Result
Review the list of SUID executables returned. All SUID files should be legitimate system binaries. Investigate any unexpected or unauthorized SUID files.

## Remediation
### Using Command Line
Ensure that no rogue set-UID programs have been introduced into the system. Review the files returned by the action in the Audit section and confirm the integrity of these binaries.

## Default Value
Various system binaries have SUID set by default (e.g., /usr/bin/passwd, /usr/bin/sudo).

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Not Scored
