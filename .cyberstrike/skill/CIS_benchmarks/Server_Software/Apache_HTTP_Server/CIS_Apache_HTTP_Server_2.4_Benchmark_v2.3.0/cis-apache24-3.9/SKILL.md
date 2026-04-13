---
name: cis-apache24-3.9
description: "Ensure the Pid File Is Secured"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.9"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.9 Ensure the Pid File Is Secured

## Profile Applicability
- Level 1

## Description

The `PidFile` directive sets the file path to the process ID file to which the server records the process id of the server, which is useful for sending a signal to the server process or for checking on the health of the process.

## Rationale

If the `PidFile` is placed in a writable directory, other accounts could create a denial of service attack and prevent the server from starting by creating a PID file with the same name.

## Audit

1. Find the directory in which the `PidFile` would be created. The default value is the `ServerRoot/logs` directory.
2. Verify that the process ID file directory is not a directory within the Apache `DocumentRoot`
3. Verify that the ownership and group of the directory is `root:root` (or the user under which Apache initially starts up if not `root`).
4. Verify the permissions on the directory are only writable by root (or the startup user if not `root`).

## Remediation

1. Find the directory in which the `PidFile` would be created. The default value is the `ServerRoot/logs` directory.
2. Modify the directory if the `PidFile` is in a directory within the Apache `DocumentRoot`.
3. Change the ownership and group to be `root:root`, if not already.
4. Change the permissions so that the directory is only writable by root, or the user under which Apache initially starts up (default is root).

## Default Value

The default process ID file is `logs/httpd.pid`.

## References

1. https://httpd.apache.org/docs/2.4/mod/mpm_common.html#pidfile

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## Profile
- Level 1 | Manual
