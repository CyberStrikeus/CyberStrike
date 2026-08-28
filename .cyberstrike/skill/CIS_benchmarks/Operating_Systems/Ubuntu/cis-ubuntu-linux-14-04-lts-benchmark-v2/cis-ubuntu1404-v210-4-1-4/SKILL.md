---
name: "CIS Ubuntu 14.04 LTS - 4.1.4 Ensure events that modify date and time information are collected"
description: "Collect audit events for system date and time modifications to detect tampering"
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
  - time
  - logging
cis_id: "4.1.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.1.4 Ensure events that modify date and time information are collected (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Capture events where the system date and/or time has been modified. The parameters in this section are set to determine if the `adjtimex` (tune kernel clock), `settimeofday` (Set time, using timeval and timezone structures) `stime` (using seconds since 1/1/1970) or `clock_settime` (allows for the setting of several internal clocks and timers) system calls have been executed and always write an audit record to the `/var/log/audit.log` file upon exit, tagging the records with the identifier "time-change".

## Rationale

Unexpected changes in system date and/or time could be a sign of malicious activity on the system.

## Audit Procedure

On a 32 bit system run the following commands:

```bash
grep time-change /etc/audit/audit.rules
auditctl -l | grep time-change
```

Verify output of both matches:

```
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

On a 64 bit system run the following commands:

```bash
grep time-change /etc/audit/audit.rules
auditctl -l | grep time-change
```

Verify output of both matches:

```
-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b64 -S clock_settime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

## Expected Result

The audit rules for time-change should be present and active in both the rules file and the running configuration.

## Remediation

For 32 bit systems add the following lines to the `/etc/audit/audit.rules` file:

```bash
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

For 64 bit systems add the following lines to the `/etc/audit/audit.rules` file:

```bash
-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b64 -S clock_settime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

**Notes:** Reloading the auditd config to set active settings may require a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 3.6 Implement Automated Configuration Monitoring System

## Profile

- Level 2 - Server
- Level 2 - Workstation
