---
name: cis-tomcat101-10.3
description: "Restrict manager application (Manual)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, manager, security]
cis_id: "10.3"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.3 Restrict manager application (Manual)

## Description

Limit access to the manager application to only those with a justified need.

## Rationale

Limiting access to the least privilege will ensure only those people with a justified need will have access to a resource. The manager application should be limited to only administrators.

## Audit Procedure

Review `$CATALINA_BASE/conf/<enginename>/<hostname>/manager.xml` to determine if the `RemoteAddrValve` option is uncommented and configured to only allow access to systems required to connect.

## Remediation

For the manager application, edit `$CATALINA_BASE/conf/<enginename>/<hostname>/manager.xml`, and add the bolded line:

```xml
<Context path="/manager" docBase="${catalina.home}/webapps/manager" debug="0"
privileged="true"><Valve
className="org.apache.catalina.valves.RemoteAddrValve"
allow="127.0.0.1"/></Context>
```

Add hosts, comma separated, which are allowed to access the admin application.

Note: The `RemoteAddrValve` property expects a regular expression, therefore periods and other regular expression meta-characters must be escaped.

## Default Value

By default this setting is not present

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/valve.html
2. https://tomcat.apache.org/tomcat-9.0-doc/manager-howto.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |

## Profile

Level 2
