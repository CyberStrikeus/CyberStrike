---
name: cis-gcp-cos-5.3.3
description: "Ensure default group for the root account is GID 0"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, shadow, user-accounts, umask]
cis_id: "5.3.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3 Ensure default group for the root account is GID 0 (Automated)

## Description

The usermod command can be used to specify which group the root user belongs to. This affects permissions of files that are created by the root user.

## Rationale

Using GID 0 for the `root` account helps prevent `root`-owned files from accidentally becoming accessible to non-privileged users.

## Audit Procedure

Run the following command and verify the result is `0`:

```bash
# grep "^root:" /etc/passwd | cut -f4 -d:
0
```

## Expected Result

The command should return `0`, confirming that root's default group is GID 0.

## Remediation

Run the following command to set the `root` user default group to GID `0`:

```bash
# usermod -g 0 root
```

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **3.3 Configure Data Access Control Lists** - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x    | x    | x    |
| v7               | **5.1 Establish Secure Configurations** - Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                         | x    | x    | x    |

## Profile

- Level 1 - Server
