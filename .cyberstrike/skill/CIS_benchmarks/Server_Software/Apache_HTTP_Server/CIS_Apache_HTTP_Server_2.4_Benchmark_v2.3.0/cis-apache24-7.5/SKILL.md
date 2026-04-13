---
name: cis-apache24-7.5
description: "Ensure Weak SSL/TLS Ciphers Are Disabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, certificates, encryption]
cis_id: "7.5"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Weak SSL/TLS Ciphers Are Disabled (Manual)

## Profile Applicability

Level 1

## Description

Disable weak SSL ciphers using the SSLCipherSuite, and SSLHonorCipherOrder directives. The SSLCipherSuite directive specifies which ciphers are allowed in the negotiation with the client. While the SSLHonorCipherOrder causes the server's preferred ciphers to be used instead of the clients' specified preferences.

## Rationale

The SSL/TLS protocols support a large number of encryption ciphers including many weak ciphers that are subject to man-in-the-middle attacks and information disclosure. Some implementations even support the NULL cipher which allows a TLS connection without any encryption! Therefore, it is critical to ensure the configuration only allows strong ciphers greater than or equal to 128-bit to be negotiated with the client. Stronger 256-bit ciphers should be allowed and preferred. In addition, enabling the SSLHonorCipherOrder further protects the client from man-in-the-middle downgrade attacks by ensuring the server's preferred ciphers will be used rather than the clients' preferences.

In addition, the RC4 stream ciphers should be disabled, even though they are widely used and have been recommended by Apache benchmarks as a means of mitigating attacks based on CBC cipher vulnerabilities. The RC4 ciphers have known cryptographic weaknesses and are no longer recommended. The IETF has published RFC 7465 standard [2] that would disallow RC4 negotiation for all TLS versions. While the document is somewhat new (Feb 2015) it is expected that the RC4 cipher suites will begin to disappear from options in TLS deployments. In the meantime, it is important to ensure that RC4-based cipher suites are disabled in the configuration.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

The SSL protocols and ciphers supported can be easily tested by connecting to a running web server with an up-to-date version of the sslscan tool. The tool is available on Kali Linux https://www.kali.org/, or via github https://github.com/rbsec/sslscan The tool will color highlight the following weak ciphers.

- Red Background NULL cipher (no encryption)
- Red Broken cipher (<= 40 bit), broken protocol (SSLv2 or SSLv3)
- Yellow Weak cipher (<= 56 bit or RC4)
- Purple Anonymous cipher (ADH or AECDH)

Alternatively, the Qualys SSL Labs has a website that may be used for testing external servers. https://www.ssllabs.com/

Alternatively, verify the SSLCipherSuite directive is present and has the following values to disable weak ciphers in the Apache server level configuration and every virtual host that is SSL/TLS enabled.

```
SSLHonorCipherOrder On
SSLCipherSuite ALL:!EXP:!NULL:!LOW:!SSLv2:!RC4:!aNULL
```

It is **not** recommended to add !SSLv3 to the directive even if the SSLv3 protocol is not in use. Doing so disables ALL of the ciphers that may used with SSLv3, which includes the same ciphers used with the TLS protocols. The !aNULL will disable both the ADH and AECDH ciphers, so the !ADH is not required.

**IMPORTANT NOTE:** The above SSLCipherSuite value disables only the weak ciphers but allows medium strength and other ciphers which should also be disabled. Refer to the remaining TLS benchmark recommendations for stronger cipher suite values. The following cipher suite value will meet all of the level 1 and level 2 benchmark recommendations. As always, testing prior to production use is highly recommended.

```
SSLHonorCipherOrder On
SSLCipherSuite EECDH:EDH:!NULL:!SSLv2:!RC4:!aNULL:!3DES:!IDEA
```

## Default Value

The following are the default values:

`SSLCipherSuite` default depends on OpenSSL version.

`SSLHonorCipherOrder` default is Off

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html#sslciphersuite
2. https://www.ssllabs.com/
3. https://csrc.nist.gov/publications/detail/sp/800-52/rev-2/final
4. https://www.bsi.bund.de/SharedDocs/Downloads/EN/BSI/Publications/TechGuidelines/TG02102/BSI-TR-02102-2.pdf
5. https://community.qualys.com/blogs/securitylabs/2013/03/19/rc4-in-tls-is-broken-now-what
6. https://github.com/rbsec/sslscan

## CIS Controls

**v8:**
- 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software

**v7:**
- 11.4 Install the Latest Stable Version of Any Security-related Updates on All Network Devices
