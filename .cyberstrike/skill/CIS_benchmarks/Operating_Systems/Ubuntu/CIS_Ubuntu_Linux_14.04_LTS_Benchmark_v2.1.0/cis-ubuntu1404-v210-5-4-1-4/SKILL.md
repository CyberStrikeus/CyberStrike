---
name: "CIS Ubuntu 14.04 LTS - 5.4.1.4 Ensure inactive password lock is 30 days or less"
description: "Verify inactive password lock is set to 30 days or less to disable dormant accounts"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - user-accounts
cis_id: "5.4.1.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.4.1.4 Ensure inactive password lock is 30 days or less (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

User accounts that have been inactive for over a given period of time can be automatically disabled. It is recommended that accounts that are inactive for 30 days after password expiration be disabled.

## Rationale

Inactive accounts pose a threat to system security since the users are not logging in to notice failed login attempts or other anomalies.

## Audit Procedure

Run the following command and verify `INACTIVE` is 30 or less:

```bash
useradd -D | grep INACTIVE
```

Verify all users with a password have Password inactive no more than 30 days after password expires:

```bash
egrep ^[^:]+:[^\!*] /etc/shadow | cut -d: -f1
chage --list <user>
```

## Expected Result

```
INACTIVE=30
Password inactive                                      : <date>
```

## Remediation

Run the following command to set the default password inactivity period to 30 days:

```bash
useradd -D -f 30
```

Modify user parameters for all users with a password set to match:

```bash
chage --inactive 30 <user>
```

## Default Value

INACTIVE=-1 (disabled)

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
