---
name: "CIS Ubuntu 14.04 LTS - 4.1.9 Ensure session initiation information is collected"
description: "Collect audit events for session initiation from utmp, wtmp, and btmp files"
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
  - session
  - logging
cis_id: "4.1.9"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.1.9 Ensure session initiation information is collected (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor session initiation events. The parameters in this section track changes to the files associated with session events. The file `/var/run/utmp` file tracks all currently logged in users. All audit records will be tagged with the identifier "session." The `/var/log/wtmp` file tracks logins, logouts, shutdown, and reboot events. The file `/var/log/btmp` keeps track of failed login attempts and can be read by entering the command `/usr/bin/last -f /var/log/btmp`. All audit records will be tagged with the identifier "logins."

## Rationale

Monitoring these files for changes could alert a system administrator to logins occurring at unusual hours, which could indicate intruder activity (i.e. a user logging in at a time when they do not normally log in).

## Audit Procedure

Run the following commands:

```bash
grep session /etc/audit/audit.rules
auditctl -l | grep session
```

Verify output of both matches:

```
-w /var/run/utmp -p wa -k session
```

Run the following commands:

```bash
grep logins /etc/audit/audit.rules
auditctl -l | grep logins
```

Verify output of both matches:

```
-w /var/log/wtmp -p wa -k logins
-w /var/log/btmp -p wa -k logins
```

## Expected Result

The session and logins audit rules should be present and active.

## Remediation

Add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k logins
-w /var/log/btmp -p wa -k logins
```

**Notes:** The `last` command can be used to read `/var/log/wtmp` (`last` with no parameters) and `/var/run/utmp` (`last -f /var/run/utmp`).

Reloading the auditd config to set active settings may require a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 5.5 Log Failed Administrative Login Attempts
2. CIS Controls v6.1 - 16.10 Profile User Account Usage And Monitor For Anomalies
3. CIS Controls v6.1 - 16.4 Automatically Log Off Users After Standard Period Of Inactivity

## Profile

- Level 2 - Server
- Level 2 - Workstation
