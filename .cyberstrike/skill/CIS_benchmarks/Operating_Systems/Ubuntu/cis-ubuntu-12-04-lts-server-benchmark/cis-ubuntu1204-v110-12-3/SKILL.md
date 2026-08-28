---
name: cis-ubuntu1204-v110-12-3
description: "Verify Permissions on /etc/group"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, file-permissions, group, access-control]
cis_id: "12.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.3 Verify Permissions on /etc/group (Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/group` file contains a list of all the valid groups defined in the system. The command below allows read/write access for root and read access for everyone else.

## Rationale

The `/etc/group` file needs to be protected from unauthorized changes by non-privileged users, but needs to be readable as this information is used with many non-privileged programs.

## Audit Procedure

### Using Command Line

Run the following command to determine the permissions on the `/etc/group` file:

```bash
/bin/ls -l /etc/group
```

## Expected Result

```
-rw-r--r-- 1 root root <size> <date> /etc/group
```

Permissions should be `644` or more restrictive.

## Remediation

### Using Command Line

If the permissions of the `/etc/group` file are incorrect, run the following command to correct them:

```bash
/bin/chmod 644 /etc/group
```

## Default Value

644

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
