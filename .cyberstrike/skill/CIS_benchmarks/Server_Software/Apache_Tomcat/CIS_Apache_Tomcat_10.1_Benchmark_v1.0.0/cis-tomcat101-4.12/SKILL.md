---
name: cis-tomcat101-4.12
description: "Restrict access to Tomcat server.xml"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, file-permissions]
cis_id: "4.12"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.12 Restrict access to Tomcat server.xml (Automated)

## Profile Applicability

• Level 1

## Description

`server.xml` contains Tomcat servlet definitions and configurations. It is recommended that access to this file properly protect from unauthorized changes.

## Rationale

Restricting access to this file will prevent local users from maliciously or inadvertently altering Tomcat's security policy.

## Audit Procedure

Perform the following to determine if the ownership and permissions on `$CATALINA_HOME/conf/server.xml` care securely configured.

```bash
# cd $CATALINA_HOME/conf/
# find server.xml -follow -maxdepth 0 \( -perm /o+rwx,g+rwx,u+x -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to restrict access to `server.xml`:

1. Set the ownership of the `$CATALINA_HOME/conf/server.xml` to `tomcat_admin:tomcat`.

```bash
# chown tomcat_admin:tomcat $CATALINA_HOME/conf/server.xml
```

2. Set the permissions of the `$CATALINA_HOME/conf/server.xml` to 600

```bash
# chmod 600 $CATALINA_HOME/conf/server.xml
```

## Default Value

The default permissions of the top-level directories are 600.

## References

None

## CIS Controls

None

## Profile

Level 1
