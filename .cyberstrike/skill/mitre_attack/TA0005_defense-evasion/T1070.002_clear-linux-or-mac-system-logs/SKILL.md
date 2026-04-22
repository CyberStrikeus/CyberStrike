---
name: "T1070.002_clear-linux-or-mac-system-logs"
description: "Adversaries may clear system logs to hide evidence of an intrusion."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1070.002
  - defense-evasion
  - linux
  - macos
  - sub-technique
technique_id: "T1070.002"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1070/002"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-693
chains_with:
  - T1070
  - T1070.001
  - T1070.003
  - T1070.004
  - T1070.005
  - T1070.006
  - T1070.007
  - T1070.008
  - T1070.009
  - T1070.010
prerequisites:
  - T1070
severity_boost:
  T1070: "Chain with T1070 for deeper attack path"
  T1070.001: "Chain with T1070.001 for deeper attack path"
  T1070.003: "Chain with T1070.003 for deeper attack path"
---

# T1070.002 Clear Linux or Mac System Logs

> **Sub-technique of:** T1070

## High-Level Description

Adversaries may clear system logs to hide evidence of an intrusion. macOS and Linux both keep track of system or user-initiated actions via system logs. The majority of native system logging is stored under the <code>/var/log/</code> directory. Subfolders in this directory categorize logs by their related functions, such as:

- <code>/var/log/messages:</code>: General and system-related messages
- <code>/var/log/secure</code> or <code>/var/log/auth.log</code>: Authentication logs
- <code>/var/log/utmp</code> or <code>/var/log/wtmp</code>: Login records
- <code>/var/log/kern.log</code>: Kernel logs
- <code>/var/log/cron.log</code>: Crond logs
- <code>/var/log/maillog</code>: Mail server logs
- <code>/var/log/httpd/</code>: Web server access and error logs

## Kill Chain Phase

- Defense Evasion (TA0005)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Clear Linux or Mac System Logs technique is applicable to target environment
- [ ] Check Linux systems for indicators of Clear Linux or Mac System Logs
- [ ] Check macOS systems for indicators of Clear Linux or Mac System Logs
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: rm -rf

Delete system and audit logs

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
sudo rm -rf #{syslog_path}
if [ -d /var/audit ] ; then sudo rm -rf #{macos_audit_path} ; fi
```

**Dependencies:**

- target files must exist

### Atomic Test 2: rm -rf

Delete messages and security logs

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
rm -rf /var/log/messages
rm -rf /var/log/security
```

### Atomic Test 3: Delete log files using built-in log utility

This test deletes main log datastore, inflight log data, time-to-live data(TTL), fault and error content

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo log erase --all
sudo log erase --ttl #Deletes only time-to-live log content
```

### Atomic Test 4: Truncate system log files via truncate utility

This test truncates the system log files using the truncate utility with (-s 0) parameter which sets file size to zero, thus emptying the file content

**Supported Platforms:** macos
**Elevation Required:** Yes

```bash
sudo truncate -s 0 #{system_log_path} #size parameter shorthand
```

**Dependencies:**

- target files must exist

### Atomic Test 5: Truncate system log files via truncate utility (freebsd)

This test truncates the system log files using the truncate utility with (-s 0 or --size=0) parameter which sets file size to zero, thus emptying the file content

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
truncate -s 0 /var/log/messages #size parameter shorthand
truncate --size=0 /var/log/security #size parameter
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Clear Linux or Mac System Logs by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1070.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1029 Remote Data Storage

Automatically forward events to a log server or data repository to prevent conditions in which the adversary can locate and manipulate data on the local system. When possible, minimize time delay on event reporting to avoid prolonged storage on the local system.

### M1022 Restrict File and Directory Permissions

Protect generated event files that are stored locally with proper permissions and authentication and limit opportunities for adversaries to increase privileges by preventing Privilege Escalation opportunities.

### M1041 Encrypt Sensitive Information

Obfuscate/encrypt event files locally and in transit to avoid giving feedback to an adversary.

## Detection

### Behavioral Detection of Log File Clearing on Linux and macOS

## Risk Assessment

| Finding                                             | Severity | Impact          |
| --------------------------------------------------- | -------- | --------------- |
| Clear Linux or Mac System Logs technique applicable | Low      | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Linux Logs](https://www.eurovps.com/blog/important-linux-log-files-you-must-be-monitoring/)
- [Atomic Red Team - T1070.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1070.002)
- [MITRE ATT&CK - T1070.002](https://attack.mitre.org/techniques/T1070/002)
