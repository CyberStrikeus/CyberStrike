---
name: cis-ubuntu2004-v300-1-5-3
description: "Ensure core dumps are restricted"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, core-dumps, hardening, sysctl]
cis_id: "1.5.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.3 Ensure core dumps are restricted (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

A core dump is the memory of an executable program. It is generally used to determine why a program aborted. It can also be used to glean confidential information from a core file. The system provides the ability to set a soft limit for core dumps, but this can be overridden by the user.

## Rationale

Setting a hard limit on core dumps prevents users from overriding the soft variable. If core dumps are required, consider setting limits for user groups (see `limits.conf(5)`). In addition, setting the `fs.suid_dumpable` variable to 0 will prevent setuid programs from dumping core.

## Audit Procedure

### Command Line

Run the following command and verify output matches:

```bash
# grep -Ps -- '^\h*\*\h+hard\h+core\h+0\b' /etc/security/limits.conf /etc/security/limits.d/*
```

```
* hard core 0
```

Run the following script to verify `fs.suid_dumpable = 0`:

Run the following script to verify the following kernel parameter is set in the running configuration and correctly loaded from a kernel parameter configuration file:

- `fs.suid_dumpable` is set to `0`

Run the following command to check if systemd-coredump is installed:

```bash
# systemctl list-unit-files | grep coredump
```

If anything is returned `systemd-coredump` is installed.

- IF - `systemd-coredump` is installed, then run the following command and verify output matches:

```bash
# grep -Psi -- '^\s*Storage\s*=\s*none\s*$' /etc/systemd/coredump.conf
```

```
Storage=none
```

```bash
# grep -Psi -- '^\s*ProcessSizeMax\s*=\s*0' /etc/systemd/coredump.conf
```

```
ProcessSizeMax=0
```

## Expected Result

- `* hard core 0` should be set in limits.conf
- `fs.suid_dumpable` should be set to `0`
- If systemd-coredump is installed, `Storage=none` and `ProcessSizeMax=0` should be set

## Remediation

### Command Line

Add the following line to `/etc/security/limits.conf` or a `/etc/security/limits.d/*` file:

```
* hard core 0
```

Set the following parameter in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `fs.suid_dumpable = 0`

Example:

```bash
# printf "\n%s" "fs.suid_dumpable = 0" >> /etc/sysctl.d/60-fs_sysctl.conf
```

Run the following command to set the active kernel parameter:

```bash
# sysctl -w fs.suid_dumpable=0
```

Note: If these settings appear in a canonically later file, or later in the same file, these settings will be overwritten.

- IF - `systemd-coredump` is installed: edit `/etc/systemd/coredump.conf` and add/modify the following lines:

```
Storage=none
ProcessSizeMax=0
```

Run the command:

```bash
systemctl daemon-reload
```

## References

1. NIST SP 800-53 Rev. 5: CM-6

MITRE ATT&CK Mappings: T1005, T1005.000 | TA0007 | M1057
