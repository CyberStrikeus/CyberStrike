---
name: cis-tomcat10-v110-10.12
description: "Do not allow symbolic linking (Automated)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.12"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.12 Do not allow symbolic linking (Automated)

## Description

Symbolic links permit one application to include the libraries from another. This allows for re-use of code but also allows for potential security issues when applications include libraries from other applications to which they should not have access.

## Rationale

Allowing symbolic links makes Tomcat susceptible to directory traversal vulnerability. Also, there is a potential that an application could link to another application to which it should not be linking. On case-insensitive operating systems there is also the threat of source code disclosure.

## Audit Procedure

Ensure the `allowLinking` attribute in all `context.xml` does not exist or is set to `false`.

```
# find . -name context.xml | xargs grep "allowLinking"
```

## Remediation

In all `context.xml`, set the `allowLinking` attribute to `false`:

```xml
<Context>
...
  <Resources ... allowLinking="false" />
...
</Context>
```

## Default Value

By default `allowLinking` has a value of `false`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/resources.html
2. https://tomcat.apache.org/tomcat-9.0-doc/config/context.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.7 Allowlist Authorized Scripts<br>Use technical controls, such as digital signatures and version control, to ensure that only authorized scripts, such as specific .ps1, .py, etc., files, are allowed to execute. Block unauthorized scripts from executing. Reassess bi-annually, or more frequently. |      |      | ●    |
| v7               | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                                                                                  | ●    | ●    | ●    |

## Profile

Level 1
