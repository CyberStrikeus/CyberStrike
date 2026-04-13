---
name: cis-apache-3.9
description: "Ensure the Pid File Is Secured"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.9"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Pid File Is Secured

## Description

The `PidFile` directive sets the file path to the process ID (pid) file to which the server records the pid of the server. The pid is useful for sending a signal to the server process or checking on the health of the process.

## Rationale

If the `PidFile` is placed in a writable directory, other accounts could create a denial of service attack and prevent the server from starting by creating a pid file with the same name.

## Impact

None documented

## Audit Procedure

Perform these steps to verify the pid file is secured:

1. Find the directory in which the `PidFile` would be created. The default value is the `ServerRoot/logs` directory.
2. Verify that the process ID file directory is not a directory within the Apache `DocumentRoot`.
3. Verify that the ownership and group of the directory is `root:root` (or the user under which apache initially starts up if not root).
4. Verify the permissions on the directory are only writable by root (or the startup user if not root).

## Remediation

Perform these steps to secure the pid file:

1. Find the directory in which the `PidFile` would be created. The default value is the `ServerRoot/logs` directory.
2. Modify the directory if it is within the Apache `DocumentRoot`.
3. Change the ownership and group of the directory to be `root:root`.
4. Change the permissions for the directory so it is only writable by root, or the user under which apache initially starts up (default is root).

## Default Value

The default process ID file is `logs/httpd.pid`.

## References

1. https://httpd.apache.org/docs/2.2/mod/mpm_common.html#pidfile

## CIS Controls

### Version 6

18 Application Software Security

Application Software Security

### Version 7

14.6 Protect Information through Access Control Lists

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Scored
