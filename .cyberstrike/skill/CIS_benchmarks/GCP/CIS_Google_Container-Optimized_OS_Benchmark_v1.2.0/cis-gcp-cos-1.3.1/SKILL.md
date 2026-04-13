---
name: cis-gcp-cos-1.3.1
description: "Ensure authentication required for single user mode"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, secure-boot, authentication, single-user-mode]
cis_id: "1.3.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.1 Ensure authentication required for single user mode (Automated)

## Description

Single user mode (rescue mode) is used for recovery when the system detects an issue during boot or by manual selection from the bootloader.

## Rationale

Requiring authentication in single user mode (rescue mode) prevents an unauthorized user from rebooting the system into single user to gain root privileges without credentials.

## Audit Procedure

Run the following commands and verify that `/sbin/sulogin` or `/usr/sbin/sulogin` is used as shown:

```bash
# grep /systemd-sulogin-shell /usr/lib/systemd/system/rescue.service

ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue

# grep /systemd-sulogin-shell /usr/lib/systemd/system/emergency.service

ExecStart=-/usr/lib/systemd/systemd-sulogin-shell emergency
```

## Expected Result

The output should show `ExecStart=-/usr/lib/systemd/systemd-sulogin-shell rescue` for rescue.service and `ExecStart=-/usr/lib/systemd/systemd-sulogin-shell emergency` for emergency.service.

## Remediation

Rootfs is read-only file system. Therefore, update to an OS image which requires single user mode authentication.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 4.7 Manage Default Accounts on Enterprise Assets and Software | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## Profile

Level 1 - Server | Automated
