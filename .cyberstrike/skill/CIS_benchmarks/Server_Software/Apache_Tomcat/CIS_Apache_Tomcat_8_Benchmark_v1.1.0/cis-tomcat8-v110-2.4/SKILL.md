---
name: cis-tomcat8-v110-2.4
description: "Disable X-Powered-By HTTP Header and Rename the Server Value for all Connectors (Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, information-leakage, http-headers, x-powered-by]
cis_id: "2.4"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Disable X-Powered-By HTTP Header and Rename the Server Value for all Connectors (Scored)

## Description

The `xpoweredBy` setting determines if Apache Tomcat will advertise its presence via the `X-Powered-By` HTTP header. It is recommended that this value be set to `false`. The server attribute overrides the default value that is sent down in the HTTP header further masking Apache Tomcat.

## Rationale

Preventing Tomcat from advertising its presence in this manner may increase the complexity for attackers to determine which vulnerabilities affect the server platform.

## Audit Procedure

Perform the following to determine if the server platform, as advertised in the HTTP Server header, has been changed:

1. Locate all Connector elements in `$CATALINA_HOME/conf/server.xml`.
2. Ensure each Connector has a server attribute and that the server attribute does not reflect Apache Tomcat. Also, make sure that the `xpoweredBy` attribute is **NOT** set to `true`.

## Remediation

Perform the following to prevent Tomcat from advertising its presence via the `X-Powered-By` HTTP header.

1. Add the `xpoweredBy` attribute to each Connector specified in `$CATALINA_HOME/conf/server.xml`. Set the `xpoweredBy` attributes value to `false`.

```xml
<Connector
...
xpoweredBy="false" />
```

Alternatively, ensure the `xpoweredBy` attribute for each Connector specified in `$CATALINA_HOME/conf/server.xml` is absent.

2. Add the server attribute to each Connector specified in `$CATALINA_HOME/conf/server.xml`. Set the server attribute value to anything except a blank string.

## Default Value

The default value is `false`.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/config/http.html
2. https://tomcat.apache.org/tomcat-8.5-doc/config/http.html

## CIS Controls

**v7:**

- 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
  - Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile Applicability

- Level 2
