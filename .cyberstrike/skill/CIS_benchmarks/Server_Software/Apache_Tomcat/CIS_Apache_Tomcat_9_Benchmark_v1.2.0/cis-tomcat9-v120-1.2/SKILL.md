---
name: cis-tomcat9-v120-1.2
description: "Disable Unused Connectors (Manual)"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, connectors]
cis_id: "1.2"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Disable Unused Connectors (Manual)

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

Within the `$CATALINA_HOME/conf/server.xml`, remove, or comment out, each unused Connector. For example, to disable an instance of the HTTPConnector, remove the following:

```xml
<Connector className="org.apache.catalina.connector.http.HttpConnector"
...
connectionTimeout="60000"/>
```

## Default Value

`$CATALINA_HOME/conf/server.xml`, has the following connectors defined by default:

- A non-SSL HTTP Connector bound to port 8080
- An AJP Connector bound to port 8009

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/http.html
2. https://tomcat.apache.org/tomcat-9.0-doc/security-howto.html#Connectors

## CIS Controls

**v8:**

- 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
  - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

**v7:**

- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running
  - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile Applicability

- Level 2
