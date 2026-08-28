---
name: cis-ubuntu1604-v200-4-1-14
description: "Ensure changes to system administration scope (sudoers) is collected"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.14"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.14

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Monitor scope changes for system administrations. If the system has been properly configured to force system administrators to log in as themselves first and then use the sudo command to execute privileged commands, it is possible to monitor changes in scope. The file /etc/sudoers will be written to when the file or its attributes have changed. The audit records will be tagged with the identifier "scope."

**Note:** Reloading the auditd config to set active settings requires the auditd service to be restarted, and may require a system reboot.

## Rationale

Changes in the /etc/sudoers file can indicate that an unauthorized change has been made to scope of system administrator activity.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands:

```bash
grep scope /etc/audit/rules.d/*.rules
```

```bash
auditctl -l | grep scope
```

Verify output of both matches:

```
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d/ -p wa -k scope
```

## Expected Result

Output of both commands should match the rules listed above.

## Remediation

### Command Line

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules`.

Example: `vi /etc/audit/rules.d/50-scope.rules`

Add the following lines:

```bash
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d/ -p wa -k scope
```

## Default Value

By default, no audit rules are configured for sudoers changes.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.14

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v7               | 4.8 Log and Alert on Changes to Administrative Group Membership - Configure systems to issue a log entry and alert when an account is added to or removed from any group assigned administrative privileges. |
