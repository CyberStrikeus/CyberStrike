---
name: cis-tomcat8-v110-4.2
description: "Restrict access to $CATALINA_BASE (Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, file-permissions, catalina-base]
cis_id: "4.2"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Restrict access to $CATALINA_BASE (Scored)

## Description

`$CATALINA_BASE` is the environment variable that specifies the base directory from which most relative paths are resolved. `$CATALINA_BASE` is usually used when there are multiple instances of Tomcat running. It is important to limit access to this in order to protect the Tomcat-related binaries and libraries from unauthorized modification. It is recommended that the ownership of `$CATALINA_BASE` be `tomcat_admin:tomcat`. It is also recommended that the permission on `$CATALINA_BASE` deny read, write, and execute for the world (`o-rwx`) and prevent write deny to the group (`g-w`).

## Rationale

The security of processes and data which traverse or depend on Tomcat may become compromised if the `$CATALINA_BASE` is not secured.

## Audit Procedure

Perform the following to ensure the permission on the `$CATALINA_BASE` directory prevent unauthorized modification.

```bash
$ cd $CATALINA_BASE
$ find . -follow -maxdepth 0 \( -perm /o+rwx,g=w -o ! -user tomcat_admin -o ! -group tomcat \) -ls
```

The above command should not produce any output.

## Remediation

Perform the following to establish the recommended state:

1. Set the ownership of the `$CATALINA_BASE` to `tomcat_admin:tomcat`.

```bash
# chown tomcat_admin.tomcat $CATALINA_BASE
```

2. Remove write permissions for the group and read, write, and execute permissions for the world.

```bash
# chmod g-w,o-rwx $CATALINA_BASE
```

## Default Value

The default permissions of the top-level Tomcat directory is operating system dependent.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/security-howto.html
2. https://tomcat.apache.org/tomcat-8.5-doc/security-howto.html

## CIS Controls

**v7:**

- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile Applicability

- Level 1
