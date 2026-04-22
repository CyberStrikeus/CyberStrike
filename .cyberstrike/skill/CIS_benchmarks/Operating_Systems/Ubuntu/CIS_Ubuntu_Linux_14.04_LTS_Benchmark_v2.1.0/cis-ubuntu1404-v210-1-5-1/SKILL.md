---
name: "CIS Ubuntu 14.04 LTS - 1.5.1 Ensure core dumps are restricted"
description: "Verify that core dumps are restricted to prevent information disclosure from memory dumps"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - hardening
cis_id: "1.5.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.5.1 Ensure core dumps are restricted (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

A core dump is the memory of an executable program. It is generally used to determine why a program aborted. It can also be used to glean confidential information from a core file. The system provides the ability to set a soft limit for core dumps, but this can be overridden by the user.

## Rationale

Setting a hard limit on core dumps prevents users from overriding the soft variable. If core dumps are required, consider setting limits for user groups (see `limits.conf(5)`). In addition, setting the `fs.suid_dumpable` variable to 0 will prevent setuid programs from dumping core.

## Audit Procedure

Run the following commands and verify output matches:

```bash
grep "hard core" /etc/security/limits.conf /etc/security/limits.d/*
# Expected: * hard core 0
sysctl fs.suid_dumpable
# Expected: fs.suid_dumpable = 0
grep "fs\.suid_dumpable" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: fs.suid_dumpable = 0
```

## Expected Result

```
* hard core 0
fs.suid_dumpable = 0
fs.suid_dumpable = 0
```

## Remediation

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

## Default Value

Not applicable.

## Notes

It has been reported that due to Ubuntu bug #50093 this setting (and some others) can fail to apply properly on reboot requiring it to be manually re-applied. One method of accomplishing this is to add `sysctl -p` to run on reboot to your systems crontab.

## References

- CIS Controls: 13 Data Protection

## Profile

- Level 1 - Server
- Level 1 - Workstation
