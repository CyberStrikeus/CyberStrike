---
name: "CIS Ubuntu 14.04 LTS - 1.6.1.2 Ensure the SELinux state is enforcing"
description: "Verify that SELinux is set to enforcing mode for mandatory access control"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - mac
cis_id: "1.6.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with:
  - cis-ubuntu1404-v210-1-6-1-1
  - cis-ubuntu1404-v210-1-6-1-3
prerequisites:
  - cis-ubuntu1404-v210-1-6-1-1
severity_boost: "high"
---

# 1.6.1.2 Ensure the SELinux state is enforcing (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Set SELinux to enable when the system is booted.

## Rationale

SELinux must be enabled at boot time in to ensure that the controls it provides are in effect at all times.

## Audit Procedure

Run the following commands and ensure output matches:

```bash
grep SELINUX=enforcing /etc/selinux/config
sestatus
```

## Expected Result

```
SELINUX=enforcing

SELinux status: enabled
Current mode: enforcing
Mode from config file: enforcing
```

## Remediation

Edit the `/etc/selinux/config` file to set the SELINUX parameter:

```
SELINUX=enforcing
```

## Default Value

Not applicable.

## References

- CIS Controls: 14.4 Protect Information With Access Control Lists

## Profile

- Level 2 - Server
- Level 2 - Workstation
