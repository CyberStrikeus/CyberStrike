---
name: cis-tomcat7-v100-1.1
description: "Remove extraneous files and directories"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-7, hardening, extraneous-resources]
cis_id: "1.1"
cis_benchmark: "CIS Apache Tomcat 7 Benchmark v1.0.0"
tech_stack: [tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Apache Tomcat 7 - 1.1 Remove extraneous files and directories (Scored)

## Profile Applicability

- Level 2

## Description

The installation may provide example applications, documentation, and other directories which may not serve a production use.

## Rationale

Removing sample resources is a defense in depth measure that reduces potential exposures introduced by these resources.

## Impact

Removal of example applications and documentation reduces available attack surface.

## Audit Procedure

Perform the following to determine the existence of extraneous resources:

1. List all files extraneous files. The following should yield no output:

```bash
$ ls -l $CATALINA_HOME/webapps/js-examples \
    $CATALINA_HOME/webapps/servlet-example \
    $CATALINA_HOME/webapps/webdav \
    $CATALINA_HOME/webapps/tomcat-docs \
    $CATALINA_HOME/webapps/balancer \
    $CATALINA_HOME/webapps/ROOT/admin \
    $CATALINA_HOME/webapps/examples \
    $CATALINA_HOME/server/webapps/host-manager \
    $CATALINA_HOME/server/webapps/manager \
    $CATALINA_HOME/conf/Catalina/localhost/host-manager.xml \
    $CATALINA_HOME/conf/Catalina/localhost/manager.xml
```

## Remediation

Perform the following to remove extraneous resources:

1. The following should yield no output:

```bash
$ rm -rf $CATALINA_HOME/webapps/js-examples \
    $CATALINA_HOME/webapps/servlet-example \
    $CATALINA_HOME/webapps/webdav \
    $CATALINA_HOME/webapps/tomcat-docs \
    $CATALINA_HOME/webapps/balancer \
    $CATALINA_HOME/bin/webapps/ROOT/admin \$CATALINA_HOME/webapps/examples
```

If the Manager application is not utilized, also remove the following resources:

```bash
$ rm -rf $CATALINA_HOME/server/webapps/host-manager \
    $CATALINA_HOME/server/webapps/manager \
    $CATALINA_HOME/conf/Catalina/localhost/host-manager.xml \
    $CATALINA_HOME/conf/Catalina/localhost/manager.xml
```

## Default Value

Depending on your install method, default extraneous resources will vary.

## References

- CIS Apache Tomcat 7 Benchmark v1.0.0

## CIS Controls

Version 7:

- 18.9 Limit Use of Live Operating System to Those That Are Needed

## Assessment Status

- **Scored**
- **Profile**: Level 2
