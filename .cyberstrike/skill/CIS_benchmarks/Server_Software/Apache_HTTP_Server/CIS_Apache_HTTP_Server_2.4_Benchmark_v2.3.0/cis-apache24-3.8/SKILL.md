---
name: cis-apache24-3.8
description: "Ensure the Lock File Is Secured"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.8"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.8 Ensure the Lock File Is Secured

## Profile Applicability

- Level 1

## Description

The `Mutex` directive sets the locking mechanism used to serialize access to resources. It may be used to specify that a lock file be used with the `fcntl(2)` or `flock(2)` system calls. Most Linux systems will default to using semaphores instead, so the directive may not apply. However, in the event a lock file is used, it is important for the lock file to be in a local directory that is not writable by other users.

## Rationale

If the lock file to be used as a mutex is placed in a writable directory, other accounts could create a denial of service attack and prevent the server from starting by creating a lock file with the same name.

## Audit

Verify the configuration does NOT include a `Mutex` directive with the mechanism of `fcntl`, `flock` or `file`.

If one of the file locking mechanisms is configured, then find the directory in which the lock file would be created. The default value is the `ServerRoot/logs` directory.

1. Verify that the lock file directory is not a directory within the Apache `DocumentRoot`
2. Verify that the ownership and group of the directory is `root:root` (or the user under which Apache initially starts up if not `root`).
3. Verify the permissions on the directory are only writable by root (or the startup user if not `root`),
4. Check that the lock file directory is on a locally mounted hard drive rather than an NFS mounted file system

## Remediation

Find the directory path in which the lock file would be created. The default value is the `ServerRoot/logs` directory.

1. Modify the directory if the path is a directory within the Apache `DocumentRoot`
2. Change the ownership and group to be `root:root`, if not already.
3. Change the permissions so that the directory is only writable by root, or the user under which Apache initially starts up (default is `root`),
4. Check that the lock file directory is on a locally mounted hard drive rather than an NFS mounted file system.

## Default Value

The default mechanism for the `Mutex` directive is platform specific and may be determined by running `httpd -V`. The default path is the `ServerRoot/logs` directory.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#mutex

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

- Level 1 | Manual
