---
name: cis-ubuntu1204-v110-7-4-3
description: "Verify Permissions on /etc/hosts.allow"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, tcp-wrappers, hosts-allow, permissions]
cis_id: "7.4.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.4.3 Verify Permissions on /etc/hosts.allow (Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/hosts.allow` file contains networking information that is used by many applications and therefore must be readable for these applications to operate.

## Rationale

It is critical to ensure that the `/etc/hosts.allow` file is protected from unauthorized write access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Audit Procedure

### Using Command Line

Run the following command to determine the permissions on the `/etc/hosts.allow` file.

```bash
/bin/ls -l /etc/hosts.allow
```

## Expected Result

```
-rw-r--r-- 1 root root 2055 Jan 30 16:30 /etc/hosts.allow
```

## Remediation

### Using Command Line

If the permissions of the `/etc/hosts.allow` file are incorrect, run the following command to correct them:

```bash
/bin/chmod 644 /etc/hosts.allow
```

## Default Value

Permissions are 644 by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
