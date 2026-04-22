---
name: cis-tomcat9-v120-10.13
description: "Do not run applications as privileged (Automated)"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.13"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.13 Do not run applications as privileged (Automated)

## Description

Setting the `privileged` attribute for an application changes the class loader to the Server class loader instead of the Shared class loader.

## Rationale

Running an application in privileged mode allows an application to load the manager libraries.

## Audit Procedure

Ensure the `privileged` attribute in each `context.xml` file does not exist or is set to `false`.

```
# find . -name context.xml | xargs grep "privileged"
```

## Remediation

Set the `privileged` attribute in all `context.xml` files to `false` unless it is required as for the manager application:

```xml
<Context ... privileged="false" />
```

## Default Value

By default, `privileged` has a value of `false`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/context.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ●    | ●    | ●    |
| v7               | 4 Controlled Use of Administrative Privileges<br>Controlled Use of Administrative Privileges                                                                                                                                                                                                                                  |      |      |      |

## Profile

Level 1
