---
name: cis-apache-7.6
description: "Ensure Insecure SSL Renegotiation Is Not Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, encryption, certificates]
cis_id: "7.6"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Insecure SSL Renegotiation Is Not Enabled

## Description

A man-in-the-middle renegotiation attack was discovered in SSLv3 and TLSv1 in Nov 2009 (CVE-2009-3555, http://www.ietf.org/mail-archive/web/tls/current/msg03928.html). The workaround which removes the renegotiation is available from OpenSSL as of version 0.9.8l and newer versions. For details: http://www.openssl.org/news/secadv_20091111.txt The SSLInsecureRenegotiation directive was added in Apache 2.2.15 for web servers linked with OpenSSL version 0.9.8m or later, to allow the insecure renegotiation to provide backward compatibility to clients with older unpatched SSL implementations. While providing backward compatibility, enabling the SSLInsecureRenegotiation directive also leaves the server vulnerable to man-in-the-middle renegotiation attack CVE-2009-3555. Therefore, the SSLInsecureRenegotiation directive should not be enabled.

## Rationale

The seriousness and ramification of this attack warrants that servers and clients be upgraded to support the improved SSL/TLS protocols. Therefore, the recommendation is to not enable the insecure renegotiation.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Search the Apache configuration files for the SSLInsecureRenegotiation directive and verify that the directive is either not present or has a value of off.

## Remediation

Perform the following to implement the recommended state:

Search the Apache configuration files for the SSLInsecureRenegotiation directive. If the directive is present, modify the value to be off. If the directive is not present, no action is required.

```
SSLInsecureRenegotiation off
```

## Default Value

```
SSLInsecureRenegotiation off
```

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_ssl.html#sslinsecurerenegotiation
2. https://cve.mitre.org/cgi-bin/cvename.cgi?name=CAN-2009-3555

## CIS Controls

Version 6

14.2 Encrypt All Sensitive Information Over Less-trusted Networks
    All communication of sensitive information over less-trusted networks should be
    encrypted. Whenever information flows over a network with a lower trust level,
    the information should be encrypted.

Version 7

14.4 Encrypt All Sensitive Information in Transit
    Encrypt all sensitive information in transit.

## Profile

Level 1 | Scored
Level 2 | Scored
