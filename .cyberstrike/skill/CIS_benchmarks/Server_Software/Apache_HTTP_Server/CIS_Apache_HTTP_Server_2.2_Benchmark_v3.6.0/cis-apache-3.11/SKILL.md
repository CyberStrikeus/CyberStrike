---
name: cis-apache-3.11
description: "Ensure Group Write Access for the Apache Directories and Files Is Properly Restricted"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.11"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Group Write Access for the Apache Directories and Files Is Properly Restricted

## Description

Group permissions on Apache directories should generally be `r-x`, and file permissions should be similar, except not executable if executable is not appropriate. This applies to all the Apache software directories and files installed, with the possible exception of the web document root `$DOCROOT` defined by Apache `DocumentRoot` and defaulting to `$APACHE_PREFIX/htdocs`. The directories and files in the web document root may have a designated web development group with write access to allow web content to be updated.

## Rationale

Restricting write permissions on the Apache files and directories can help mitigate attacks that modify web content to provide unauthorized access or to attack web clients.

## Impact

None documented

## Audit Procedure

Verify that there are no files or directories in the Apache directory with group write access, excluding symbolic links:

```
# find -L $APACHE_PREFIX \! -type l -perm /g=w -ls
```

## Remediation

Perform the following to remove group write access on the `$APACHE_PREFIX` directories:

```
# chmod -R g-w $APACHE_PREFIX
```

## Default Value

None documented

## References

None documented

## CIS Controls

### Version 6

14.4 Protect Information With Access Control Lists

All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

### Version 7

14.6 Protect Information through Access Control Lists

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Scored
