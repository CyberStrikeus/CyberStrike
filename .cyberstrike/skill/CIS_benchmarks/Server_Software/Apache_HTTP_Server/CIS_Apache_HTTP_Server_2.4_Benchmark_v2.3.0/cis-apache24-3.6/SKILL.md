---
name: cis-apache24-3.6
description: "Ensure Other Write Access on Apache Directories and Files Is Restricted"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.6"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.6 Ensure Other Write Access on Apache Directories and Files Is Restricted

## Profile Applicability
- Level 1

## Description

Permissions on Apache directories should generally be `rwxr-xr-x` (755) and file permissions should be similar except not executable unless appropriate. This applies to all of the Apache software directories and files installed with the possible exception of the web document root `$APACHE_PREFIX/htdocs`. The directories and files in the web document root may have a designated group with write access to allow web content to be updated. In summary, the minimum recommendation is to not allow write access by other.

## Rationale

None of the Apache files and directories, including the Web document root must allow other write access. Other write access is likely to be very useful for unauthorized modification of web content, configuration files or software for malicious attacks.

## Audit

Identify files or directories in the Apache directory with other write access, excluding symbolic links:

```bash
# find -L $APACHE_PREFIX \! -type l -perm /o=w -ls
```

## Remediation

Perform the following to remove other write access on the `$APACHE_PREFIX` directories.

```bash
# chmod -R o-w $APACHE_PREFIX
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## Profile
- Level 1 | Automated
