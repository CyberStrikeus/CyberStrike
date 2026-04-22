---
name: cis-tomcat8-v100-1.1
description: "Remove extraneous files and directories"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, extraneous-resources]
cis_id: "1.1"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1 Remove extraneous files and directories

## Profile Applicability

- Level 2

## Description

The installation may provide example applications, documentation, and other directories which may not serve a production use.

## Rationale

Removing sample resources is a defense in depth measure that reduces potential exposures introduced by these resources.

## Audit Procedure

Perform the following to determine the existence of extraneous resources:

1. List all files extraneous files. The following should yield no output:

```bash
$ ls -l $CATALINA_HOME/webapps/docs \
    $CATALINA_HOME/webapps/examples
```

## Remediation

Perform the following to remove extraneous resources:

1. The following should yield no output:

```bash
$ rm -rf $CATALINA_HOME/webapps/docs \
    $CATALINA_HOME/webapps/examples
```

If the Manager application is not utilized, also remove the following resources:

```bash
$ rm -rf $CATALINA_HOME/webapps/host-manager \
    $CATALINA_HOME/webapps/manager \
    $CATALINA_HOME/conf/Catalina/localhost/manager.xml
```

## Default Value

"docs", "examples", "manager" and "host-manager" are default web applications shipped with Tomcat.

## References

- None

## CIS Controls

| CIS Control | Description |
|-------------|-------------|
| Version 8 Control 4.1 | Establish and Maintain a Secure Configuration Process |
| Version 7 Control 18.11 | Only Use Up-to-Date and Trusted Application Add-ons |

## Profile / Assessment Status

| Profile | Assessment Status |
|---------|------------------|
| Level 1 | Not Applicable |
| Level 2 | Scored |
