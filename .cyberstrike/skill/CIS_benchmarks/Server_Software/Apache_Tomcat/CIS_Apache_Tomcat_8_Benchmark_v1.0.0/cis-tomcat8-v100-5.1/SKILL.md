---
name: cis-tomcat8-v100-5.1
description: "Use secure Realms"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, realms, authentication]
cis_id: "5.1"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1 Use secure Realms (Automated)

## Profile Applicability

• Level 2

## Description

A realm is a database of usernames and passwords used to identify valid users of web applications. Review the Realms configuration to ensure Tomcat is not configured to use `MemoryRealm`, `JDBCRealm`, `UserDatabaseRealm`, or `JAASRealm`.

## Rationale

According to the Tomcat documentation: `MemoryRealm` and `JDBCRealm` are not designed for production usage and could result in reduced availability; the `UserDatabaseRealm` is not intended for large-scale installations; and the `JAASRealm` is not widely used and therefore the code is not as mature as the other realms.

## Audit Procedure

Perform the following to ensure an improper realm is not in use:

```bash
# grep "Realm className" $CATALINA_HOME/conf/server.xml | grep MemoryRealm
# grep "Realm className" $CATALINA_HOME/conf/server.xml | grep JDBCRealm
# grep "Realm className" $CATALINA_HOME/conf/server.xml | grep UserDatabaseRealm
# grep "Realm className" $CATALINA_HOME/conf/server.xml | grep JAASRealm
```

The above commands should not emit any output.

## Remediation

Set the Realm `className` setting in `$CATALINA_HOME/conf/server.xml` to one of the appropriate realms.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/realm-howto.html
2. https://tomcat.apache.org/tomcat-9.0-doc/security-howto.html

## CIS Controls

**Controls Version: v8**

**Control:** 3.3 Configure Data Access Control Lists

Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**IG 1:** •
**IG 2:** •
**IG 3:** •

## Profile

Level 2
