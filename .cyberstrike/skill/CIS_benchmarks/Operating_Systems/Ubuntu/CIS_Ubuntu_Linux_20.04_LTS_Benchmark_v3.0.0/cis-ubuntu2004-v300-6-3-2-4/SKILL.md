---
name: cis-ubuntu2004-v300-6-3-2-4
description: "Ensure system warns when audit logs are low on space"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.2.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.2.4 Ensure system warns when audit logs are low on space (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

The `auditd` daemon can be configured to halt the system, put the system in single user mode or send a warning message, if the partition that holds the audit log files is low on space.

The `space_left_action` parameter tells the system what action to take when the system has detected that it is starting to get low on disk space. Valid values are `ignore`, `syslog`, `rotate`, `email`, `exec`, `suspend`, `single`, and `halt`.

The `admin_space_left_action` parameter tells the system what action to take when the system has detected that it is low on disk space. Valid values are `ignore`, `syslog`, `rotate`, `email`, `exec`, `suspend`, `single`, and `halt`.

## Rationale

In high security contexts, the risk of detecting unauthorized access or nonrepudiation exceeds the benefit of the system's availability.

## Impact

If the `admin_space_left_action` is set to `single` the audit daemon will put the computer system in single user mode.

## Audit Procedure

### Command Line

Run the following command and verify the `space_left_action` is set to `email`, `exec`, `single`, or `halt`:

```bash
grep -P -- '^\h*space_left_action\h*=\h*(email|exec|single|halt)\b' /etc/audit/auditd.conf
```

Verify the output is `email`, `exec`, `single`, or `halt`.

Example output:

```
space_left_action = email
```

Run the following command and verify the `admin_space_left_action` is set to `single` - OR - `halt`:

```bash
grep -P -- '^\h*admin_space_left_action\h*=\h*(single|halt)\b' /etc/audit/auditd.conf
```

Verify the output is `single` or `halt`.

Example output:

```
admin_space_left_action = single
```

Note: A Mail Transfer Agent (MTA) must be installed and configured properly to set `space_left_action = email`

## Expected Result

`space_left_action` should be set to `email`, `exec`, `single`, or `halt`. `admin_space_left_action` should be set to `single` or `halt`.

## Remediation

### Command Line

Set the `space_left_action` parameter in `/etc/audit/auditd.conf` to `email`, `exec`, `single`, or `halt`:

Example:

```
space_left_action = email
```

Set the `admin_space_left_action` parameter in `/etc/audit/auditd.conf` to `single` or `halt`:

Example:

```
admin_space_left_action = single
```

Note: A Mail Transfer Agent (MTA) must be installed and configured properly to set `space_left_action = email`

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-8, AU-12, SI-5
2. AUDITD.CONF(5)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v8 | 8.3 Ensure Adequate Audit Log Storage | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |

MITRE ATT&CK Mappings: T1562, T1562.006 / TA0005
