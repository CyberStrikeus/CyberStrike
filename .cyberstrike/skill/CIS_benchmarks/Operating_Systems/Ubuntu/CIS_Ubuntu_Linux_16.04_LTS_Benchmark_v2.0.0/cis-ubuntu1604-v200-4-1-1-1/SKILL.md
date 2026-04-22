---
name: cis-ubuntu1604-v200-4-1-1-1
description: "Ensure auditd is installed"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.1.1

## Profile
- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

auditd is the userspace component to the Linux Auditing System. It's responsible for writing audit records to the disk.

## Rationale

The capturing of system events provides system administrators with information to allow them to determine if unauthorized access to their system is occurring.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command and verify auditd is installed:

```bash
dpkg -s auditd audispd-plugins
```

## Expected Result

The command should return package status information for both `auditd` and `audispd-plugins`, indicating they are installed.

## Remediation

### Command Line

Run the following command to install auditd:

```bash
apt install auditd audispd-plugins
```

## Default Value

auditd is not installed by default.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.1.1

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
