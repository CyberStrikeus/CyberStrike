---
name: cis-tomcat101-10.2
description: "Restrict access to the web administration application (Automated)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, manager, security]
cis_id: "10.2"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.2 Restrict access to the web administration application (Automated)

## Description

Limit access to the web administration application to only those with a justified need.

## Rationale

Limiting access to the least privilege will ensure only those people with justified need will have access to a resource. The web administration application should be limited to only administrators.

## Audit Procedure

Review `$CATALINA_HOME/conf/server.xml` to determine whether the `RemoteAddrValve` option is uncommented and configured to only allow access to systems required to connect.

## Remediation

For the administration application, edit `$CATALINA_HOME/conf/server.xml` and uncomment the following:

```xml
<Valve className="org.apache.catalina.valves.RemoteAddrValve"
allow="127\.0\.0\.1"/>
```

Note: The `RemoteAddrValve` property expects a regular expression, therefore periods and other regular expression meta-characters must be escaped.

## Default Value

By default, this configuration is not present.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/valve.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |

## Profile

Level 1
