---
name: cis-apache-3.4
description: "Ensure Apache Directories and Files Are Owned By Root"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.4"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Apache Directories and Files Are Owned By Root

## Description

The Apache directories and files should be owned by root. This applies to all of the Apache software directories and files installed.

## Rationale

Restricting ownership of the Apache files and directories will reduce the probability of unauthorized modifications.

## Impact

None documented

## Audit Procedure

Verify that there are no files in the Apache directory that are not owned by `root`:

```
# find $APACHE_PREFIX \! -user root -ls
```

## Remediation

Perform the following:

Set ownership on the `$APACHE_PREFIX` directories such as `/usr/local/apache2`:

```
$ chown -R root $APACHE_PREFIX
```

## Default Value

Default ownership is a mixture of the user that built the software and `root`.

## References

None documented

## CIS Controls

### Version 6

5.1 Minimize And Sparingly Use Administrative Privileges

Minimize administrative privileges and only use administrative accounts when they are required. Implement focused auditing on the use of administrative privileged functions and monitor for anomalous behavior.

### Version 7

14.6 Protect Information through Access Control Lists

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

Level 1 | Scored
