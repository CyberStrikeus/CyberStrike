---
name: cis-ubuntu2004-v300-2-4-1-7
description: "Ensure access to /etc/cron.yearly is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, cron, job-schedulers]
cis_id: "2.4.1.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure access to /etc/cron.yearly is configured

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The /etc/cron.yearly directory contains system cron jobs that need to run on an annual basis. The files in this directory cannot be manipulated by the crontab command but are instead edited by system administrators using a text editor. The commands below restrict read/write and search access to user and group root, preventing regular users from accessing this directory.

## Rationale

Granting write access to this directory for non-privileged users could provide them the means for gaining unauthorized elevated privileges. Granting read access to this directory could give an unprivileged user insight in how to gain elevated privileges or circumvent auditing controls.

## Audit

- IF - cron is installed on the system:

Run the following command and verify Uid and Gid are both 0/root and Access does not grant permissions to group or other:

### Command Line

```bash
# stat -Lc 'Access: (%a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/cron.yearly/
```

**Output:**

```
Access: (700/drwx------) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Remediation

- IF - cron is installed on the system:

Run the following commands to set ownership and permissions on the /etc/cron.yearly directory:

### Command Line

```bash
# chown root:root /etc/cron.yearly/
# chmod og-rwx /etc/cron.yearly/
```

## Default Value

Access: (755/drwxr-xr-x) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. NIST SP 800-53 Rev. 5: AC-3. MP-2

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1053, T1053.003 | TA0002, TA0007 | M1018 |
