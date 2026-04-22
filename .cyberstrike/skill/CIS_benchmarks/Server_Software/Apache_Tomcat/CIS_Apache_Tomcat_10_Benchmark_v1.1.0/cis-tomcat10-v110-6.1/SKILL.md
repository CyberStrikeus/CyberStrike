---
name: cis-tomcat10-v110-6.1
description: "Setup Client-cert Authentication"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, connector, ssl, tls, client-cert]
cis_id: "6.1"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1 Setup Client-cert Authentication (Automated)

## Profile Applicability

• Level 2

## Description

Client-cert authentication requires that each client connecting to the server have a certificate to authenticate. This is generally regarded as stronger authentication than a password as it requires the client to have the certificate and not just know a password.

## Rationale

Certificate based authentication is more secure than password based authentication.

## Audit Procedure

Review the Connector configuration in `server.xml` and ensure the `clientAuth` is set to `true` and `certificateVerification` is set to `required`.

## Remediation

In the Connector element, set the `clientAuth` parameter to `true` and the `certificateVerification` to `required`

```xml
<!-- Define a SSL Coyote HTTP/1.1 Connector on port 8443 -->

<Connector
  port="8443" minProcessors="5" maxProcessors="75"
  enablelookups="true" disableUploadTimeout="true"
  acceptCount="100" debug="0" scheme="https" secure="true";
  clientAuth="true" sslProtocol="TLS"/>
...
<Connector ...>
  <SSLHostConfig
    certificateVerification="required"
  />
```

## Default Value

Not configured

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/http.html
2. https://tomcat.apache.org/tomcat-9.0-doc/ssl-howto.html

## CIS Controls

**Controls Version: v8**

**Control:** 5.2 Use Unique Passwords

Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts not using MFA and a 14-character password for accounts not using MFA.

**IG 1:** •
**IG 2:** •
**IG 3:** •

**Controls Version: v7**

**Control:** 16.4 Encrypt or Hash all Authentication Credentials

Encrypt or hash with a salt all authentication credentials when stored.

**IG 1:**
**IG 2:** •
**IG 3:** •

## Profile

Level 2
