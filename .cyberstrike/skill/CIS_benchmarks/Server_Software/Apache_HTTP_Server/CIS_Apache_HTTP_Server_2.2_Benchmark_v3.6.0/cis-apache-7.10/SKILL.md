---
name: cis-apache-7.10
description: "Ensure the TLSv1.0 and TLSv1.1 Protocols are Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, encryption, protocol-version, beast-attack]
cis_id: "7.10"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the TLSv1.0 and TLSv1.1 Protocols are Disabled

## Description

The TLSv1.0 and TLSv1.1 protocols should be disabled via the SSLProtocol directive. The TLSv1.0 protocol is vulnerable to information disclosure and both protocols lack support for modern cryptographic algorithms including authenticated encryption. The only SSL/TLS protocols that should be allowed is TLSv1.2 along with the new TLSv1.3 protocol when it is supported.

## Rationale

The TLSv1.0 protocol is vulnerable to the BEAST attack when used in CBC mode (October 2011). Unfortunately, the TLSv1.0 uses CBC modes for all of the block mode ciphers, which only leaves the RC4 streaming cipher which is also weak and is not recommended. Therefore, it is recommended that the TLSv1.0 protocol be disabled. The TLSv1.1 protocol does not support Authenticated Encryption with Associated Data (AEAD) which is designed to simultaneously provide confidentiality, integrity, and authenticity. All major up-to-date browsers support TLSv1.2, and most recent versions of FireFox and Chrome support the newer TLSv1.3 protocol, since 2017.

The NIST SP 800-52r2 guidelines for TLS configuration require that TLS 1.2 is configured with FIPS-based cipher suites be supported by all government TLS servers and clients and requires support of TLS 1.3 by January 1, 2024. A September 2018 IETF draft also depreciates the usage of TLSv1.0 and TLSv1.1 as shown in the references.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Search the Apache configuration files for the SSLProtocol directive and ensure it matches one of the values below.

```
SSLProtocol TLSv1.2 TLSv1.3
```

```
SSLProtocol TLSv1.2
```

## Remediation

Perform the following to implement the recommended state:

1. Check if the TLSv1.3 protocol is supported by the Apache server by either checking that the version of OpenSSL is 1.1.1a or later or place the TLSv1.3 value in the SSLProtocol string of a configuration file and check the syntax with the httpd -t command before using the file in production. Two examples below are shown of servers that do support the TLSv1.3 protocol.

```
$ openssl version
OpenSSL 1.1.1a  20 Nov 2018
```

```
### _(Add TLSv1.3 to the SSLProtocol directive)_
# httpd -t
Syntax OK
```

2. Search the Apache configuration files for the SSLProtocol directive; add the directive, if not present, or change the value to TLSv1.2 or TLSv1.2 TLSv1.3 if the TLSv1.3 protocol is supported.

## Default Value

```
SSLProtocol all -SSLv2
```

## References

1. https://caniuse.com/#search=tls%201.3
2. https://csrc.nist.gov/publications/detail/sp/800-52/rev-2/draft
3. https://en.wikipedia.org/wiki/Authenticated_encryption
4. https://tools.ietf.org/html/draft-ietf-tls-oldversions-deprecate-00
5. https://www.ietf.org/rfc/rfc8446.txt

## CIS Controls

Version 6

14.2 Encrypt All Sensitive Information Over Less-trusted Networks
All communication of sensitive information over less-trusted networks should be encrypted. Whenever information flows over a network with a lower trust level, the information should be encrypted.

Version 7

14.4 Encrypt All Sensitive Information in Transit
Encrypt all sensitive information in transit.

## Profile

Level 2 | Scored
