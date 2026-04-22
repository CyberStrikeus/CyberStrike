---
name: cis-tomcat8-v110-7.1
description: "Application specific logging (Automated)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, logging, log-files]
cis_id: "7.1"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.1 Application specific logging (Automated)

## Description

By default, `java.util.logging` does not provide the capabilities to configure per-web application settings, only per VM. In order to overcome this limitation Tomcat implements JULI as a wrapper for `java.util.logging`. JULI provides additional configuration functionality so you can set each web application with different logging specifications.

## Rationale

Establishing per application logging profiles will help ensure that each application's logging verbosity is set to an appropriate level in order to provide appropriate information when needed for security review.

## Audit Procedure

Ensure a `logging.properties` file is located at `$CATALINA_BASE/webapps/<app_name>/WEB-INF/classes`.

## Remediation

Create a `logging.properties` file and place that into your application `WEB-INF/classes` directory.

Note: By default, installing Tomcat places a `logging.properties` file in `$CATALINA_HOME/conf`. This file can be used as base for an application specific logging properties file.

## Default Value

By default, per application logging is not configured.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/logging.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs<br>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. | | ● | ● |
| v7 | 6.3 Enable Detailed Logging<br>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. | | ● | ● |

## Profile

Level 2
