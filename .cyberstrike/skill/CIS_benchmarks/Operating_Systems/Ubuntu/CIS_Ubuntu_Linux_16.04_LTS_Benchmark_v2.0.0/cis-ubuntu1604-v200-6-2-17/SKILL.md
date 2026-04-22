---
name: cis-ubuntu1604-v200-6-2-17
description: "Ensure shadow group is empty"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.17"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.17

## Profile
- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The shadow group allows system programs which require access the ability to read the /etc/shadow file. No users should be assigned to the shadow group.

## Rationale

Any users assigned to the shadow group would be granted read access to the /etc/shadow file. If attackers can gain read access to the `/etc/shadow` file, they can easily run a password cracking program against the hashed passwords to break them. Other security information that is stored in the `/etc/shadow` file (such as expiration) could also be useful to subvert additional user accounts.

## Audit Procedure

### Command Line

Run the following commands and verify no results are returned:

```bash
grep ^shadow:[^:]*:[^:]*:[^:]+ /etc/group
```

```bash
awk -F: -v GID="$(awk -F: '($1=="shadow") {print $3}' /etc/group)" '($4==GID) {print}' /etc/passwd
```

## Expected Result

No output should be returned from either command.

## Remediation

### Command Line

Remove all users from the shadow group, and change the primary group of any users with shadow as their primary group.

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | | | |
