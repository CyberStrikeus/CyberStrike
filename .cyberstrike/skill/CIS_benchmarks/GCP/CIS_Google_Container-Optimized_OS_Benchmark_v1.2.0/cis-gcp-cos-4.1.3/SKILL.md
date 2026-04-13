---
name: cis-gcp-cos-4.1.3
description: "Ensure permissions on all logfiles are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, logging, log-files, auditing]
cis_id: "4.1.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1.3 Ensure permissions on all logfiles are configured (Automated)

## Description

Log files stored in /var/log/ contain logged information from many services on the system, or on log hosts others as well.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Audit Procedure

Run the following command and verify that other has no permissions on any files and group does not have write or execute permissions on any files:

```bash
# find /var/log -type f -ls
```

## Expected Result

The output should show that no files have permissions allowing other users to read, write, or execute, and group does not have write or execute permissions.

## Remediation

Run the following commands to set permissions on all existing log files:

```bash
find /var/log -type f -exec chmod g-wx,o-rwx "{}" + -o -type d -exec chmod g-w,o-rwx "{}" +
```

## Default Value

You may also need to change the configuration for your logging software or services for any logs that had incorrect permissions.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **3.3 Configure Data Access Control Lists** - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x | x | x |
| v7 | **5.1 Establish Secure Configurations** - Maintain documented, standard security configuration standards for all authorized operating systems and software. | x | x | x |

## Profile

- Level 2 - Server
