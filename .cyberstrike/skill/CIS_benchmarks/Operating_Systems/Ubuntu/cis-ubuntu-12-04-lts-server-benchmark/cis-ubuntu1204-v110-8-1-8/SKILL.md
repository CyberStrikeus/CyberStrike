---
name: cis-ubuntu1204-v110-8-1-8
description: "Collect Login and Logout Events"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, login, logout, authentication]
cis_id: "8.1.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.8 Collect Login and Logout Events (Scored)

## Profile Applicability

- Level 2

## Description

Monitor login and logout events. The parameters below track changes to files associated with login/logout events. The file `/var/log/faillog` tracks failed events from login. The file `/var/log/lastlog` maintains records of the last time a user successfully logged in. The file `/var/log/tallylog` maintains records of failures via the `pam_tally2` module.

## Rationale

Monitoring login/logout events could provide a system administrator with information associated with brute force attacks against user logins.

## Audit Procedure

### Using Command Line

Perform the following to determine if login and logout events are recorded.

```bash
grep logins /etc/audit/audit.rules
```

## Expected Result

```
-w /var/log/faillog -p wa -k logins
-w /var/log/lastlog -p wa -k logins
-w /var/log/tallylog -p wa -k logins
```

## Remediation

### Using Command Line

Add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /var/log/faillog -p wa -k logins
-w /var/log/lastlog -p wa -k logins
-w /var/log/tallylog -p wa -k logins
# Execute the following command to restart auditd
# pkill -HUP -P 1 auditd
```

## Default Value

By default, login and logout events are not audited.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
