---
name: cis-apache-3.12
description: "Ensure Group Write Access for the Document Root Directories and Files Is Properly Restricted"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.12"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Group Write Access for the Document Root Directories and Files Is Properly Restricted

## Description

The Apache Document Root directory `$DOCROOT` may need to be writeable by an authorized group such as development, support, or a production content management tool. However, it is important that the Apache group used to run the server does not have write access to any directories or files in the document root.

## Rationale

Preventing Apache from writing to the web document root helps mitigate risk associated with web application vulnerabilities associated with file uploads or command execution. Typically, if an application hosted by Apache needs to write to a directory, it is best practice to have that directory live outside the web root.

## Impact

None documented

## Audit Procedure

Verify that there are no files or directories in the Apache Document Root directory with Apache group write access:

```
## Define $GRP to be the Apache group configured
# GRP=$(grep '^Group' $APACHE_PREFIX/conf/httpd.conf | cut -d' ' -f2)
# find -L $DOCROOT -group $GRP -perm /g=w -ls
```

## Remediation

Perform the following to remove group write access on the `$DOCROOT` directories and files for the `apache` group:

```
# find -L $DOCROOT -group $GRP -perm /g=w -print | xargs chmod g-w
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
