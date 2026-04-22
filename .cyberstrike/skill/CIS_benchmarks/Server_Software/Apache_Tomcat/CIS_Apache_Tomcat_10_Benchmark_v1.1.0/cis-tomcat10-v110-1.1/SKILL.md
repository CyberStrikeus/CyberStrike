---
name: cis-tomcat10-v110-1.1
description: "Remove extraneous files and directories (Manual)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, cleanup]
cis_id: "1.1"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Remove extraneous files and directories (Manual)

## Description

The installation may provide example applications, documentation, and other directories which may not serve a production use.

## Rationale

Removing sample resources is a defense in depth measure that reduces potential exposures introduced by these resources.

## Audit Procedure

Perform the following to determine the existence of extraneous resources:

```bash
$ ls -l $CATALINA_HOME/webapps/examples \
    $CATALINA_HOME/webapps/docs \
    $CATALINA_HOME/webapps/ROOT \
    $CATALINA_HOME/webapps/host-manager \
    $CATALINA_HOME/webapps/manager
```

No output implies no sample resources are present.

## Remediation

Perform the following to remove extraneous resources:

```bash
$ rm -rf $CATALINA_HOME/webapps/docs \
    $CATALINA_HOME/webapps/examples \
    $CATALINA_HOME/webapps/ROOT
```

If the Manager and HOST-Manager application are not utilized, also remove the following resources:

```bash
$ rm -rf $CATALINA_HOME/webapps/host-manager \
    $CATALINA_HOME/webapps/manager
```

## Default Value

`docs`, `examples`, `ROOT`, `manager` and `host-manager` are default web applications shipped with Tomcat.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/security-howto.html#Default_web_applications/General

## CIS Controls

**v8:**
- 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
  - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

**v7:**
- 2.6 Address unapproved software
  - Ensure that unauthorized software is either removed or the inventory is updated in a timely manner

## Profile Applicability

- Level 2
