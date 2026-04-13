---
name: cis-apache-7.7
description: "Ensure SSL Compression is Not Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, compression, crime-attack]
cis_id: "7.7"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure SSL Compression is Not Enabled

## Description

The SSLCompression directive controls whether SSL compression is used by Apache when serving content over HTTPS. It is recommended that the SSLCompression directive be set to off.

## Rationale

If SSL compression is enabled, HTTPS communication between the client and the server may be at increased risk to the CRIME attack. The CRIME attack increases a malicious actor's ability to derive the value of a session cookie, which commonly contains an authenticator. If the authenticator in a session cookie is derived, it can be used to impersonate the account associated with the authenticator.

## Impact

None documented

## Audit Procedure

For Apache 2.2.26 and later, perform the following steps to determine if the recommended state is implemented:

1. Search the Apache configuration files for the SSLCompression directive.
2. Verify that the directive either does not exist or exists and is set to off.

For Apache 2.2.24 and 2.2.25, perform the following steps to determine if the recommended state is implemented:

1. Search the Apache configuration files for the SSLCompression directive.
2. Verify that the directive exists and is set to off. (The default value is on.)

Apache versions prior to 2.2.24 do not support disabling SSL compression and are not compliant.

## Remediation

Perform the following to implement the recommended state:

1. Verify the Apache version is 2.2.24 or later, with the command httpd -v.
2. Search the Apache configuration files for the SSLCompression directive.
3. Add or update the directive to have a value of off.

## Default Value

The SSLCompression directive was available in httpd 2.2.24 and later, if using OpenSSL 0.9.8 or later; virtual host scope is available if using OpenSSL 1.0.0 or later. The default used to be ON in versions 2.2.24 to 2.2.25 and is OFF for 2.2.26 and later.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_ssl.html#sslcompression
2. https://en.wikipedia.org/wiki/CRIME_(security_exploit)

## CIS Controls

Version 6

14.2 Encrypt All Sensitive Information Over Less-trusted Networks
All communication of sensitive information over less-trusted networks should be encrypted. Whenever information flows over a network with a lower trust level, the information should be encrypted.

Version 7

14.4 Encrypt All Sensitive Information in Transit
Encrypt all sensitive information in transit.

## Profile

Level 1 | Scored
Level 2 | Scored
