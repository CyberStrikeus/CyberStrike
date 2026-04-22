---
name: cis-ubuntu1804-v220-4-1-9
description: "Ensure at is restricted to authorized users"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, cron, scheduling]
cis_id: "4.1.9"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.1.9

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Configure `/etc/at.allow` to allow specific users to use the at service. If `/etc/at.allow` does not exist, then `/etc/at.deny` is checked. Any user not specifically defined in this file is allowed to use at. By removing the file, only users in `/etc/at.allow` are allowed to use at.

Note: Even though a given user is not listed in `at.allow`, at jobs can still be run as that user.

The `at.allow` file only controls administrative access to the at command for scheduling and modifying at jobs.

## Rationale

On many systems, only the system administrator is authorized to schedule at jobs. Using the `at.allow` file to control who can run at jobs enforces this policy. It is easier to manage an allow list than a deny list. In a deny list, you could potentially add a user ID to the system and forget to add it to the deny files.

## Audit Procedure

### Command Line

Run the following commands and verify that `/etc/at.deny` does not exist, `/etc/at.allow` exists, and the permissions and ownership are correct:

```bash
stat -c "%a %U %G" /etc/at.allow
stat /etc/at.deny
```

### Expected Result

`/etc/at.allow` should exist with permissions `640` or more restrictive, owned by `root:root`.

`/etc/at.deny` should not exist (stat should return "No such file or directory").

## Remediation

### Command Line

Run the following commands to remove `/etc/at.deny`, create `/etc/at.allow`, and set the permissions:

```bash
rm -f /etc/at.deny
touch /etc/at.allow
chmod g-wx,o-rwx /etc/at.allow
chown root:root /etc/at.allow
```

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

v7 - 14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
