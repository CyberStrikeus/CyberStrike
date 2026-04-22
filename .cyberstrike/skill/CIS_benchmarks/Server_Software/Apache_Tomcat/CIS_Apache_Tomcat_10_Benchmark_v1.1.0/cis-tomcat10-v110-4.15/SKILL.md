---
name: cis-tomcat10-v110-4.15
description: "Restrict access to jaspic-providers.xml"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, file-permissions, jaspic]
cis_id: "4.15"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.15 Restrict access to jaspic-providers.xml (Automated)

## Profile Applicability

• Level 1

## Description

Tomcat implements JASPIC 1.1 Maintenance Release B (JSR 196). The implementation is primarily intended to enable the integration of 3rd party JASPIC authentication implementations with Tomcat.

JASPIC may be configured dynamically by an application or statically via the `$CATALINA_BASE/conf/jaspic-providers.xml` configuration file. It is recommended that access to this file properly protect from unauthorized changes.

## Rationale

Restricting access to this file will prevent local users from maliciously or inadvertently altering Tomcat's security policy.

## Audit Procedure

Perform the following to determine if the ownership and permissions on `$CATALINA_HOME/conf/jaspic-providers.xml` are securely configured.

```bash
# cd $CATALINA_HOME/conf/
# find jaspic-providers.xml -follow -maxdepth 0 \( -perm /o+rwx,g+rwx,u+x -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to restrict access to `$CATALINA_HOME/conf/jaspic-providers.xml`.

1. Set the ownership of the `$CATALINA_HOME/conf/jaspic-providers.xml` file to `tomcat_admin:tomcat`.

```bash
# chown tomcat_admin:tomcat $CATALINA_HOME/conf/jaspic-providers.xml
```

2. Set the permissions for the `$CATALINA_HOME/conf/jaspic-providers.xml` file to 600.

```bash
# chmod 600 $CATALINA_HOME/conf/jaspic-providers.xml
```

## Default Value

The default permissions of `jaspic-providers.xml` are 600.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/jaspic.html

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
