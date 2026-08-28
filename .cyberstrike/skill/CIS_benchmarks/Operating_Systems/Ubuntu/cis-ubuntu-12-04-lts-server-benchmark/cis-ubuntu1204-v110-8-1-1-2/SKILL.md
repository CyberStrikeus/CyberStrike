---
name: cis-ubuntu1204-v110-8-1-1-2
description: "Disable System on Audit Log Full"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, audit-log, availability]
cis_id: "8.1.1.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.1.2 Disable System on Audit Log Full (Not Scored)

## Profile Applicability

- Level 2

## Description

The `auditd` daemon can be configured to halt the system when the audit logs are full.

## Rationale

In high security contexts, the risk of detecting unauthorized access or nonrepudiation exceeds the benefit of the system's availability.

## Audit Procedure

### Using Command Line

Perform the following to determine if `auditd` is configured to notify the administrator and halt the system when audit logs are full.

```bash
grep space_left_action /etc/audit/auditd.conf
grep action_mail_acct /etc/audit/auditd.conf
grep admin_space_left_action /etc/audit/auditd.conf
```

## Expected Result

```
space_left_action = email
action_mail_acct = root
admin_space_left_action = halt
```

## Remediation

### Using Command Line

Add the following lines to the `/etc/audit/auditd.conf` file:

```bash
space_left_action = email
action_mail_acct = root
admin_space_left_action = halt
```

## Default Value

By default, auditd does not halt the system when logs are full.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Not Scored
