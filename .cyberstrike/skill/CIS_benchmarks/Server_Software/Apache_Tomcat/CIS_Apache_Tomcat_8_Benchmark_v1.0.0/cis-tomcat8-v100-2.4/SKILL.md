---
name: cis-tomcat8-v100-2.4
description: "Disable X-Powered-By HTTP Header and Rename the Server Value for all Connectors"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, information-leakage, x-powered-by, http-headers]
cis_id: "2.4"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.4 Disable X-Powered-By HTTP Header and Rename the Server Value for all Connectors (Scored)

## Description

The xpoweredBy setting determines if Apache Tomcat will advertise its presence via the X-Powered-By HTTP header. It is recommended that this value be set to false. The server attribute overrides the default value that is sent down in the HTTP header further masking Apache Tomcat.

## Rationale

Preventing Tomcat from advertising its presence in this manner may make it harder for attackers to determine which vulnerabilities affect the server platform.

## Audit Procedure

1. Locate all Connector elements in $CATALINA_HOME/conf/server.xml.
2. Ensure each Connector has a server attribute and that the server attribute does not reflect Apache Tomcat. Also, make sure that the xpoweredBy attribute is NOT set to true.

## Remediation

1. Add the xpoweredBy attribute to each Connector specified in $CATALINA_HOME/conf/server.xml. Set the xpoweredBy attributes value to false.

```xml
<Connector
...
xpoweredBy="false" />
```

2. Add the server attribute to each Connector specified in $CATALINA_HOME/conf/server.xml. Set the server attribute value to anything except a blank string.

## Default Value

The default value is false.

## References

1. http://tomcat.apache.org/tomcat-8.0-doc/config/http.html

## CIS Controls

- Not mapped in this benchmark version

## Profile Applicability

- Level 2
