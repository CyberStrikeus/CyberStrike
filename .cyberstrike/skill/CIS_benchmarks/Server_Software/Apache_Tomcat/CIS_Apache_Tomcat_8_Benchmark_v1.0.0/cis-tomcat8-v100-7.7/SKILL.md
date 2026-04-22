---
name: cis-tomcat8-v100-7.7
description: "Configure log file size limit (Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, logging, log-rotation]
cis_id: "7.7"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.7 Configure log file size limit (Scored)

## Description

Tomcat logging can be configured to limit the size of log files. Proper log file management helps prevent disk space exhaustion and ensures log data is rotated appropriately.

## Rationale

Without proper log rotation and size limits, log files can grow indefinitely, consuming disk space and potentially causing denial of service conditions. Configuring log file size limits ensures that logs are managed properly.

## Audit Procedure

Review the `$CATALINA_HOME/conf/logging.properties` file to verify that the `maxDays` attribute is configured for each handler:

```bash
$ grep "maxDays" $CATALINA_HOME/conf/logging.properties
```

Verify that the `maxDays` property is set to an appropriate value (e.g., 90 days or less).

## Remediation

Edit the `$CATALINA_HOME/conf/logging.properties` file and add or modify the `maxDays` attribute for each file handler:

```properties
1catalina.org.apache.juli.AsyncFileHandler.maxDays = 90
2localhost.org.apache.juli.AsyncFileHandler.maxDays = 90
3manager.org.apache.juli.AsyncFileHandler.maxDays = 90
4host-manager.org.apache.juli.AsyncFileHandler.maxDays = 90
```

## Default Value

By default, `maxDays` is not set, meaning log files are not automatically removed.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/logging.html
2. https://tomcat.apache.org/tomcat-8.0-doc/api/org/apache/juli/FileHandler.html

## CIS Controls

**v7:**

- 6.4 Ensure adequate storage for logs
  - Ensure that all systems that store logs have adequate storage space for the logs generated.

## Profile Applicability

- Level 1
