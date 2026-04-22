---
name: cis-tomcat9-v120-10.8
description: "Do not allow additional path delimiters (Manual)"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.8"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.8 Do not allow additional path delimiters (Manual)

## Description

Being able to specify different path-delimiters on Tomcat creates the possibility that an attacker can access applications that were previously blocked by a proxy like `mod_proxy`.

## Rationale

Allowing additional path-delimiters allows for an attacker to get to an application or area which was not previously visible.

## Audit Procedure

Ensure the `-Dorg.apache.catalina.connector.CoyoteAdapter.ALLOW_BACKSLASH=false` and `-Dorg.apache.tomcat.util.buf.UDecoder.ALLOW_ENCODED_SLASH=false` parameters are added to the startup script which, by default, is located at `$CATALINA_HOME/bin/catalina.sh`.

## Remediation

To start Tomcat with `ALLOW_BACKSLASH` and `ALLOW_ENCODED_SLASH` set to `false`, add `-Dorg.apache.catalina.connector.CoyoteAdapter.ALLOW_BACKSLASH=false` and `-Dorg.apache.tomcat.util.buf.UDecoder.ALLOW_ENCODED_SLASH=false` to your startup script in setenv.sh in CATALINA_BASE/bin.

## Default Value

By default both parameters are set to `false`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/systemprops.html

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure<br>Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening. |      | ●    | ●    |
| v7               | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                                                                                                                                                                                                                       | ●    | ●    | ●    |

## Profile

Level 2
