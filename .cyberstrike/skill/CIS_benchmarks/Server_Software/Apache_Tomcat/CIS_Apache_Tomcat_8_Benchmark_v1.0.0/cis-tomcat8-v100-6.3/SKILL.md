---
name: cis-tomcat8-v100-6.3
description: "Ensure scheme is set accurately"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, connector, ssl, tls]
cis_id: "6.3"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3 Ensure scheme is set accurately (Automated)

## Profile Applicability

• Level 1

## Description

The `scheme` attribute is used to indicate to callers of `request.getScheme()` which scheme is in use by the Connector. Ensure the `scheme` attribute is set to `http` for Connectors operating over HTTP. Ensure the scheme attribute is set to `https` for Connectors operating over HTTPS.

## Rationale

Maintaining parity between the scheme in use by the Connector and advertised by `request.getScheme()` will ensure applications built on Tomcat have an accurate depiction of the context and security guarantees provided to them.

## Audit Procedure

Review the `server.xml` to ensure the Connector's `scheme` attribute is set to `http` for Connectors operating over HTTP. Also ensure the Connector's `scheme` attribute is set to `https` for Connectors operating over HTTPS.

## Remediation

In `server.xml`, set the Connector's `scheme` attribute to `http` for Connectors operating over HTTP. Set the Connector's `scheme` attribute to `https` for Connectors operating over HTTPS.

```xml
<Connector
  …
  scheme="https"
  …
/>
```

## Default Value

The `scheme` attribute is set to `http`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/ssl-howto.html
2. https://tomcat.apache.org/tomcat-9.0-doc/config/http.html

## CIS Controls

**Controls Version: v8**

**Control:** 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure

Use standard, industry-recommended hardening configuration templates for application infrastructure components. This includes underlying servers, databases, and web servers, and applies to cloud containers, Platform as a Service (PaaS) components, and SaaS components. Do not allow in-house developed software to weaken configuration hardening.

**IG 1:**
**IG 2:** •
**IG 3:** •

**Controls Version: v7**

**Control:** 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

**IG 1:**
**IG 2:** •
**IG 3:** •

## Profile

Level 1
