---
name: cis-apache-7.5
description: "Ensure Weak SSL/TLS Ciphers Are Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, encryption, certificates]
cis_id: "7.5"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Weak SSL/TLS Ciphers Are Disabled

## Description

Disable weak SSL ciphers using the SSLCipherSuite and SSLHonorCipherOrder directives. The SSLCipherSuite directive specifies which ciphers are allowed in the negotiation with the client. The SSLHonorCipherOrder directive causes the server's preferred ciphers to be used instead of the clients' specified preferences.

## Rationale

The SSL/TLS protocols support a large number of encryption ciphers, including many weak ciphers that are subject to man-in-the-middle attacks and information disclosure. Some implementations even support the NULL cipher, which allows a TLS connection without any encryption! Therefore, it is critical to ensure the configuration only allows strong ciphers greater than or equal to 128 bit to be negotiated with the client. Stronger 256-bit ciphers should be allowed and preferred. In addition, enabling SSLHonorCipherOrder further protects the client from man-in-the-middle downgrade attacks by ensuring the server's preferred ciphers will be used rather than the clients' preferences.

In addition, the RC4 stream ciphers should be disabled, even though they are widely used and have been recommended in previous Apache benchmarks as a means of mitigating attacks based on CBC cipher vulnerabilities. The RC4 ciphers have known cryptographic weaknesses and are no longer recommended. The IETF has published the RFC 7465 standard[4] that would disallow RC4 negotiation for all TLS versions. While the document is somewhat new (Feb 2015), it is expected the RC4 cipher suites will begin to disappear from options in TLS deployments. In the meantime, it is important to ensure that RC4-based cipher suites are disabled in the configuration.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

The SSL protocols and ciphers supported can be easily tested by connecting to a running web server with an up-to-date version of the sslscan tool. The tool is available on Kali Linux https://www.kali.org/ or via github https://github.com/rbsec/sslscan. The tool will color highlight the following weak ciphers:

- Red Background NULL cipher (no encryption)
- Red Broken cipher (<= 40 bit), broken protocol (SSLv2 or SSLv3), or broken certificate signing algorithm (MD5)
- Yellow Weak cipher (<= 56 bit or RC4) or weak certificate signing algorithm (SHA-1)
- Purple Anonymous cipher (ADH or AECDH)

Alternatively, the Qualys SSL Labs has a website that may be used for testing external servers https://www.ssllabs.com/.

Alternatively Verify the SSLCipherSuite directive is present and has the following values to disable weak ciphers in the Apache server level configuration and every virtual host that is SSL/TLS enabled.

```
SSLHonorCipherOrder On
SSLCipherSuite ALL:!EXP:!NULL:!LOW:!SSLv2:!RC4:!aNULL
```

## Remediation

Perform the following to implement the recommended state:

Ensure the SSLCipherSuite includes all of the following:

!NULL:!SSLv2:!RC4:!aNULL values. For example add or modify the following line in the Apache server level configuration and every virtual host that is TLS enabled:

```
SSLHonorCipherOrder On
SSLCipherSuite ALL:!EXP:!NULL:!LOW:!SSLv2:!RC4:!aNULL
```

It is **not** recommended to add !SSLv3 to the directive even if the SSLv3 protocol is not in use. Doing so disables ALL of the ciphers that may used with SSLv3, which includes the same ciphers used with the TLS protocols. The !aNULL will disable both the ADH and AECDH ciphers, so the !ADH is not required.

**IMPORTANT NOTE:** The above SSLCipherSuite value disables only the weak ciphers but allows medium strength and other ciphers which should also be disabled. Refer to the remaining TLS benchmark recommendations for stronger cipher suite values. The following cipher suite value will meet all of the level 1 and level 2 benchmark recommendations. As always, testing prior to production use is highly recommended.

```
SSLHonorCipherOrder On
SSLCipherSuite ECDH:EDH:!NULL:!SSLv2:!RC4:!aNULL:!3DES:!IDEA
```

## Default Value

The following are the default values: SSLCipherSuite default depends on OpenSSL version.
SSLHonorCipherOrder Off

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_ssl.html#sslciphersuite
2. https://httpd.apache.org/docs/2.2/mod/mod_ssl.html#sslhonorcipherorder
3. https://github.com/rbsec/sslscan
4. https://tools.ietf.org/html/rfc7465
5. https://community.qualys.com/blogs/securitylabs/2013/03/19/rc4-in-tls-is-broken-now-what

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
