---
name: cis-ubuntu1204-v110-12-5
description: "Verify User/Group Ownership on /etc/shadow"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, file-ownership, shadow, access-control, passwords]
cis_id: "12.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.5 Verify User/Group Ownership on /etc/shadow (Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/shadow` file contains the one-way cipher text passwords for each user defined in the `/etc/passwd` file. The command below sets the user and group ownership of the file to root.

## Rationale

If attackers can gain read access to the `/etc/shadow` file, they can easily run a password cracking program against the hashed password to break it. Other security information that is stored in the `/etc/shadow` file (such as expiration) could also be useful to subvert the user accounts.

## Audit Procedure

### Using Command Line

Run the following command to determine the ownership of the `/etc/shadow` file. Ensure it is owned by user root, and group root or shadow.

```bash
/bin/ls -l /etc/shadow
```

## Expected Result

```
-rw-r----- 1 root shadow <size> <date> shadow
```

Owner should be `root` and group should be `root` or `shadow`.

## Remediation

### Using Command Line

If the ownership of the `/etc/shadow` file is incorrect, run the following command to correct them:

```bash
/bin/chown root:shadow /etc/shadow
```

## Default Value

root:shadow

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
