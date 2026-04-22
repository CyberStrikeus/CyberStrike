---
name: cis-ubuntu1604-v200-5-5-3
description: "Ensure default group for the root account is GID 0"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure default group for the root account is GID 0

**Profile Applicability:**

- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The `usermod` command can be used to specify which group the root user belongs to. This affects permissions of files that are created by the root user.

## Rationale

Using GID 0 for the `root` account helps prevent `root`-owned files from accidentally becoming accessible to non-privileged users.

## Audit Procedure

### Command Line

Run the following command and verify the result is `0`:

```bash
grep "^root:" /etc/passwd | cut -f4 -d:
```

**Expected output:**

```
0
```

## Remediation

### Command Line

Run the following command to set the `root` user default group to GID `0`:

```bash
usermod -g 0 root
```

## References

None

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v7               | 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
