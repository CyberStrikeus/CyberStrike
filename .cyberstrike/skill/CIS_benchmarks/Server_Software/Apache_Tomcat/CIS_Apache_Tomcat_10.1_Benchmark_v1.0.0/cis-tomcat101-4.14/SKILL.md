---
name: cis-tomcat101-4.14
description: "Restrict access to Tomcat web.xml"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, file-permissions]
cis_id: "4.14"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.14 Restrict access to Tomcat web.xml (Automated)

## Profile Applicability

• Level 1

## Description

The Tomcat configuration file `web.xml` stores application configuration settings. It is recommended that access to this file properly protect from unauthorized changes.

## Rationale

Restricting access to this file will prevent local users from maliciously or inadvertently altering Tomcat's security policy.

## Audit Procedure

Perform the following to determine if the ownership and permissions on `$CATALINA_HOME/conf/web.xml` care securely configured.

```bash
# cd $CATALINA_HOME/conf/
# find web.xml -follow -maxdepth 0 \( -perm /o+rwx,g+rwx,u+wx -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to restrict access to `web.xml`:

1. Set the ownership of the `$CATALINA_HOME/conf/web.xml` to `tomcat_admin:tomcat`.

```bash
# chown tomcat_admin:tomcat $CATALINA_HOME/conf/web.xml
```

2. Set the permissions for the `$CATALINA_HOME/conf/web.xml` file to 400.

```bash
# chmod 400 $CATALINA_HOME/conf/web.xml
```

## Default Value

The default permissions of `web.xml` are 400.

## References

None

## CIS Controls

**Controls Version: v8**

**Control:** 3.3 Configure Data Access Control Lists

Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**IG 1:** •
**IG 2:** •
**IG 3:** •

**Controls Version: v7**

**Control:** 14.6 Protect Information through Access Control Lists

Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

**IG 1:** •
**IG 2:** •
**IG 3:** •

## Profile

Level 1
