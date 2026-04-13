---
name: cis-gcp-cos-1.1.11
description: "Ensure nosuid option set on /dev/shm partition"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, filesystem, partitions, mount-options, shm]
cis_id: "1.1.11"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.11 Ensure nosuid option set on /dev/shm partition (Automated)

## Description

The `nosuid` mount option specifies that the filesystem cannot contain `setuid` files.

## Rationale

Setting this option on a file system prevents users from introducing privileged programs onto the system and allowing non-root users to execute them.

## Audit Procedure

Verify that the `nosuid` option is set if a `/dev/shm` partition exists.
Run the following command and verify that nothing is returned:

```bash
# mount | grep -E '\s/dev/shm\s' | grep -v nosuid
```

## Expected Result

The command should return no output, confirming that the `nosuid` option is set on the `/dev/shm` partition.

## Remediation

Run the following command to remount `/dev/shm`:

```bash
# mount -o remount,nosuid /dev/shm
```

**Note:** `/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | 5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software. | x | x | x |

## Profile

Level 1 - Server | Automated
