---
name: cis-tomcat8-v100-8.1
description: "Restrict runtime access to sensitive packages (Automated)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, catalina-policy, security-manager]
cis_id: "8.1"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1 Restrict runtime access to sensitive packages (Automated)

## Description

`package.access` grants or revokes access to listed packages during runtime. It is recommended that application access to certain packages be restricted.

## Rationale

Prevent web applications from accessing restricted or unknown packages which may be malicious or dangerous to the application.

## Audit Procedure

Review `package.access` list in `$CATALINA_BASE/conf/catalina.properties` to ensure only allowed packages are defined.

## Remediation

Edit `$CATALINA_BASE/conf/catalina.properties` by adding allowed packages to the `package.access` list:

```
package.access =
sun.,org.apache.catalina.,org.apache.coyote.,org.apache.jasper.,org.apache.to
mcat.
```

## Default Value

The default package.access value within `$CATALINA_BASE/conf/catalina.properties` is:

```
package.access =
sun.,org.apache.catalina.,org.apache.coyote.,org.apache.tomcat.,
org.apache.jasper.
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## Profile

Level 1
