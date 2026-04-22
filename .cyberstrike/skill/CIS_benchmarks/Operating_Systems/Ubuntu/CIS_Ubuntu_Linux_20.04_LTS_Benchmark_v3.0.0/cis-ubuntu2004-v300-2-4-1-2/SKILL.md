---
name: cis-ubuntu2004-v300-2-4-1-2
description: "Ensure access to /etc/crontab is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, cron, job-schedulers]
cis_id: "2.4.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure access to /etc/crontab is configured

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The /etc/crontab file is used by cron to control its own jobs. The commands in this item make sure that root is the user and group owner of the file and that only the owner can access the file.

## Rationale

This file contains information on what system jobs are run by cron. Write access to these files could provide unprivileged users with the ability to elevate their privileges. Read access to these files could provide users with the ability to gain insight on system jobs that run on the system and could provide them a way to gain unauthorized privileged access.

## Audit

- IF - cron is installed on the system:

Run the following command and verify Uid and Gid are both 0/root and Access does not grant permissions to group or other:

### Command Line

```bash
# stat -Lc 'Access: (%a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/crontab
```

**Output:**

```
Access: (600/-rw-------) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Remediation

- IF - cron is installed on the system:

Run the following commands to set ownership and permissions on /etc/crontab:

### Command Line

```bash
# chown root:root /etc/crontab
# chmod og-rwx /etc/crontab
```

## Default Value

Access: (644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1053, T1053.003 | TA0002, TA0007 | M1018 |
