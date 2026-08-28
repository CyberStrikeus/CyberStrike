---
name: cis-apache24-3.12
description: "Ensure Group Write Access for the Document Root Directories and Files Is Properly Restricted"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.12"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.12 Ensure Group Write Access for the Document Root Directories and Files Is Properly Restricted

## Profile Applicability

- Level 1

## Description

Group permissions on Apache Document Root directories `$DOCROOT` may need to be writable by an authorized group such as development, support, or a production content management tool. However, it is important that the Apache group used to run the server does not have write access to any directories or files in the document root.

## Rationale

Preventing Apache from writing to the web document root helps mitigate risk associated with web application vulnerabilities associated with file uploads or command execution. Typically, if an application hosted by Apache needs to write to directory, it is best practice to have that directory live outside the web root.

## Audit

Identify files or directories in the Apache Document Root directory with Apache group write access.

```bash
## Define $GRP to be the Apache group configured
# GRP=$(grep '^Group' $APACHE_PREFIX/conf/httpd.conf | cut -d' ' -f2)
find -L $DOCROOT -group $GRP -perm /g=w -ls
```

## Remediation

Perform the following to remove group write access on the `$DOCROOT` directories and files with the `apache` group.

```bash
# find -L $DOCROOT -group $GRP -perm /g=w -print | xargs chmod g-w
```

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

- Level 1 | Manual
