---
name: cis-tomcat101-4.9
description: "Restrict access to Tomcat catalina.policy"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, file-permissions]
cis_id: "4.9"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.9 Restrict access to Tomcat catalina.policy (Automated)

## Profile Applicability

• Level 1

## Description

The `catalina.policy` file is used to configure security policies for Tomcat. It is recommended that access to this file has the proper permissions to properly protect from unauthorized changes.

## Rationale

Restricting access to this file will prevent local users from maliciously or inadvertently altering Tomcat's security policy.

## Audit Procedure

Perform the following to determine if the ownership and permissions on `$CATALINA_HOME/conf/catalina.policy` are securely configured.

```bash
# cd $CATALINA_HOME/conf/
# find catalina.policy -follow -maxdepth 0 \( -perm /o+rwx,g+rwx,u+x -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to restrict access to `$CATALINA_HOME/conf/catalina.policy`.

1. Set the owner and group owner of the contents of `$CATALINA_HOME/conf/catalina.policy` to `tomcat_admin:tomcat`.

```bash
# chown tomcat_admin:tomcat $CATALINA_HOME/conf/catalina.policy
```

2. Set the permissions of the `$CATALINA_HOME/conf/catalina.policy` file to 600.

```bash
# chmod 600 $CATALINA_HOME/conf/catalina.policy
```

## Default Value

The default permissions of `catalina.policy` are 600.

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
