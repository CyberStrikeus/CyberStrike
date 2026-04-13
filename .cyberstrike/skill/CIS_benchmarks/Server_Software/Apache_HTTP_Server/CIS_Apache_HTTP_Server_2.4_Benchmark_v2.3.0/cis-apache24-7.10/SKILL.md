---
name: cis-apache24-7.10
description: "Ensure OCSP Stapling Is Enabled (Manual)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, ocsp, stapling, certificates]
cis_id: "7.10"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure OCSP Stapling Is Enabled (Manual)

## Profile Applicability
- Level 2

## Description

The OCSP (Online Certificate Status Protocol) provides the current revocation status of an X.509 certificate and allows for certificate authority to revoke the validity of a signed certificate before its expiration date. The URI for the OCSP server is included in the certificate and verified by the browser. The Apache `SSLUseStapling` directive along with the `SSLStaplingCache` directive is recommended to enable OCSP Stapling by the web server. If the client requests OCSP stapling, then the web server can include the OCSP server response along with the web server's X.509 certificate.

## Rationale

The OCSP protocol is a big improvement over CRLs (certificate revocation lists) for checking if a certificate has been revoked. There are however some minor privacy and efficiency concerns with OCSP. The fact that the browser has to check a third-party CA discloses that the browser is connecting for OCSP checking. Also, the already high overhead of making an SSL connection is increased by the need for the OCSP requests and responses. The OCSP stapling improves the situation by having the SSL server "staple" an OCSP response, signed by the OCSP server, to the certificate it presents to the client. This obviates the need for the client to ask the OCSP server for status information on the server certificate. However, the client will still need to make OCSP requests on any intermediate CA certificates that are typically used to sign the server's certificate.

## Audit

Perform the following steps to determine if the recommended state is implemented. At the Apache server level configuration and for every virtual host that is SSL enabled:

- Verify the `SSLStaplingCache` directive is present and not commented out. There are three supported cache types, any of them are considered compliant.
- Verify the `SSLUseStapling` directive is enabled with a value of `on`

## Remediation

Perform the following to implement the recommended state: Add or modify the `SSLUseStapling` directive to have a value of `on` in the Apache server level configuration and every virtual host that is SSL enabled. Also ensure that `SSLStaplingCache` is set to one of the three cache types similar to the examples below.

```apache
SSLUseStapling On
SSLStaplingCache "shmcb:logs/ssl_staple_cache(512000)"
- or-
SSLStaplingCache "dbm:logs/ssl_staple_cache.db"
- or -
SSLStaplingCache dc:UNIX:logs/ssl_staple_socket
```

## Default Value

`SSLUseStapling Off SSLStaplingCache <no default value>`

## References

1. https://en.wikipedia.org/wiki/OCSP_stapling - OCSP Stapling
2. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html- Apache SSL Directives

## CIS Controls

**v8:**
- 3.10 Encrypt Sensitive Data in Transit
  - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH).

**v7:**
- 14.4 Encrypt All Sensitive Information in Transit
  - Encrypt all sensitive information in transit.

## Profile
- Level 2
