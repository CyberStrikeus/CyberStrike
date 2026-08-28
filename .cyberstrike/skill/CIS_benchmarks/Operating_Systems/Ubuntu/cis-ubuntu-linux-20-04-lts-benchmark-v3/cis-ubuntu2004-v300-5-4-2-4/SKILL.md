---
name: cis-ubuntu2004-v300-5-4-2-4
description: "Ensure root account access is controlled"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.2.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2.4 Ensure root account access is controlled (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

There are a number of methods to access the root account directly. Without a password set any user would be able to gain access and thus control over the entire system.

## Rationale

Access to `root` should be secured at all times.

## Impact

If there are any automated processes that relies on access to the root account without authentication, they will fail after remediation.

## Audit Procedure

### Command Line

Run the following command to verify that either the root user's password is set or the root user's account is locked:

```bash
# passwd -S root | awk '$2 ~ /^(P|L)/ {print "User: \"" $1 "\" Password is status: " $2}'
```

Verify the output is either:

```
User: "root" Password is status: P
- OR -
User: "root" Password is status: L
```

Note:

- `P` - Password is set
- `L` - Password is locked

## Expected Result

Output should show root password status as either `P` (set) or `L` (locked).

## Remediation

### Command Line

Run the following command to set a password for the `root` user:

```bash
# passwd root
```

- OR -

Run the following command to lock the `root` user account:

```bash
# usermod -L root
```

## Default Value

None specified.

## References

None specified.

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists: Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. (IG 1, IG 2, IG 3)

v7 - 14.6 Protect Information through Access Control Lists: Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1078 - Tactics: TA0005 - Mitigations: M1026
