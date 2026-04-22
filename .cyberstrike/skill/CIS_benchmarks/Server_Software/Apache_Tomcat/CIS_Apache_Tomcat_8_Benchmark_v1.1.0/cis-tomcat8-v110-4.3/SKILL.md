---
name: cis-tomcat8-v110-4.3
description: "Restrict access to Tomcat configuration directory (Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, file-permissions, conf-directory]
cis_id: "4.3"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Restrict access to Tomcat configuration directory (Scored)

## Description

The Tomcat `$CATALINA_HOME/conf` directory contains Tomcat configuration files. It is recommended that the ownership of this directory be `tomcat_admin:tomcat`. It is also recommended that the permissions on this directory deny read, write, and execute for the world (`o-rwx`) and deny write access to the group (`g-w`).

## Rationale

Restricting access to these directories will prevent local users from maliciously or inadvertently altering Tomcat's configuration.

## Audit Procedure

Perform the following to determine if the ownership and permissions on `$CATALINA_HOME/conf` are securely configured.

```bash
# cd $CATALINA_HOME/conf
# find . -maxdepth 0 \( -perm /o+rwx,g=w -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to restrict access to Tomcat configuration files:

1. Set the ownership of the `$CATALINA_HOME/conf` to `tomcat_admin:tomcat`.

```bash
# chown tomcat_admin:tomcat $CATALINA_HOME/conf
```

2. Remove write permissions for the group and read, write, and execute permissions for the world.

```bash
# chmod g-w,o-rwx $CATALINA_HOME/conf
```

## Default Value

The default permissions of the top-level directories are `770`.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/security-howto.html
2. https://tomcat.apache.org/tomcat-8.5-doc/security-howto.html

## CIS Controls

**v7:**
- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile Applicability

- Level 1
