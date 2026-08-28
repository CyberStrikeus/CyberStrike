---
name: cis-apache-3.5
description: "Ensure the Group Is Set Correctly on Apache Directories and Files"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.5"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Group Is Set Correctly on Apache Directories and Files

## Description

The Apache directories and files should be set to have a group of root (or a root equivalent group). This applies to all the Apache software directories and files installed. The only expected exception is that the Apache web document root (`$APACHE_PREFIX/htdocs`) is likely to need a designated group to allow web content to be updated (such as `webupdate`) through a change management process.

## Rationale

Securing Apache files and directories will reduce the probability of unauthorized modifications.

## Impact

None documented

## Audit Procedure

Verify that there are no files in the Apache directories (other than `htdocs`) with a group other than root:

```
# find $APACHE_PREFIX -path $APACHE_PREFIX/htdocs -prune -o \! -group root -ls
```

## Remediation

Perform the following:

Set the group on the `$APACHE_PREFIX` directories, such as `/usr/local/apache2`:

```
$ chgrp -R root $APACHE_PREFIX
```

## Default Value

Default group is a mixture of the user group that built the software and root.

## References

None documented

## CIS Controls

### Version 6

5 Controlled Use of Administration Privileges

Controlled Use of Administration Privileges

### Version 7

14.6 Protect Information through Access Control Lists

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Scored
