---
name: cis-ubuntu1604-v200-4-1-6
description: "Ensure events that modify the system's Mandatory Access Controls are collected"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.6

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Monitor AppArmor mandatory access controls. The parameters below monitor any write access (potential additional, deletion or modification of files in the directory) or attribute changes to /etc/apparmor and /etc/apparmor.d directories.

**Note:** Reloading the auditd config to set active settings requires the auditd service to be restarted, and may require a system reboot.

## Rationale

Changes to files in these directories could indicate that an unauthorized user is attempting to modify access controls and change security contexts, leading to a compromise of the system.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command to verify the rules are contained in a `.rules` file in the `/etc/audit/rules.d/` directory:

```bash
grep MAC-policy /etc/audit/rules.d/*.rules
```

Verify output matches:

```
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

Run the following command to verify that rules are in the running auditd config:

```bash
auditctl -l | grep MAC-policy
```

Verify output matches:

```
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

## Expected Result

Output should match the rules listed above.

## Remediation

### Command Line

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules`.

Example: `vi /etc/audit/rules.d/50-MAC-policy.rules`

Add the following lines:

```bash
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

## Default Value

By default, no audit rules are configured for MAC policy changes.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.6

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 5.5 Implement Automated Configuration Monitoring Systems - Utilize a Security Content Automation Protocol (SCAP) compliant configuration monitoring system to verify all security configuration elements, catalog approved exceptions, and alert when unauthorized changes occur. |
