---
name: cis-tomcat8-v100-6.4
description: "Ensure secure is set to true only for SSL-enabled Connectors"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, connector, ssl, tls]
cis_id: "6.4"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.4 Ensure secure is set to true only for SSL-enabled Connectors (Automated)

## Profile Applicability

• Level 1

## Description

The `secure` attribute is used to convey Connector security status to applications operating over the Connector. This is typically achieved by calling `request.isSecure()`. Ensure the `secure` attribute is only set to `true` for Connectors operating with the `SSLEnabled` attribute set to `true`.

## Rationale

Accurately reporting the security state of the Connector will help ensure that applications built on Tomcat are not unknowingly relying on security controls that are not in place.

## Audit Procedure

Review the `server.xml` and ensure the secure attribute is set to `true` for those Connectors having `SSLEnabled` set to `true`. Also, ensure the `secure` attribute is set to `false` for those Connectors having `SSLEnabled` set to `false`.

## Remediation

For each Connector defined in `server.xml`, set the `secure` attribute to `true` for those Connectors having `SSLEnabled` set to `true`. Set the `secure` attribute to `false` for those Connectors having `SSLEnabled` set to `false`.

```xml
<Connector SSLEnabled="true"
  …
  secure="true"
  …
/>
…
<Connector SSLEnabled="false"
  …
  secure="false"
  …
/>
```

## Default Value

The `secure` attribute is set to `false`.

## References

1. http://tomcat.apache.org/tomcat-9.0-doc/ssl-howto.html

## CIS Controls

**Controls Version: v8**

**Control:** 4 Secure Configuration of Enterprise Assets and Software

Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications).

**Controls Version: v7**

**Control:** 14.4 Encrypt All Sensitive Information in Transit

Encrypt all sensitive information in transit.

## Profile

Level 1
