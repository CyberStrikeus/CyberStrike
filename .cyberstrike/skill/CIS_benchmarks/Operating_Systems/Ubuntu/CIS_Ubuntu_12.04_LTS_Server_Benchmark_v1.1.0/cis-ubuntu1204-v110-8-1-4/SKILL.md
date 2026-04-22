---
name: cis-ubuntu1204-v110-8-1-4
description: "Record Events That Modify Date and Time Information"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, time, date]
cis_id: "8.1.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.4 Record Events That Modify Date and Time Information (Scored)

## Profile Applicability
- Level 2

## Description
Capture events where the system date and/or time has been modified. The parameters in this section are set to determine if the `adjtimex` (tune kernel clock), `settimeofday` (Set time, using timeval and timezone structures), `stime` (using seconds since 1/1/1970) or `clock_settime` (allows for the setting of several internal clocks and timers) system calls have been executed and always write an audit record to the `/var/log/audit.log` file upon exit, tagging the records with the identifier "time-change".

## Rationale
Unexpected changes in system date and/or time could be a sign of malicious activity on the system.

## Audit Procedure
### Using Command Line
On a 64 bit system, perform the following command and ensure the output is as shown:
```bash
grep time-change /etc/audit/audit.rules
```

On a 32 bit system, perform the following command and ensure the output is as shown:
```bash
grep time-change /etc/audit/audit.rules
```

## Expected Result
For 64 bit systems:
```
-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b64 -S clock_settime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

For 32 bit systems:
```
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

## Remediation
### Using Command Line
For 64 bit systems, add the following lines to the `/etc/audit/audit.rules` file:
```bash
-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b64 -S clock_settime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
# Execute the following command to restart auditd
pkill -P 1-HUP auditd
```

For 32 bit systems, add the following lines to the `/etc/audit/audit.rules` file:
```bash
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
# Execute the following command to restart auditd
pkill -P 1-HUP auditd
```

## Default Value
By default, date and time modification events are not audited.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 2 - Scored
