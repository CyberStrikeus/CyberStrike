---
name: cis-gcp-cos-1.1.12
description: "Ensure noexec option set on /dev/shm partition"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, filesystem, partitions, mount-options, shm]
cis_id: "1.1.12"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.12 Ensure noexec option set on /dev/shm partition (Automated)

## Description

The `noexec` mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Setting this option on a file system prevents users from executing programs from shared memory. This deters users from introducing potentially malicious software on the system.

## Audit Procedure

Verify that the `noexec` option is set if a `/dev/shm` partition exists.
Run the following command and verify that nothing is returned:

```bash
# mount | grep -E '\s/dev/shm\s' | grep -v noexec
```

## Expected Result

The command should return no output, confirming that the `noexec` option is set on the `/dev/shm` partition.

## Remediation

Run the following command to remount `/dev/shm`:

```bash
# mount -o remount,noexec /dev/shm
```

**Note:** `/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.3 Address Unauthorized Software - Ensure that unauthorized software is either removed from use on enterprise assets or receives a documented exception. Review monthly, or more frequently. | x    | x    | x    |
| v7               | 2.6 Address unapproved software - Ensure that unauthorized software is either removed or the inventory is updated in a timely manner.                                                         | x    | x    | x    |

## Profile

Level 1 - Server | Automated
