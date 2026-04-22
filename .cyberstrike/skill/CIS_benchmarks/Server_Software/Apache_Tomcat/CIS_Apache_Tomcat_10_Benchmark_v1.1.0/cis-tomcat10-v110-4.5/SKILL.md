---
name: cis-tomcat10-v110-4.5
description: "Restrict access to Tomcat temp directory"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, file-permissions]
cis_id: "4.5"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5 Restrict access to Tomcat temp directory (Automated)

## Profile Applicability

• Level 1

## Description

The Tomcat `$CATALINA_HOME/temp` directory is used by Tomcat to persist temporary information to disk. It is recommended that the ownership of this directory be `tomcat_admin:tomcat`. It is also recommended that the permissions on this directory deny read, write, and execute for the world (`o-rwx`).

## Rationale

Restricting access to these directories will prevent local users from maliciously or inadvertently affecting the integrity of Tomcat processes.

## Audit Procedure

Perform the following to determine if the ownership and permissions on `$CATALINA_HOME/temp` are securely configured.

```bash
# cd $CATALINA_HOME
# find temp -follow -maxdepth 0 \( -perm /o+rwx -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to restrict access to Tomcat temp directory:

1. Set the ownership of the `$CATALINA_HOME/temp` to `tomcat_admin:tomcat`.

```bash
# chown tomcat_admin:tomcat $CATALINA_HOME/temp
```

2. Remove read, write, and execute permissions for the world

```bash
# chmod o-rwx $CATALINA_HOME/temp
```

## Default Value

The default permissions of the top-level directories are 770.

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
