---
name: cis-apache24-3.5
description: "Ensure the Group Is Set Correctly on Apache Directories and Files"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.5"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.5 Ensure the Group Is Set Correctly on Apache Directories and Files

## Profile Applicability

- Level 1

## Description

The Apache directories and files should be set to have a group Id of `root`, (or a root equivalent) group. This applies to all of the Apache software directories and files installed. The only expected exception is that the Apache web document root (`$APACHE_PREFIX/htdocs`) is likely to need a designated group to allow web content to be updated (such as `webupdate`) through a change management process.

## Rationale

Securing Apache files and directories will reduce the probability of unauthorized modifications to those resources.

## Audit

Identify files in the Apache directories other than `htdocs` with a group other than `root`:

```bash
# find $APACHE_PREFIX -path $APACHE_PREFIX/htdocs -prune -o \! -group root -ls
```

## Remediation

Perform the following:

Set ownership on the `$APACHE_PREFIX` directories such as `/usr/local/apache2`:

```bash
# chgrp -R root $APACHE_PREFIX
```

## Default Value

Default ownership and group is a mixture of the `user:group` that built the software and `root:root`.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## Profile

- Level 1
