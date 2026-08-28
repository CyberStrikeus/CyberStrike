---
name: cis-ubuntu1204-v110-7-4-4
description: "Create /etc/hosts.deny"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, tcp-wrappers, hosts-deny, access-control]
cis_id: "7.4.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.4.4 Create /etc/hosts.deny (Not Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/hosts.deny` file specifies which IP addresses are **not** permitted to connect to the host. It is intended to be used in conjunction with the `/etc/hosts.allow` file.

## Rationale

The `/etc/hosts.deny` file serves as a failsafe so that any host not specified in `/etc/hosts.allow` is denied access to the server.

## Audit Procedure

### Using Command Line

Verify that `/etc/hosts.deny` exists and is configured to deny all hosts not explicitly listed in `/etc/hosts.allow`:

```bash
grep "ALL: ALL" /etc/hosts.deny
```

## Expected Result

```
ALL: ALL
```

## Remediation

### Using Command Line

Create `/etc/hosts.deny`:

```bash
echo "ALL: ALL" >> /etc/hosts.deny
```

## Default Value

The `/etc/hosts.deny` file may or may not exist by default and may be empty.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
