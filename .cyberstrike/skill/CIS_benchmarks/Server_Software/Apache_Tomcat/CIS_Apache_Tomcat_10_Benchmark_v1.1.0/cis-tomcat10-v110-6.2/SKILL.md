---
name: cis-tomcat10-v110-6.2
description: "Ensure SSLEnabled is set to True for Sensitive Connectors"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, connector, ssl, tls]
cis_id: "6.2"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2 Ensure SSLEnabled is set to True for Sensitive Connectors (Automated)

## Profile Applicability

• Level 1

## Description

The `SSLEnabled` setting determines if SSL is enabled for a specific Connector. It is recommended that SSL be utilized for any Connector that sends or receives sensitive information, such as authentication credentials or personal information.

## Rationale

The `SSLEnabled` setting ensures SSL is active, which will in-turn ensure the confidentiality and integrity of sensitive information while in transit.

## Audit Procedure

Review the `server.xml` and ensure all Connectors sending or receiving sensitive information have the `SSLEnabled` attribute set to `true`.

## Remediation

In `server.xml`, set the `SSLEnabled` attribute to `true` for each Connector that sends or receives sensitive information

```xml
<Connector
…
SSLEnabled="true"
…
/>
```

## Default Value

`SSLEnabled` is set to `false`.

## References

1. http://tomcat.apache.org/tomcat-9.0-doc/ssl-howto.html
2. https://tomcat.apache.org/tomcat-9.0-doc/config/http.html

## CIS Controls

**Controls Version: v8**

**Control:** 3.10 Encrypt Sensitive Data in Transit

Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH).

**IG 1:**
**IG 2:** •
**IG 3:** •

**Controls Version: v7**

**Control:** 14.4 Encrypt All Sensitive Information in Transit

Encrypt all sensitive information in transit.

**IG 1:**
**IG 2:** •
**IG 3:** •

## Profile

Level 1
