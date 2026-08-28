---
name: cis-ubuntu2004-v300-6-3-3-4
description: "Ensure events that modify date and time information are collected"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.3.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.3.4 Ensure events that modify date and time information are collected (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

Capture events where the system date and/or time has been modified. The parameters in this section are set to determine if the;

- `adjtimex` - tune kernel clock
- `settimeofday` - set time using `timeval` and `timezone` structures
- `stime` - using seconds since 1/1/1970
- `clock_settime` - allows for the setting of several internal clocks and timers

system calls have been executed. Further, ensure to write an audit record to the configured audit log file upon exit, tagging the records with a unique identifier such as "time-change".

## Rationale

Unexpected changes in system date and/or time could be a sign of malicious activity on the system.

## Audit Procedure

### Command Line

On disk configuration - Run the following command to check the on disk rules:

```bash
# {
awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&/ -S/ \
&&(/adjtimex/ \
  ||/settimeofday/ \
  ||/clock_settime/ ) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)' /etc/audit/rules.d/*.rules

awk '/^ *-w/ \
&&/\/etc\/localtime/ \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)' /etc/audit/rules.d/*.rules
}
```

Verify output of matches:

```
-a always,exit -F arch=b64 -S adjtimex,settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex,settimeofday -k time-change
-a always,exit -F arch=b64 -S clock_settime -F a0=0x0 -k time-change
-a always,exit -F arch=b32 -S clock_settime -F a0=0x0 -k time-change
-w /etc/localtime -p wa -k time-change
```

Running configuration - Run the following command to check loaded rules:

```bash
# {
auditctl -l | awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&/ -S/ \
&&(/adjtimex/ \
  ||/settimeofday/ \
  ||/clock_settime/ ) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)'

auditctl -l | awk '/^ *-w/ \
&&/\/etc\/localtime/ \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)'
}
```

Verify the output includes:

```
-a always,exit -F arch=b64 -S adjtimex,settimeofday -F key=time-change
-a always,exit -F arch=b32 -S settimeofday,adjtimex -F key=time-change
-a always,exit -F arch=b64 -S clock_settime -F a0=0x0 -F key=time-change
-a always,exit -F arch=b32 -S clock_settime -F a0=0x0 -F key=time-change
-w /etc/localtime -p wa -k time-change
```

## Expected Result

Both on disk and running configuration should show time-change audit rules.

## Remediation

### Command Line

Create audit rules - Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor events that modify date and time information.

Example:

```bash
# printf "
-a always,exit -F arch=b64 -S adjtimex,settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex,settimeofday -k time-change
-a always,exit -F arch=b64 -S clock_settime -F a0=0x0 -k time-change
-a always,exit -F arch=b32 -S clock_settime -F a0=0x0 -k time-change
-w /etc/localtime -p wa -k time-change
" >> /etc/audit/rules.d/50-time-change.rules
```

Load audit rules - Merge and load the rules into active configuration:

```bash
# augenrules --load
```

Check if reboot is required:

```bash
# if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

## References

1. NIST SP 800-53 Rev. 5: AU-3, CM-6

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs                          |      | X    | X    |
| v7               | 5.5 Implement Automated Configuration Monitoring Systems |      | X    | X    |

MITRE ATT&CK Mappings: T1562, T1562.006 / TA0005 / M1047
