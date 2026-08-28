---
name: cis-ubuntu1604-v200-4-1-3
description: "Ensure events that modify date and time information are collected"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.3

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Capture events where the system date and/or time has been modified. The parameters in this section are set to determine if the adjtimex (tune kernel clock), settimeofday (Set time, using timeval and timezone structures) stime (using seconds since 1/1/1970) or clock_settime (allows for the setting of several internal clocks and timers) system calls have been executed and always write an audit record to the /var/log/audit/audit.log file upon exit, tagging the records with the identifier "time-change".

**Note:** Reloading the auditd config to set active settings requires the auditd service to be restarted, and may require a system reboot.

## Rationale

Unexpected changes in system date and/or time could be a sign of malicious activity on the system.

## Impact

None.

## Audit Procedure

### Command Line

**On a 32 bit system:**

Run the following command to verify the rules are contained in a `.rules` file in the `/etc/audit/rules.d/` directory:

```bash
grep time-change /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

Run the following command to verify that rules are in the running auditd config:

```bash
auditctl -l | grep time-change
```

Verify the output matches:

```
-a always,exit -F arch=b32 -S stime,settimeofday,adjtimex -F key=time-change
-a always,exit -F arch=b32 -S clock_settime -F key=time-change
-w /etc/localtime -p wa -k time-change
```

**On a 64 bit system:**

Run the following command to verify the rules are contained in a `.rules` file in the `/etc/audit/rules.d/` directory:

```bash
grep time-change /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b64 -S clock_settime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

Run the following command to verify that rules are in the running auditd config:

```bash
auditctl -l | grep time-change
```

Verify the output matches:

```
-a always,exit -F arch=b64 -S adjtimex,settimeofday -F key=time-change
-a always,exit -F arch=b32 -S stime,settimeofday,adjtimex -F key=time-change
-a always,exit -F arch=b64 -S clock_settime -F key=time-change
-a always,exit -F arch=b32 -S clock_settime -F key=time-change
-w /etc/localtime -p wa -k time-change
```

## Expected Result

Output should match the rules listed above for the appropriate architecture.

## Remediation

### Command Line

**For 32 bit systems:** Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules`.

Example: `vi /etc/audit/rules.d/50-time-change.rules`

Add the following lines:

```bash
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

**For 64 bit systems:** Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules`.

Example: `vi /etc/audit/rules.d/50-time-change.rules`

Add the following lines:

```bash
-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
-a always,exit -F arch=b64 -S clock_settime -k time-change
-a always,exit -F arch=b32 -S clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

## Default Value

By default, no audit rules are configured for time-change events.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.3

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 5.5 Implement Automated Configuration Monitoring Systems - Utilize a Security Content Automation Protocol (SCAP) compliant configuration monitoring system to verify all security configuration elements, catalog approved exceptions, and alert when unauthorized changes occur. |
