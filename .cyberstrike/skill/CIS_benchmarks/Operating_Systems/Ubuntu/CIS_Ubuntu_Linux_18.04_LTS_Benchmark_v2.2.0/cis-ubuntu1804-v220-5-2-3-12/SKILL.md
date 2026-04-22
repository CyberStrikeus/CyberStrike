---
name: cis-ubuntu1804-v220-5-2-3-12
description: Ensure login and logout events are collected
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# CIS Ubuntu 18.04 - Ensure login and logout events are collected (5.2.3.12)

## Metadata
- **ID**: cis-ubuntu1804-v220-5-2-3-12
- **Title**: Ensure login and logout events are collected
- **CIS Control**: 5.2.3.12
- **Profile Applicability**: Level 2 - Server, Level 2 - Workstation
- **Benchmark**: CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0
- **Category**: cis-logging
- **Tags**: cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Severity**: medium
- **Version**: 2.2.0

## Description
Monitor login and logout events. The parameters below track changes to files associated with login/logout events.

- `/var/log/lastlog` - maintain records of the last time a user successfully logged in
- `/var/run/faillock` - directory maintains records of login failures via the pam_faillock module

## Rationale
Monitoring login/logout events could provide a system administrator with information associated with brute force attacks against user logins.

## Impact
None

## Audit

### On Disk Configuration (64-bit)
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && awk "/^ *-a *always,exit/ \
&&/ -F *logins/ \
&&/ -k *logins/" /etc/audit/rules.d/*.rules \
|| printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

**Expected Output**:
```
-w /var/log/lastlog -p wa -k logins
-w /var/run/faillock -p wa -k logins
```

### Running Configuration (64-bit)
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && auditctl -l | awk "/^ *-a *always,exit/ \
&&/ -F *logins/ \
&&/ -k *logins/"
```

**Expected Output**:
```
-w /var/log/lastlog -p wa -k logins
-w /var/run/faillock -p wa -k logins
```

### 32-bit Systems
Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## Remediation

### Create Audit Rules
Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor login and logout events.

Example:
```bash
printf "
-w /var/log/lastlog -p wa -k logins
-w /var/run/faillock -p wa -k logins
" >> /etc/audit/rules.d/50-login.rules
```

### Load Audit Rules
Merge and load the rules into active configuration:
```bash
augenrules --load
```

Check if reboot is required:
```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

### 32-bit Systems
Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## References
- NIST SP 800-53 Rev. 5: AU-3

## CIS Controls
- **v8**: 8.5 Collect Detailed Audit Logs
- **v7**: 4.9 Log and Alert on Unsuccessful Administrative Account Login, 16.13 Alert on Account Login Behavior Deviation

## MITRE ATT&CK Mappings
- **Techniques**: T1562, T1562.006
- **Tactics**: TA0001
- **Mitigations**: M1047

## Additional Information

### Potential Reboot Required
If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

### System Call Structure
For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.
