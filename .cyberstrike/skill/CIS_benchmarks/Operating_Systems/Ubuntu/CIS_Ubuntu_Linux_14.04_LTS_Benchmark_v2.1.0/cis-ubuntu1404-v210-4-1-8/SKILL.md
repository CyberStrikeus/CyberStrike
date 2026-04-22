---
name: "CIS Ubuntu 14.04 LTS - 4.1.8 Ensure login and logout events are collected"
description: "Collect audit events for login and logout activity from faillog, lastlog, and tallylog"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - auditd
  - authentication
  - logging
cis_id: "4.1.8"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.1.8 Ensure login and logout events are collected (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor login and logout events. The parameters below track changes to files associated with login/logout events. The file `/var/log/faillog` tracks failed events from login. The file `/var/log/lastlog` maintain records of the last time a user successfully logged in. The file `/var/log/tallylog` maintains records of failures via the `pam_tally2` module.

## Rationale

Monitoring login/logout events could provide a system administrator with information associated with brute force attacks against user logins.

## Audit Procedure

Run the following commands:

```bash
grep logins /etc/audit/audit.rules
auditctl -l | grep logins
```

## Expected Result

Verify output of both includes:

```
-w /var/log/faillog -p wa -k logins
-w /var/log/lastlog -p wa -k logins
-w /var/log/tallylog -p wa -k logins
```

## Remediation

Add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /var/log/faillog -p wa -k logins
-w /var/log/lastlog -p wa -k logins
-w /var/log/tallylog -p wa -k logins
```

**Notes:** Reloading the auditd config to set active settings may require a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 5.5 Log Failed Administrative Login Attempts
2. CIS Controls v6.1 - 16.10 Profile User Account Usage And Monitor For Anomalies
3. CIS Controls v6.1 - 16.4 Automatically Log Off Users After Standard Period Of Inactivity

## Profile

- Level 2 - Server
- Level 2 - Workstation
