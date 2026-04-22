---
name: "CIS Ubuntu 14.04 LTS - 5.2.8 Ensure SSH root login is disabled"
description: "Verify SSH PermitRootLogin is set to no to prevent direct root login over SSH"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - ssh
cis_id: "5.2.8"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 5.2.8 Ensure SSH root login is disabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PermitRootLogin` parameter specifies if the root user can log in using ssh(1). The default is no.

## Rationale

Disallowing root logins over SSH requires system admins to authenticate using their own individual account, then escalating to root via `sudo` or `su`. This in turn limits opportunity for non-repudiation and provides a clear audit trail in the event of a security incident.

## Audit Procedure

Run the following command and verify that output matches:

```bash
grep "^PermitRootLogin" /etc/ssh/sshd_config
```

## Expected Result

```
PermitRootLogin no
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
PermitRootLogin no
```

## Default Value

PermitRootLogin no

## References

- CIS Controls: 5.8 - Administrators Should Not Directly Log In To A System (i.e. use RunAs/sudo)

## Profile

- Level 1 - Server
- Level 1 - Workstation
