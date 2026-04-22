---
name: cis-apache24-3.10
description: "Ensure the ScoreBoard File Is Secured"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.10"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.10 Ensure the ScoreBoard File Is Secured

## Profile Applicability

- Level 1

## Description

The `ScoreBoardFile` directive sets a file path which the server will use for inter-process communication (IPC) among the Apache processes. On most Linux platforms, shared memory will be used instead of a file in the file system, so this directive is not generally needed and does not need to be specified. However, if the directive is specified, then Apache will use the configured file for the inter-process communication. Therefore, if it is specified, it needs to be located in a secure directory.

## Rationale

If the `ScoreBoardFile` is placed in a writable directory, other accounts could create a denial of service attack and prevent the server from starting by creating a file with the same name, and users could monitor and disrupt the communication between the processes by reading and writing to the file.

## Audit

1. Check to see if the `ScoreBoardFile` is specified in any of the Apache configuration files. If it is not present, the configuration is compliant.
2. Find the directory in which the `ScoreBoardFile` would be created. The default value is the `ServerRoot/logs` directory.
3. Verify that the scoreboard file directory is not a directory within the Apache `DocumentRoot`
4. Verify that the ownership and group of the directory is `root:root` (or the user under which Apache initially starts up if not `root`).
5. Change the permissions so that the directory is only writable by `root` (or the startup user if not `root`).
6. Check that the scoreboard file directory is on a locally mounted hard drive rather than an NFS mounted file system.

## Remediation

1. Check to see if the `ScoreBoardFile` is specified in any of the Apache configuration files. If it is not present, no changes are required.
2. If the directive is present, find the directory in which the `ScoreBoardFile` would be created. The default value is the `ServerRoot/logs` directory.
3. Modify the directory if the `ScoreBoardFile` is in a directory within the Apache `DocumentRoot`
4. Change the ownership and group to be `root:root`, if not already.
5. Change the permissions so that the directory is only writable by root, or the user under which apache initially starts up (default is `root`),
6. Check that the scoreboard file directory is on a locally mounted hard drive rather than an NFS mounted file system.

## Default Value

The default scoreboard file is `logs/apache_status`.

## References

1. https://httpd.apache.org/docs/2.4/mod/mpm_common.html#scoreboardfile

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

- Level 1 | Manual
