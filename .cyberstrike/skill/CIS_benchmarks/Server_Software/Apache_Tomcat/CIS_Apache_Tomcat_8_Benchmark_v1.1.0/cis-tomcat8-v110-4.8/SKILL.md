---
name: cis-tomcat8-v110-4.8
description: "Restrict access to Tomcat catalina.properties (Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, file-permissions, catalina-properties]
cis_id: "4.8"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Restrict access to Tomcat catalina.properties (Scored)

## Description

`catalina.properties` is a Java properties file which contains settings for Tomcat including class loader information, security package lists, and performance properties. It is recommended that access to this file properly protect from unauthorized changes.

## Rationale

Restricting access to this file will prevent local users from maliciously or inadvertently altering Tomcat's security policy.

## Audit Procedure

Perform the following to determine if the ownership and permissions on `$CATALINA_HOME/conf/catalina.properties` are securely configured.

```bash
# cd $CATALINA_HOME/conf/
# find catalina.properties -follow -maxdepth 0 \( -perm /o+rwx,g+rwx,u+x -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to restrict access to `catalina.properties`:

1. Set the ownership of the `$CATALINA_HOME/conf/catalina.properties` to `tomcat_admin:tomcat`.

```bash
# chown tomcat_admin:tomcat $CATALINA_HOME/conf/catalina.properties
```

2. Set the permissions of the `$CATALINA_HOME/conf/catalina.properties` to `600`.

```bash
# chmod 600 $CATALINA_HOME/conf/catalina.properties
```

## Default Value

The default permissions of the top-level directories are `600`.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/security-howto.html
2. https://tomcat.apache.org/tomcat-8.5-doc/security-howto.html

## CIS Controls

**v7:**

- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile Applicability

- Level 1
