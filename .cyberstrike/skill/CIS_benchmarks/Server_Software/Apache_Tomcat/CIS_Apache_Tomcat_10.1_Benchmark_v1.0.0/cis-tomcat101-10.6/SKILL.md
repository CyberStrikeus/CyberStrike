---
name: cis-tomcat101-10.6
description: "Enable strict servlet Compliance (Manual)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.6"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.6 Enable strict servlet Compliance (Manual)

## Description

The `STRICT_SERVLET_COMPLIANCE` influences Tomcat's behavior in several subtle ways. See the References below for the complete list. It is recommended that `STRICT_SERVLET_COMPLIANCE` be set to `true`.

## Rationale

When `STRICT_SERVLET_COMPLIANCE` is set to `true`, Tomcat will always send an HTTP Content-type header when responding to requests. This is significant as the behavior of web browsers is inconsistent in the absence of the Content-type header. Some browsers will attempt to determine the appropriate content-type by sniffing

## Impact

Changing this to `true` will change a number of other default values which is likely to break the majority of systems as some browsers are unable to correctly handle the cookie headers that result from a strict adherence to the specifications. Please refer to the referenced documentation for a complete list of changed values. Defaults, regardless of whether or not they have been changed by setting `org.apache.catalina.STRICT_SERVLET_COMPLIANCE` can always be overridden by explicitly setting the appropriate system property or element attribute.

## Audit Procedure

Ensure the `-Dorg.apache.catalina.STRICT_SERVLET_COMPLIANCE=true` parameter is added to the startup script which by default is located at `$CATALINA_HOME/bin/catalina.sh`.

## Remediation

Start Tomcat with strict compliance enabled, add `-Dorg.apache.catalina.STRICT_SERVLET_COMPLIANCE=true` to your startup script.

## Default Value

The default value is `false`.

## References

1. http://tomcat.apache.org/tomcat-9.0-doc/config/systemprops.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 13.10 Perform Application Layer Filtering<br>Perform application layer filtering. Example implementations include a filtering proxy, application layer firewall, or gateway. | | | ● |
| v7 | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software. | ● | ● | ● |

## Profile

Level 2
