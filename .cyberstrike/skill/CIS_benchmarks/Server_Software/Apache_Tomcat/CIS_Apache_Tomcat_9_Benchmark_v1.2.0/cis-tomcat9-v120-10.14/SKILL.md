---
name: cis-tomcat9-v120-10.14
description: "Do not allow cross context requests (Automated)"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.14"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.14 Do not allow cross context requests (Automated)

## Description

Setting `crossContext` to `true` allows for an application to call `ServletConext.getContext` to return a dispatcher for another application.

## Rationale

Allowing `crossContext` creates the possibility for a malicious application to make requests to a restricted application.

## Audit Procedure

Ensure the `crossContext` attribute in all `context.xml` does not exist or is set to `false`.

```
# find . -name context.xml | xargs grep "crossContext"
```

## Remediation

Set the `crossContext` attribute in all `context.xml` files to `false`:

```xml
<Context ... crossContext="false" />
```

## Default Value

By default `crossContext` has a value of `false`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/context.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.7 Allowlist Authorized Scripts<br>Use technical controls, such as digital signatures and version control, to ensure that only authorized scripts, such as specific .ps1, .py, etc., files, are allowed to execute. Block unauthorized scripts from executing. Reassess bi-annually, or more frequently. |      |      | ●    |
| v7               | 4.7 Limit Access to Script Tools<br>Limit access to scripting tools (such as Microsoft PowerShell and Python) to only administrative or development users with the need to access those capabilities.                                                                                                     |      | ●    | ●    |

## Profile

Level 1
