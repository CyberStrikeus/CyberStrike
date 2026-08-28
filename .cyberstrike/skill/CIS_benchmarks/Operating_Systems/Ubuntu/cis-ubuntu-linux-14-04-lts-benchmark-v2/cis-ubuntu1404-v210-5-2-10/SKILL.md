---
name: "CIS Ubuntu 14.04 LTS - 5.2.10 Ensure SSH PermitUserEnvironment is disabled"
description: "Verify SSH PermitUserEnvironment is set to no to prevent users from setting environment options"
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
cis_id: "5.2.10"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.2.10 Ensure SSH PermitUserEnvironment is disabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PermitUserEnvironment` option allows users to present environment options to the `ssh` daemon.

## Rationale

Permitting users the ability to set environment variables through the SSH daemon could potentially allow users to bypass security controls (e.g. setting an execution path that has `ssh` executing trojan'd programs).

## Audit Procedure

Run the following command and verify that output matches:

```bash
grep PermitUserEnvironment /etc/ssh/sshd_config
```

## Expected Result

```
PermitUserEnvironment no
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
PermitUserEnvironment no
```

## Default Value

PermitUserEnvironment no

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
