---
name: cis-apache24-3.11
description: "Ensure Group Write Access for the Apache Directories and Files Is Properly Restricted"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.11"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.11 Ensure Group Write Access for the Apache Directories and Files Is Properly Restricted

## Profile Applicability

- Level 1

## Description

Group permissions on Apache directories should generally be `r-x` and file permissions should be similar except not executable is more appropriate. This applies to all of the Apache software directories and files installed with the possible exception of the web document root `$DOCROOT` defined by Apache `DocumentRoot` and defaults to `$APACHE_PREFIX/htdocs`. The directories and files in the web document root may have a designated web development group with write access to allow web content to be updated.

## Rationale

Restricting write permissions on the Apache files and directories can help mitigate attacks that modify web content to provide unauthorized access, or to attack web clients.

## Audit

Identify files or directories in the Apache directory with group write access, excluding symbolic links:

```bash
# find -L $APACHE_PREFIX \! -type l -perm /g=w -ls
```

## Remediation

Perform the following to remove group write access on the `$APACHE_PREFIX` directories.

```bash
find -L $APACHE_PREFIX ! -type l -perm /g=w -exec chmod g-w {} \;
```

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

- Level 1 | Manual
