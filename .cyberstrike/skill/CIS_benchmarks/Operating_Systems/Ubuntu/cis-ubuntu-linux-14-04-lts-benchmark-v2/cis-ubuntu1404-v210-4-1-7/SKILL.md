---
name: "CIS Ubuntu 14.04 LTS - 4.1.7 Ensure events that modify the system's Mandatory Access Controls are collected"
description: "Collect audit events for modifications to SELinux/AppArmor mandatory access controls"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - auditd
  - mac
  - apparmor
  - logging
cis_id: "4.1.7"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.1.7 Ensure events that modify the system's Mandatory Access Controls are collected (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor SELinux/AppArmor mandatory access controls. The parameters below monitor any write access (potential additional, deletion or modification of files in the directory) or attribute changes to the `/etc/selinux` or `/etc/apparmor` and `/etc/apparmor.d` directories.

## Rationale

Changes to files in these directories could indicate that an unauthorized user is attempting to modify access controls and change security contexts, leading to a compromise of the system.

## Audit Procedure

On systems using SELinux run the following commands:

```bash
grep MAC-policy /etc/audit/audit.rules
auditctl -l | grep MAC-policy
```

Verify output of both matches:

```
-w /etc/selinux/ -p wa -k MAC-policy
-w /usr/share/selinux/ -p wa -k MAC-policy
```

On systems using AppArmor run the following commands:

```bash
grep MAC-policy /etc/audit/audit.rules
auditctl -l | grep MAC-policy
```

Verify output of both matches:

```
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

## Expected Result

The audit rules for MAC-policy should be present and active.

## Remediation

On systems using SELinux add the following line to the `/etc/audit/audit.rules` file:

```bash
-w /etc/selinux/ -p wa -k MAC-policy
-w /usr/share/selinux/ -p wa -k MAC-policy
```

On systems using AppArmor add the following line to the `/etc/audit/audit.rules` file:

```bash
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

**Notes:** Reloading the auditd config to set active settings may require a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 3.6 Implement Automated Configuration Monitoring System

## Profile

- Level 2 - Server
- Level 2 - Workstation
