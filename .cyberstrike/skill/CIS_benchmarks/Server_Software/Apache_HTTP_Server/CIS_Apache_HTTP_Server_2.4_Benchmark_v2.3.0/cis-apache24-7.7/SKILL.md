---
name: cis-apache24-7.7
description: "Ensure SSL Compression is not Enabled (Manual)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, compression, crime]
cis_id: "7.7"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure SSL Compression is not Enabled (Manual)

## Profile Applicability

- Level 1

## Description

The `SSLCompression` directive controls whether SSL compression is used by Apache when serving content over HTTPS. It is recommended that the `SSLCompression` directive be set to `off`.

## Rationale

If SSL compression is enabled, HTTPS communication between the client and the server may be at increased risk to the CRIME attack. The CRIME attack increases a malicious actor's ability to derive the value of a session cookie, which commonly contains an authenticator. If the authenticator in a session cookie is derived, it can be used to impersonate the account associated with the authenticator.

## Audit

Perform the following steps to determine if the recommended state is implemented:

1. Search the Apache configuration files for the `SSLCompression` directive.
2. Verify that the directive either does not exist or exists and is set to `off`.

## Remediation

Perform the following to implement the recommended state:

1. Search the Apache configuration files for the `SSLCompression` directive.
2. If the directive is present, set it to `off`.

```apache
SSLCompression off
```

## Default Value

In Apache versions >= 2.4.3, the `SSLCompression` directive is available and SSL compression is implicitly disabled. In Apache 2.4 - 2.4.2, the `SSLCompression` directive is not available and SSL compression is implicitly disabled.

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html#sslcompression
2. https://en.wikipedia.org/wiki/CRIME_(security_exploit)

## CIS Controls

**v8:**

- 3.10 Encrypt Sensitive Data in Transit
  - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH).

**v7:**

- 14.4 Encrypt All Sensitive Information in Transit
  - Encrypt all sensitive information in transit.

## Profile

- Level 1
