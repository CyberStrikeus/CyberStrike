---
name: cis-ubuntu1204-v110-12-1
description: "Verify Permissions on /etc/passwd"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, file-permissions, passwd, access-control]
cis_id: "12.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.1 Verify Permissions on /etc/passwd (Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/passwd` file contains user account information that is used by many system utilities and therefore must be readable for these utilities to operate.

## Rationale

It is critical to ensure that the `/etc/passwd` file is protected from unauthorized write access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Audit Procedure

### Using Command Line

Run the following command to determine the permissions on the `/etc/passwd` file:

```bash
/bin/ls -l /etc/passwd
```

## Expected Result

```
-rw-r--r-- 1 root root <size> <date> /etc/passwd
```

Permissions should be `644` or more restrictive.

## Remediation

### Using Command Line

If the permissions of the `/etc/passwd` file are incorrect, run the following command to correct them:

```bash
/bin/chmod 644 /etc/passwd
```

## Default Value

644

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
