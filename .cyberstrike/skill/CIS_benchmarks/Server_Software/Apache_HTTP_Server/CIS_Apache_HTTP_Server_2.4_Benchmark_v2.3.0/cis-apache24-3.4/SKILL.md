---
name: cis-apache24-3.4
description: "Ensure Apache Directories and Files Are Owned By Root"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.4"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.4 Ensure Apache Directories and Files Are Owned By Root

## Profile Applicability

- Level 1

## Description

The Apache directories and files should be owned by `root`. This applies to all of the Apache software directories and files installed.

## Rationale

Restricting ownership of the Apache files and directories will reduce the probability of unauthorized modifications to those resources.

## Audit

Identify files in the Apache directory that are not owned by `root`:

```bash
# find $APACHE_PREFIX \! -user root -ls
```

## Remediation

Perform the following:

Set ownership on the `$APACHE_PREFIX` directories such as `/usr/local/apache2`:

```bash
# chown -R root $APACHE_PREFIX
```

## Default Value

Default ownership and group is a mixture of the `user:group` that built the software and `root:root`.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control<br>Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. |      |      | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.                       | ●    | ●    | ●    |

## Profile

- Level 1
