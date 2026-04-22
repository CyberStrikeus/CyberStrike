---
name: cis-ubuntu1804-v220-5-2-3-4
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure events that modify date and time information are collected
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.4 Ensure events that modify date and time information are collected

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Capture events where the system date and/or time has been modified. The parameters in this section are set to determine if the:

- `adjtimex` - tune kernel clock
- `settimeofday` - set time using `timeval` and `timezone` structures
- `stime` - using seconds since 1/1/1970
- `clock_settime` - allows for the setting of several internal clocks and timers

system calls have been executed. Further, ensure to write an audit record to the configured audit log file upon exit, tagging the records with a unique identifier such as "time-change".

## Rationale

Unexpected changes in system date and/or time could be a sign of malicious activity on the system.

## Audit

### 64 Bit systems

#### On disk configuration

Run the following command to check the on disk rules:

```bash
awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&/ -S/ \
&&(/adjtimex/ \
 ||/settimeofday/ \
 ||/clock_settime/ ) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/' /etc/audit/rules.d/*.rules

awk '/^ *-w/ \
&&/\/etc\/localtime/ \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/' /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-a always,exit -F arch=b64 -S adjtimex,settimeofday,clock_settime -k time-change
-a always,exit -F arch=b32 -S adjtimex,settimeofday,clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
```

#### Running configuration

Run the following command to check loaded rules:

```bash
auditctl -l | awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&/ -S/ \
&&(/adjtimex/ \
 ||/settimeofday/ \
 ||/clock_settime/ ) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/'

auditctl -l | awk '/^ *-w/ \
&&/\/etc\/localtime/ \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/'
```

Verify the output includes:

```
-a always,exit -F arch=b64 -S adjtimex,settimeofday,clock_settime -F key=time-change
-a always,exit -F arch=b32 -S adjtimex,settimeofday,clock_settime -F key=time-change
-w /etc/localtime -p wa -k time-change
```

### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`. In addition, also audit for the `stime` system call rule. For example:

```
-a always,exit -F arch=b32 -S adjtimex,settimeofday,clock_settime,stime -k time-change
```

## Remediation

### Create audit rules

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor events that modify date and time information.

#### 64 Bit systems

Example:

```bash
printf "
-a always,exit -F arch=b64 -S adjtimex,settimeofday,clock_settime -k time-change
-a always,exit -F arch=b32 -S adjtimex,settimeofday,clock_settime -k time-change
-w /etc/localtime -p wa -k time-change
" >> /etc/audit/rules.d/50-time-change.rules
```

### Load audit rules

Merge and load the rules into active configuration:

```bash
augenrules --load
```

Check if reboot is required:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

#### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`. In addition, add `stime` to the system call audit. Example:

```
-a always,exit -F arch=b32 -S adjtimex,settimeofday,clock_settime,stime -k time-change
```

## References

- NIST SP 800-53 Rev. 5: AU-3, CM-6

## CIS Controls

| Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8      | 8.5 Collect Detailed Audit Logs                          |      | ●    | ●    |
| v7      | 5.5 Implement Automated Configuration Monitoring Systems |      | ●    | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1562, T1562.006            | TA0005  | M1047       |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination.
