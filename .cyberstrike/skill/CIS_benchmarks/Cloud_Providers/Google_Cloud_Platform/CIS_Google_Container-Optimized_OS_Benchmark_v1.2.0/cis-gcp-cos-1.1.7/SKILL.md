---
name: cis-gcp-cos-1.1.7
description: "Ensure noexec option set on /var partition"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, filesystem, partitions, mount-options, var]
cis_id: "1.1.7"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.7 Ensure noexec option set on /var partition (Automated)

## Description

The `noexec` mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Since the `/var` filesystem is only intended for services to write data and not execute, set this option to ensure that users cannot run executable binaries from `/var`.

## Audit Procedure

Verify that the `noexec` option is set if a `/var` partition exists.
Run the following command and verify that nothing is returned:

```bash
# mount | grep -E '\s/var\s' | grep -v noexec
```

## Expected Result

The command should return no output, confirming that the `noexec` option is set on the `/var` partition.

## Remediation

Run the following command to remount `/var`:

```bash
# mount -o remount,noexec /var
```

**Note:** `/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.3 Address Unauthorized Software - Ensure that unauthorized software is either removed from use on enterprise assets or receives a documented exception. Review monthly, or more frequently. | x    | x    | x    |
| v7               | 2.6 Address unapproved software - Ensure that unauthorized software is either removed or the inventory is updated in a timely manner.                                                         | x    | x    | x    |

## Profile

Level 2 - Server | Automated
