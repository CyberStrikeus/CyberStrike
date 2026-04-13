---
name: cis-apache-3.10
description: "Ensure the ScoreBoard File Is Secured"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.10"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the ScoreBoard File Is Secured

## Description

The `ScoreBoardFile` directive sets a file path which the server will use for interprocess communication (IPC) among the Apache processes. On most Linux platforms, shared memory will be used instead of a file in the file system, so this directive is not generally needed and does not need to be specified. However, if the directive is specified, Apache will use the configured file for IPC, so it needs to be located in a secure directory.

## Rationale

If the `ScoreBoardFile` is placed in a writable directory, other accounts could create a denial of service attack and prevent the server from starting by creating a file with the same name, and users could monitor and disrupt communication between the processes by reading and writing to the file.

## Impact

None documented

## Audit Procedure

Perform the following steps to verify the ScoreBoard file is secure:

1. Check to see if the `ScoreBoardFile` is specified in any of the Apache configuration files. If it is not present, the configuration is compliant.
2. Find the directory in which the `ScoreBoardFile` would be created. The default value is the `ServerRoot/logs` directory.
3. Verify that the directory is not within the Apache `DocumentRoot`.
4. Verify that the directory is on a locally mounted hard drive rather than an NFS mounted file system.
5. Verify that the ownership and group of the directory is `root:root` (or the user under which Apache initially starts up if not root).
6. Verify that the directory is only writable by root (or the startup user if not root).

## Remediation

Perform the following steps to secure the ScoreBoard file:

1. Check to see if the `ScoreBoardFile` is specified in any of the Apache configuration files. If it is not present, no changes are required.
2. If the directive is present, find the directory in which the `ScoreBoardFile` would be created. The default value is the `ServerRoot/logs` directory.
3. Modify the directory if it is within the Apache `DocumentRoot` or if it is on an NFS mounted file system and not a locally mounted hard drive.
4. Change the directory ownership and group to be `root:root`.
5. Change the directory permissions so it is only writable by root or the user under which apache initially starts up (default is root).

## Default Value

The default scoreboard file is `logs/apache_status`.

## References

1. https://httpd.apache.org/docs/2.2/mod/mpm_common.html#scoreboardfile

## CIS Controls

### Version 6

18 Application Software Security

Application Software Security

### Version 7

14.6 Protect Information through Access Control Lists

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Scored
