---
name: cis-ubuntu1204-v110-2-1
description: "Create Separate Partition for /tmp"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, partitioning, tmp]
cis_id: "2.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1 Create Separate Partition for /tmp (Scored)

## Profile Applicability

- Level 1

## Description

The `/tmp` directory is a world-writable directory used for temporary storage by all users and some applications.

## Rationale

Since the `/tmp` directory is intended to be world-writable, there is a risk of resource exhaustion if it is not bound to a separate partition. In addition, making `/tmp` its own file system allows an administrator to set the `noexec` option on the mount, making `/tmp` useless for an attacker to install executable code. It would also prevent an attacker from establishing a hardlink to a system `setuid` program and wait for it to be updated. Once the program was updated, the hardlink would be broken and the attacker would have his own copy of the program. If the program happened to have a security vulnerability, the attacker could continue to exploit the known flaw.

## Audit Procedure

### Using Command Line

```bash
grep "[[:space:]]/tmp[[:space:]]" /etc/fstab
```

## Expected Result

A partition entry for `/tmp` should be returned. If the command emits no output then the system is not configured as recommended.

## Remediation

### Using Command Line

For new installations, during installation create a custom partition setup and specify a separate partition for `/tmp`.

For systems that were previously installed, use the Logical Volume Manager (LVM) to create partitions.

## Default Value

By default, Ubuntu does not create a separate partition for `/tmp`.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/

## Profile

Level 1 - Scored
