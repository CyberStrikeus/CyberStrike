---
name: cis-ubuntu1604-v200-1-5-4
description: "Ensure core dumps are restricted"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, core-dumps, hardening, sysctl, limits]
cis_id: "1.5.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.5.4

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

A core dump is the memory of an executable program. It is generally used to determine why a program aborted. It can also be used to glean confidential information from a core file. The system provides the ability to set a soft limit for core dumps, but this can be overridden by the user.

## Rationale

Setting a hard limit on core dumps prevents users from overriding the soft variable. If core dumps are required, consider setting limits for user groups (see `limits.conf(5)`). In addition, setting the `fs.suid_dumpable` variable to 0 will prevent setuid programs from dumping core.

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
grep -Es '^(\*|\s).*hard.*core.*(\s+#.*)?$' /etc/security/limits.conf /etc/security/limits.d/*
```

Expected output: `* hard core 0`

```bash
sysctl fs.suid_dumpable
```

Expected output: `fs.suid_dumpable = 0`

```bash
grep "fs.suid_dumpable" /etc/sysctl.conf /etc/sysctl.d/*
```

Expected output: `fs.suid_dumpable = 0`

Run the following command to check if systemd-coredump is installed:

```bash
systemctl is-enabled coredump.service
```

If `enabled`, `masked`, or `disabled` is returned systemd-coredump is installed.

## Expected Result

Hard core limit should be set to 0, `fs.suid_dumpable` should be 0, and if systemd-coredump is installed it should be configured properly.

## Remediation

### Command Line

Add the following line to `/etc/security/limits.conf` or a `/etc/security/limits.d/*` file:

```
* hard core 0
```

Set the following parameter in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
fs.suid_dumpable = 0
```

Run the following command to set the active kernel parameter:

```bash
sysctl -w fs.suid_dumpable=0
```

**IF** systemd-coredump is installed, edit `/etc/systemd/coredump.conf` and add/modify the following lines:

```
Storage=none
ProcessSizeMax=0
```

Run the command:

```bash
systemctl daemon-reload
```

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 5.1 Establish Secure Configurations |

## Assessment Status

Automated
