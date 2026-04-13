---
name: cis-apache-7.4
description: "Ensure Weak SSL Protocols Are Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, encryption, certificates]
cis_id: "7.4"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Weak SSL Protocols Are Disabled

## Description

The Apache SSLProtocol directive specifies the SSL and TLS protocols allowed. Both the SSLv2 and the SSLv3 protocols should be disabled in this directive because they are outdated and vulnerable to information disclosure. Only TLS protocols should be enabled.

## Rationale

The SSLv2 and SSLv3 protocols are flawed and shouldn't be used, as they are subject to man-in-the-middle attacks and other cryptographic attacks. The TLSv1 protocols should be used instead, and the newer TLS protocols are preferred.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

Verify the SSLProtocol directive is present in the Apache server level configuration and every virtual host that is SSL enabled. For each directive, verify that either:

- a minus -SSLv2 and a minus -SSLv3 are included
- an explicit list of only TLS protocols without any plus (+) or minus (-) symbols

## Remediation

Perform the following to implement the recommended state:

Search the Apache configuration files for the SSLProtocol directive. Add the directive if not present or change the value to match the following values. The first setting TLS1.2 is preferred when it is acceptable to also disable the TLSv1.0 and TLSv1.1 protocols. See the level 2 recommendation "Ensure the TLSv1.0 and TLSv1.1 Protocols are Disabled" for details.

```
SSLProtocol TLS1.2
```

```
SSLProtocol TLSv1
```

## Default Value

```
SSLProtocol all -SSLv2
```

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_ssl.html#sslprotocol
2. https://www.owasp.org/index.php/Testing_for_SSL-TLS_%28OWASP-CM-001%29
3. https://www.us-cert.gov/ncas/alerts/TA14-290A
4. https://www.openssl.org/~bodo/ssl-poodle.pdf

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
