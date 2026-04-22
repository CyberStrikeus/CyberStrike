---
name: cis-tomcat8-v100-1.2
description: "Disable Unused Connectors"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, connectors]
cis_id: "1.2"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2 Disable Unused Connectors (Not Scored)

## Description

The default installation of Tomcat includes connectors with default settings. These are traditionally set up for convenience. It is best to remove these connectors and enable only what is needed.

## Rationale

Improperly configured or unnecessarily installed Connectors may lead to a security exposure.

## Audit Procedure

Execute the following command to find configured Connectors. Ensure only those required are present and not commented out:

```bash
$ grep "Connector" $CATALINA_HOME/conf/server.xml
```

## Remediation

Within `$CATALINA_HOME/conf/server.xml`, remove or comment each unused Connector. For example, to disable an instance of the HTTPConnector, remove the following:

```xml
<Connector className="org.apache.catalina.connector.http.HttpConnector"
...
connectionTimeout="60000"/>
```

## Default Value

`$CATALINA_HOME/conf/server.xml` has the following connectors defined by default:

- A non-SSL Connector bound to port 8080
- An AJP 1.3 Connector bound to port 8009

## References

1. http://tomcat.apache.org/tomcat-8.0-doc/config/http.html#Connector_Comparison

## CIS Controls

- Not mapped in this benchmark version

## Profile Applicability

- Level 2
