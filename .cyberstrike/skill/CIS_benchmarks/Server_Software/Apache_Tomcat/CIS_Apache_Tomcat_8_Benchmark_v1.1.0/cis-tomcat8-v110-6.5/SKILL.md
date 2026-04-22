---
name: cis-tomcat8-v110-6.5
description: "Ensure 'sslProtocol' is Configured Correctly for Secure Connectors"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, connector, ssl, tls]
cis_id: "6.5"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.5 Ensure 'sslProtocol' is Configured Correctly for Secure Connectors (Automated)

## Profile Applicability

• Level 1

## Description

The TLSv1.0 and TLSv1.1 protocols should be disabled via the sslProtocol directive. The TLSv1.0 protocol is vulnerable to information disclosure and both protocols lack support for modern cryptographic algorithms including authenticated encryption. The only SSL/TLS protocols which should be allowed are TLSv1.2 and the newer TLSv1.3 protocol.

## Rationale

The TLSv1.0 protocol is vulnerable to the BEAST attack when used in CBC mode (October 2011). Unfortunately, the TLSv1.0 uses CBC modes for all of the block mode ciphers, which only leaves the RC4 streaming cipher which is also weak and is not recommended. Therefore, it is recommended that the TLSv1.0 protocol be disabled. The TLSv1.1 protocol does not support Authenticated Encryption with Associated Data (AEAD) which is designed to simultaneously provide confidentiality, integrity, and authenticity. All major up-to-date browsers support TLSv1.2, and most recent versions of FireFox and Chrome support the newer TLSv1.3 protocol, since 2017.

The NIST SP 800-52r2 guidelines for TLS configuration require that TLS 1.2 is configured with FIPS-based cipher suites only by all government TLS servers and clients and requires support of TLS 1.3 by January 1, 2024. A September 2018 IETF draft also depreciates the usage of TLSv1.0 and TLSv1.1 as shown in the references.

As of March 2020 all major browsers will no longer support TLS 1.0 or TLS 1.1.

## Audit Procedure

Review `server.xml` to ensure the `sslProtocol` attribute is set to `TLSv1.2`, `TLSv1.3`, or `TLSv1.2+TLSv1.3` for all Connectors having `SSLEnabled` set to `true`.

## Remediation

In `server.xml`, set the `sslProtocol` attribute to `TLSv1.2+TLSv1.3` for Connectors having `SSLEnabled` set to `true`.

```xml
<Connector ...
  SSLEnabled="true"
  ...
  sslProtocol="TLSv1.2+TLSv1.3"
  ...
/>
```

## Default Value

Not configured by default.

## References

1. NIST SP 800-52r2: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-52r2.pdf
2. IETF Draft deprecating TLSv1.0 and TLSv1.1: https://datatracker.ietf.org/doc/html/draft-moriarty-tls-oldversions-diediedie-00
3. Browser support timeline: https://www.zdnet.com/article/google-apple-mozilla-and-microsoft-to-end-support-for-tls-1-0-and-1-1-in-march-2020/

## CIS Controls

None listed in the PDF.

## Profile

Level 1
