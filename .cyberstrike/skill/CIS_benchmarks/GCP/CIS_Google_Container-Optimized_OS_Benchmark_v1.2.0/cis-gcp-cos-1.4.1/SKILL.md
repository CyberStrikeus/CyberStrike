---
name: cis-gcp-cos-1.4.1
description: "Ensure core dumps are restricted"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, core-dumps, process-hardening]
cis_id: "1.4.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4.1 Ensure core dumps are restricted (Automated)

## Description

A core dump is the memory of an executable program. It is generally used to determine why a program aborted. It can also be used to glean confidential information from a core file. The system provides the ability to set a soft limit for core dumps, but this can be overridden by the user.

## Rationale

Setting a hard limit on core dumps prevents users from overriding the soft variable. If core dumps are required, consider setting limits for user groups (see `limits.conf(5)`). In addition, setting the `fs.suid_dumpable` variable to 0 will prevent setuid programs from dumping core.

## Audit Procedure

Run the following commands and verify output matches:

```bash
# grep "hard core" /etc/security/limits.conf /etc/security/limits.d/*
* hard core 0

# sysctl fs.suid_dumpable
fs.suid_dumpable = 0
```

Run the following commands to check if systemd-coredump is installed:

```bash
# systemctl is-enabled systemd-coredump@.service
# systemctl is-enabled systemd-coredump.socket
```

If `static` is returned systemd-coredump is installed.

## Expected Result

- `* hard core 0` should be present in limits.conf or limits.d files.
- `fs.suid_dumpable = 0` should be the output of sysctl.
- systemd-coredump should not be enabled unless properly configured.

## Remediation

Add the following line to `/etc/security/limits.conf` or a `/etc/security/limits.d/*` file:

```
* hard core 0
```

Run the following command to set the active kernel parameter:

```bash
# sysctl -w fs.suid_dumpable=0
```

If systemd-coredump@ is installed, edit `/etc/systemd/coredump.conf` and add/modify the following lines:

```
Storage=none
ProcessSizeMax=0
```

Run the command:

```bash
systemctl daemon-reload
```

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------- | ---- | ---- | ---- |
| v7               | 5.1 Establish Secure Configurations | x    | x    | x    |

## Profile

Level 2 - Server | Automated
