---
name: cis-ubuntu1204-v110-8-1-9
description: "Collect Session Initiation Information"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, session, utmp, wtmp, btmp]
cis_id: "8.1.9"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.9 Collect Session Initiation Information (Scored)

## Profile Applicability

- Level 2

## Description

Monitor session initiation events. The parameters in this section track changes to the files associated with session events. The file `/var/run/utmp` tracks all currently logged in users. The `/var/log/wtmp` file tracks logins, logouts, shutdown and reboot events. All audit records will be tagged with the identifier "session." The file `/var/log/btmp` keeps track of failed login attempts and can be read by entering the command `/usr/bin/last -f /var/log/btmp`. All audit records will be tagged with the identifier "logins."

## Rationale

Monitoring these files for changes could alert a system administrator to logins occurring at unusual hours, which could indicate intruder activity (i.e. a user logging in at a time when they do not normally log in).

## Audit Procedure

### Using Command Line

Perform the following to determine if session initiation information is collected.

```bash
grep session /etc/audit/audit.rules
```

## Expected Result

```
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k session
-w /var/log/btmp -p wa -k session
```

## Remediation

### Using Command Line

Add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k session
-w /var/log/btmp -p wa -k session
# Execute the following command to restart auditd
# pkill -HUP -P 1 auditd
```

**Note:** Use the `last` command to read `/var/log/wtmp` (last with no parameters) and `/var/run/utmp` (`last -f /var/run/utmp`).

## Default Value

By default, session initiation information is not collected via auditd.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
