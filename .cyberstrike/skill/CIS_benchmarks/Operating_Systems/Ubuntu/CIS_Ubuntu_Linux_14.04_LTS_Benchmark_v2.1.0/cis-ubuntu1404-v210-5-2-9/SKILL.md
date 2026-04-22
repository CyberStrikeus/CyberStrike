---
name: "CIS Ubuntu 14.04 LTS - 5.2.9 Ensure SSH PermitEmptyPasswords is disabled"
description: "Verify SSH PermitEmptyPasswords is set to no to prevent login with empty passwords"
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
cis_id: "5.2.9"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 5.2.9 Ensure SSH PermitEmptyPasswords is disabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PermitEmptyPasswords` parameter specifies if the SSH server allows login to accounts with empty password strings.

## Rationale

Disallowing remote shell access to accounts that have an empty password reduces the probability of unauthorized access to the system.

## Audit Procedure

Run the following command and verify that output matches:

```bash
grep "^PermitEmptyPasswords" /etc/ssh/sshd_config
```

## Expected Result

```
PermitEmptyPasswords no
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
PermitEmptyPasswords no
```

## Default Value

PermitEmptyPasswords no

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
