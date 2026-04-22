---
name: cis-tomcat10-v110-10.9
description: "Configure connectionTimeout (Automated)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.9"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.9 Configure connectionTimeout (Automated)

## Description

The `connectionTimeout` setting allows Tomcat to close idle sockets after a specific amount of time to save system resources.

## Rationale

Closing idle sockets reduces system resource usage which can provide better performance and help protect against denial of Service attacks.

## Impact

This timeout will also apply when reading any request body when `disableUploadTimeout` is not set to `false`.

## Audit Procedure

Locate each `connectionTimeout` setting in `$CATALINA_HOME/conf/server.xml` and verify the setting is correct.

```
# grep connectionTimeout $CATALINA_HOME/conf/server.xml
```

## Remediation

Set the `connectionTimeout` for each connector in `$CATALINA_HOME/conf/server.xml` ensure to the optimal number of milliseconds based on hardware resources, load, and number of concurrent connections.

```
connectionTimeout="60000"
```

## Default Value

By default this is set to `60000` (i.e. 60 seconds).

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/http.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4 Secure Configuration of Enterprise Assets and Software<br>Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications). | | | |
| v7 | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software. | ● | ● | ● |

## Profile

Level 2
