---
name: cis-ubuntu1604-v200-4-1-13
description: "Ensure file deletion events by users are collected"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.13"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.13

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Monitor the use of system calls associated with the deletion or renaming of files and file attributes. This configuration statement sets up monitoring for the unlink (remove a file), unlinkat (remove a file attribute), rename (rename a file) and renameat (rename a file attribute) system calls and tags them with the identifier "delete".

**Note:**

- At a minimum, configure the audit system to collect file deletion events for all users and root.
- Reloading the auditd config to set active settings requires the auditd service to be restarted, and may require a system reboot.

## Rationale

Monitoring these calls from non-privileged users could provide a system administrator with evidence that inappropriate removal of files and file attributes associated with protected files is occurring. While this audit option will look at all events, system administrators will want to look for specific privileged files that are being deleted or altered.

## Impact

None.

## Audit Procedure

### Command Line

**On a 32 bit system:**

Run the following command to verify the rules are contained in a `.rules` file in the `/etc/audit/rules.d/` directory:

```bash
grep delete /etc/audit/rules.d/*.rules
```

Verify output matches:

```
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
```

Run the following command to verify that rules are in the running auditd config:

```bash
auditctl -l | grep delete
```

Verify output matches:

```
-a always,exit -F arch=b32 -S unlink,rename,unlinkat,renameat -F auid>=1000 -F auid!=-1 -F key=delete
```

**On a 64 bit system:**

Run the following command to verify the rules are contained in a `.rules` file in the `/etc/audit/rules.d/` directory:

```bash
grep delete /etc/audit/rules.d/*.rules
```

Verify output matches:

```
-a always,exit -F arch=b64 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
```

Run the following command to verify that rules are in the running auditd config:

```bash
auditctl -l | grep delete
```

Verify output matches:

```
-a always,exit -F arch=b64 -S rename,unlink,unlinkat,renameat -F auid>=1000 -F auid!=-1 -F key=delete
-a always,exit -F arch=b32 -S unlink,rename,unlinkat,renameat -F auid>=1000 -F auid!=-1 -F key=delete
```

## Expected Result

Output should match the rules listed above for the appropriate architecture.

## Remediation

### Command Line

**For 32 bit systems:** Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules`.

Example: `vi /etc/audit/rules.d/50-delete.rules`

Add the following lines:

```bash
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
```

**For 64 bit systems:** Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules`.

Example: `vi /etc/audit/rules.d/50-delete.rules`

Add the following lines:

```bash
-a always,exit -F arch=b64 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
```

**Additional Information:** Systems may have been customized to change the default UID_MIN. To confirm the UID_MIN for your system, run the following command:

```bash
awk '/^\s*UID_MIN/{print $2}' /etc/login.defs
```

If your systems' UID_MIN is not 1000, replace `auid>=1000` with `auid>=<UID_MIN for your system>` in the Audit and Remediation procedures.

## Default Value

By default, no audit rules are configured for file deletion events.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.13

## CIS Controls

| Controls Version | Control                              |
| ---------------- | ------------------------------------ |
| v7               | 13 Data Protection - Data Protection |
