---
name: cis-ubuntu1204-v110-2-20
description: "Disable Mounting of jffs2 Filesystems"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, jffs2, kernel-module, attack-surface]
cis_id: "2.20"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.20 Disable Mounting of jffs2 Filesystems (Not Scored)

## Profile Applicability
- Level 2

## Description
The `jffs2` (journaling flash filesystem 2) filesystem type is a log-structured filesystem used in flash memory devices.

## Rationale
Removing support for unneeded filesystem types reduces the local attack surface of the server. If this filesystem type is not needed, disable it.

## Audit Procedure
### Using Command Line
```bash
/sbin/modprobe -n -v jffs2
/sbin/lsmod | grep jffs2
```

## Expected Result
The first command should output `install /bin/true`. The second command should produce no output (module not loaded).

## Remediation
### Using Command Line
Edit or create the file `/etc/modprobe.d/CIS.conf` and add the following line:
```
install jffs2 /bin/true
```

## Default Value
By default, the `jffs2` module is available for loading.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 2 - Not Scored
