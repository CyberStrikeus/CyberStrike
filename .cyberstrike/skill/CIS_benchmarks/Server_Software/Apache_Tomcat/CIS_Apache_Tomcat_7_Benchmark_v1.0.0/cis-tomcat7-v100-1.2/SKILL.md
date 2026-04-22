---
name: cis-tomcat7-v100-1.2
description: "Disable Unused Connectors"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-7, connectors, hardening]
cis_id: "1.2"
cis_benchmark: "CIS Apache Tomcat 7 Benchmark v1.0.0"
tech_stack: [tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Apache Tomcat 7 - 1.2 Disable Unused Connectors (Not Scored)

## Profile Applicability

- Level 2

## Description

The default installation of Tomcat includes connectors with default settings. These are traditionally set up for convenience. It is best to remove these connectors and enable only what is needed.

## Rationale

Improperly configured or unnecessarily installed Connectors may lead to a security exposure.

## Audit Procedure

Perform the following to identify configured Connectors:

1. Execute the following command to find configured Connectors. Ensure only those required are present and not commented out:

```bash
$ grep "Connector" $CATALINA_HOME/conf/server.xml
```

## Remediation

Perform the following to disable unused Connectors:

1. Within `$CATALINA_HOME/conf/server.xml`, remove or comment each unused Connector. For example, to disable an instance of the HTTPConnector, remove the following:

```xml
<Connector className="org.apache.catalina.connector.http.HttpConnector"
...
connectionTimeout="60000"/>
```

## Default Value

`$CATALINA_HOME/conf/server.xml`, has the following connectors defined by default:

- A non-SSL Connector bound to port 8080
- An AJP 1.3 Connector bound to port 8009

## References

- http://tomcat.apache.org/tomcat-7.0-doc/config/http.html#Connector_Comparison

## CIS Controls

Version 7:

- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Assessment Status

- **Not Scored**
- **Profile**: Level 2
