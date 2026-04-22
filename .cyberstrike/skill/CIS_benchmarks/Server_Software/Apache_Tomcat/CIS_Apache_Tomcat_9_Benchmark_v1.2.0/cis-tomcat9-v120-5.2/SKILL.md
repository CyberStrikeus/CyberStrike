---
name: cis-tomcat9-v120-5.2
description: "Use LockOut Realms"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, realms, authentication, lockout]
cis_id: "5.2"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2 Use LockOut Realms (Automated)

## Profile Applicability

• Level 2

## Description

A `LockOut` realm wraps around standard realms adding the ability to lock a user out after multiple failed logins.

## Rationale

Locking out a user after multiple failed logins slows down attackers from brute forcing logins.

## Audit Procedure

Perform the following to check to see if a `LockOut` realm is being used:

```bash
# grep "LockOutRealm" $CATALINA_HOME/conf/server.xml
```

## Remediation

Create a lockout realm wrapping the main realm similar to the example below:

```xml
<Realm className="org.apache.catalina.realm.LockOutRealm"
failureCount="3" lockOutTime="600" cacheSize="1000"
cacheRemovalWarningTime="3600">
  <Realm
className="org.apache.catalina.realm.DataSourceRealm"
dataSourceName="... />
</Realm>
```

## References

1. http://tomcat.apache.org/tomcat-9.0-doc/realm-howto.html
2. http://tomcat.apache.org/tomcat-9.0-doc/config/realm.html

## CIS Controls

**Controls Version: v8**

**Control:** 4 Secure Configuration of Enterprise Assets and Software

Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications).

## Profile

Level 2
