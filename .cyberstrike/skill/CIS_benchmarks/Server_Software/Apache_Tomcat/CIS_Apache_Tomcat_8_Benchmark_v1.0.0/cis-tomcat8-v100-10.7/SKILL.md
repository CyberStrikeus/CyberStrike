---
name: cis-tomcat8-v100-10.7
description: "Turn off session facade recycling (Manual)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.7"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.7 Turn off session facade recycling (Manual)

## Description

The `RECYCLE_FACADES` can specify if a new facade will be created for each request. If a new facade is not created there is a potential for information leakage from other sessions.

## Rationale

When `RECYCLE_FACADES` is set to `false`, Tomcat will recycle the session facade between requests which may result in information leakage.

## Audit Procedure

Ensure `-Dorg.apache.catalina.connector.RECYCLE_FACADES=true` is added to the startup script which, by default, is located at `$CATALINA_HOME/bin/catalina.sh`.

## Remediation

Start Tomcat with `RECYCLE_FACADES` set to `true`. Add `-Dorg.apache.catalina.connector.RECYCLE_FACADES=true` to your startup script.

## Default Value

The default value is `false`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/systemprops.html
2. https://tomcat.apache.org/tomcat-9.0-doc/security-howto.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure<br>Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening. | | ● | ● |
| v7 | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software. | ● | ● | ● |

## Profile

Level 1
