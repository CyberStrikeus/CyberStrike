---
name: cis-ubuntu1204-v110-2-6
description: "Bind Mount the /var/tmp directory to /tmp"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, bind-mount, var-tmp, tmp]
cis_id: "2.6"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.6 Bind Mount the /var/tmp directory to /tmp (Scored)

## Profile Applicability
- Level 1

## Description
The `/var/tmp` directory is normally a standalone directory in the `/var` file system. Binding `/var/tmp` to `/tmp` establishes an unbreakable link to `/tmp` that cannot be removed (even by the root user). It also allows `/var/tmp` to inherit the same mount options that `/tmp` owns, allowing `/var/tmp` to be protected in the same manner `/tmp` is protected. It will also prevent `/var` from filling up with temporary files as the contents of `/var/tmp` will actually reside in the file system containing `/tmp`.

## Rationale
All programs that use `/var/tmp` and `/tmp` to read/write temporary files will always be written to the `/tmp` file system, preventing a user from running the `/var` file system out of space or trying to perform operations that have been blocked in the `/tmp` filesystem.

## Audit Procedure
### Using Command Line
```bash
grep -e "^/tmp" /etc/fstab | grep /var/tmp
mount | grep -e "^/tmp" | grep /var/tmp
```

## Expected Result
The expected output is:
```
/tmp /var/tmp none bind 0 0
/tmp on /var/tmp type none (rw,bind)
```
If the above commands emit no output then the system is not configured as recommended.

## Remediation
### Using Command Line
```bash
mount --bind /tmp /var/tmp
```
Edit the `/etc/fstab` file to contain the following line:
```
/tmp /var/tmp none bind 0 0
```

## Default Value
By default, `/var/tmp` is not bind mounted to `/tmp`.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
