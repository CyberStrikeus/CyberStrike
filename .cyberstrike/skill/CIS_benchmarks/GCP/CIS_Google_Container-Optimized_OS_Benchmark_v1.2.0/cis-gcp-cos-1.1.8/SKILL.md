---
name: cis-gcp-cos-1.1.8
description: "Ensure nodev option set on /var partition"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, filesystem, partitions, mount-options, var]
cis_id: "1.1.8"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.8 Ensure nodev option set on /var partition (Automated)

## Description

The `nodev` mount option specifies that the filesystem cannot contain special devices.

## Rationale

Since the `/var` filesystem is not intended to support devices, set this option to ensure that users cannot attempt to create block or character special devices in `/var`.

## Audit Procedure

Verify that the `nodev` option is set if a `/var` partition exists.
Run the following command and verify that nothing is returned:

```bash
# mount | grep -E '\s/var\s' | grep -v nodev
```

## Expected Result

The command should return no output, confirming that the `nodev` option is set on the `/var` partition.

## Remediation

Run the following command to remount `/var`:

```bash
# mount -o remount,nodev /var
```

**Note:** `/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software. | x | x | x |

## Profile

Level 2 - Server | Automated
