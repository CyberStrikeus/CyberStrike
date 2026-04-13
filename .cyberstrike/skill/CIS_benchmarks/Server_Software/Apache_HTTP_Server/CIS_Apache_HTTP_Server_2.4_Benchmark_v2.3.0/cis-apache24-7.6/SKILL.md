---
name: cis-apache24-7.6
description: "Ensure Insecure SSL Renegotiation Is Not Enabled (Manual)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, renegotiation, cve-2009-3555]
cis_id: "7.6"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Insecure SSL Renegotiation Is Not Enabled (Manual)

## Profile Applicability
- Level 1

## Description

A man-in-the-middle renegotiation attack was discovered in SSLv3 and TLSv1 in November 2009 (CVE-2009-3555). First, a work around and then a fix was approved as an Internet Standard as RFC 574, Feb 2010. The work around, which removes the renegotiation, is available from OpenSSL as of version 0.9.8l and newer versions. For details: https://www.openssl.org/news/secadv_20091111.txt The `SSLInsecureRenegotiation` directive was added in Apache 2.2.15, for web servers linked with OpenSSL version 0.9.8m or later, to provide backward compatibility to clients with the older, unpatched SSL implementations.

## Rationale

Enabling the `SSLInsecureRenegotiation` directive leaves the server vulnerable to man-in-the-middle renegotiation attack. Therefore, the `SSLInsecureRenegotiation` directive should not be enabled.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Search the Apache configuration files for the `SSLInsecureRenegotiation` directive and verify that the directive is either not present or has a value of `off`.

## Remediation

Perform the following to implement the recommended state:

Search the Apache configuration files for the `SSLInsecureRenegotiation` directive. If the directive is present modify the value to be off. If the directive is not present then no action is required.

```apache
SSLInsecureRenegotiation off
```

## Default Value

```apache
SSLInsecureRenegotiation off
```

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html#sslinsecurerenegotiation
2. https://cve.mitre.org/cgi-bin/cvename.cgi?name=CAN-2009-3555
3. https://azure.microsoft.com/en-us/services/multi-factor-authentication/

## CIS Controls

**v8:**
- 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
  - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

**v7:**
- 14.4 Encrypt All Sensitive Information in Transit
  - Encrypt all sensitive information in transit.

## Profile
- Level 1
