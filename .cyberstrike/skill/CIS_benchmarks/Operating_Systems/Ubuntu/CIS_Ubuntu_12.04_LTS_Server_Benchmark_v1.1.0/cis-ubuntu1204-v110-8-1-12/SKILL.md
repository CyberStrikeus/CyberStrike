---
name: cis-ubuntu1204-v110-8-1-12
description: "Collect Use of Privileged Commands"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, privileged, setuid, setgid]
cis_id: "8.1.12"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.12 Collect Use of Privileged Commands (Scored)

## Profile Applicability

- Level 2

## Description

Monitor privileged programs (those that have the setuid and/or setgid bit set on execution) to determine if unprivileged users are running these commands.

## Rationale

Execution of privileged commands by non-privileged users could be an indication of someone trying to gain unauthorized access to the system.

## Audit Procedure

### Using Command Line

Verify that an audit line for each setuid/setgid program identified in the `find` command appears in the audit file with the above attributes.

Run the following to find all setuid/setgid programs:

```bash
find PART -xdev \( -perm -4000 -o -perm -2000 \) -type f | awk '{print "-a always,exit -F path=" $1 " -F perm=x -F auid>=500 -F auid!=4294967295 -k privileged" }'
```

## Expected Result

An audit line should exist for each setuid/setgid program found by the `find` command.

## Remediation

### Using Command Line

To remediate this issue, the system administrator will have to execute a find command to locate all the privileged programs and then add an audit line for each one of them. The audit parameters associated with this are as follows:

- `-F path=" $1 "` - will populate each file name found through the find command and processed by awk.
- `-F perm=x` - will write an audit record if the file is executed.
- `-F auid>=500` - will write a record if the user executing the command is not a privileged user.
- `-F auid!= 4294967295` - will ignore Daemon events

All audit records will be tagged with the identifier "privileged."

```bash
find PART -xdev \( -perm -4000 -o -perm -2000 \) -type f | awk '{print "-a always,exit -F path=" $1 " -F perm=x -F auid>=500 -F auid!=4294967295 -k privileged" }'
```

Next, add those lines to the `/etc/audit/audit.rules` file.

## Default Value

By default, use of privileged commands is not audited.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
