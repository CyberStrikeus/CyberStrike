---
name: cis-ubuntu2004-v300-5-4-2-2
description: "Ensure root is the only GID 0 account"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.2.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2.2 Ensure root is the only GID 0 account (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `usermod` command can be used to specify which group the `root` account belongs to. This affects permissions of files that are created by the `root` account.

## Rationale

Using GID 0 for the `root` account helps prevent `root`-owned files from accidentally becoming accessible to non-privileged users.

## Audit Procedure

### Command Line

Run the following command to verify the `root` user's primary GID is 0, and no other user's have GID 0 as their primary GID:

```bash
# awk -F: '($1 !~ /^(sync|shutdown|halt|operator)/ && $4=="0") {print $1":"$4}' /etc/passwd
```

## Expected Result

```
root:0
```

Note: User's: sync, shutdown, halt, and operator are excluded from the check for other user's with GID 0

## Remediation

### Command Line

Run the following command to set the `root` user's GID to 0:

```bash
# usermod -g 0 root
```

Run the following command to set the `root` group's GID to 0:

```bash
# groupmod -g 0 root
```

Remove any users other than the `root` user with GID 0 or assign them a new GID if appropriate.

## Default Value

None specified.

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists: Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. (IG 1, IG 2, IG 3)

v7 - 14.6 Protect Information through Access Control Lists: Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1548, T1548.000 - Tactics: TA0005 - Mitigations: M1026
