---
name: cis-tomcat8-v100-4.1
description: "Restrict access to $CATALINA_HOME (Automated)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, file-permissions]
cis_id: "4.1"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Restrict access to $CATALINA_HOME (Automated)

## Description

`$CATALINA_HOME` is the environment variable which holds the path to the root Tomcat directory. It is important to protect access to this in order to protect the Tomcat binaries and libraries from unauthorized modification. It is recommended that the ownership of `$CATALINA_HOME` be tomcat_admin:tomcat. It is also recommended that the permission on `$CATALINA_HOME` block read, write, and execute for the world (o-rwx) and block write access to the group (g-w).

## Rationale

The security of processes and data which traverse or depend on Tomcat may become compromised if the `$CATALINA_HOME` is not secured.

## Audit Procedure

Perform the following to ensure the permission on the `$CATALINA_HOME` directory prevent unauthorized modification.

```bash
$ cd $CATALINA_HOME
$ find . -follow -maxdepth 0 \( -perm /o+rwx,g=w -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to establish the recommended state:

1. Set the ownership of the `$CATALINA_HOME` to tomcat_admin:tomcat.

```bash
# chown tomcat_admin.tomcat $CATALINA_HOME
```

2. Remove write permissions for the group and read, write, and execute permissions for the world

```bash
# chmod g-w,o-rwx $CATALINA_HOME
```

## CIS Controls

**v8:**
- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**
- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile Applicability

- Level 1
