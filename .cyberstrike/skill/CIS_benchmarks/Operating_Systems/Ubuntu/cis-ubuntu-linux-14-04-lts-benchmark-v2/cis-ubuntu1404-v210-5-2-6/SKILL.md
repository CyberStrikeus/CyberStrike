---
name: "CIS Ubuntu 14.04 LTS - 5.2.6 Ensure SSH IgnoreRhosts is enabled"
description: "Verify SSH IgnoreRhosts is set to yes to prevent .rhosts-based authentication"
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
cis_id: "5.2.6"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.2.6 Ensure SSH IgnoreRhosts is enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `IgnoreRhosts` parameter specifies that `.rhosts` and `.shosts` files will not be used in `RhostsRSAAuthentication` or `HostbasedAuthentication`.

## Rationale

Setting this parameter forces users to enter a password when authenticating with ssh.

## Audit Procedure

Run the following command and verify that output matches:

```bash
grep "^IgnoreRhosts" /etc/ssh/sshd_config
```

## Expected Result

```
IgnoreRhosts yes
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
IgnoreRhosts yes
```

## Default Value

IgnoreRhosts yes

## References

- CIS Controls: 9 - Limitation and Control of Network Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
