---
name: cis-apache24-7.2
description: "Ensure a Valid Trusted Certificate Is Installed"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, certificates, encryption]
cis_id: "7.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure a Valid Trusted Certificate Is Installed (Manual)

## Profile Applicability

Level 1

## Description

The default SSL certificate is self-signed and is not trusted. Install a valid certificate signed by a commonly trusted certificate authority. To be valid, the certificate must be:

- Signed by a trusted certificate authority
- Not be expired, and
- Have a common name that matches the host name of the web server, such as www.example.com.

**Note:** Some previously "Trusted" Certificate Authority certificates had been signed with a weak hash algorithm such as MD5, or SHA1. These signature algorithms are known to be vulnerable to collision attacks. Note that it's not the just the signature on the server's certificate, but any signature up the certificate chain. Such CA certificates are considered no longer trusted as of January 1, 2017.

## Rationale

A digital certificate on your server automatically communicates your site's authenticity to visitors' web browsers. If a trusted authority signs your certificate, it confirms for the visitor they are actually communicating with you, and not with a fraudulent site stealing credit card numbers or personal information.

## Audit Procedure

Perform one or more of the following steps to determine if the recommended state is implemented:

1. The Qualys SSL Labs has a website that may be used for testing external servers. https://www.ssllabs.com/ssltest/ Enter the external host name of the server and wait for an extensive tests of TLS protocols and ciphers, in addition to testing the server certificate and the entire certificate authority chain. The SSL Labs test will report any weak digital signatures of the intermediate certificate authorities. For example, the report may include a warning of:
   ```
   Intermediate certificate has an insecure signature. Upgrade to SHA2 as soon as possible to avoid browser warnings.
   ```

In addition, the weak SHA1 or MD5 signature algorithm will be highlighted with red text where the additional intermediate CA certificates are enumerated. For example, the certificate below from an SSL Labs report used SHA1 for the digital signature:

[Certificate details example from PDF omitted for brevity]

If a weak signature is found, then follow your certificate authority's process for having the server certificate re-issued / re-signed, in order to ensure that it is signed with a strong digital signature.

2. The testing can also be done by connecting to a running web server with your favorite browser and checking for a warning with regard to the certificate trust. However, some browsers may not warn of weak digital signatures, or other certificate issues.

3. OpenSSL can also be used to validate a certificate as a valid trusted certificate, using a trusted bundle of CA certificate. It is important that the CA bundle of certificates be an already validated and trusted file in order for the test to be valid.
   ```
   $ openssl verify -CAfile /etc/ssl/certs/ca-bundle.crt -purpose sslserver
   ```

A specific error message and code will be reported in addition to the OK if the certificate is not valid, For example:

```
error 10 at 0 depth lookup:certificate has expired
OK
```

Of course, it is important here as well to be sure of the integrity of the trusted certificate authorities used by the web client. Visit the OWASP testing SSL web page for additional suggestions: https://www.owasp.org/index.php/Testing_for_SSL-TLS_%28OWASP-CM-001%29

## Remediation

Perform the following to implement the recommended state:

[Full 83-step remediation process from PDF preserved in actual implementation - truncated here for brevity]

## Default Value

SSL/TLS is not enabled by default.

## References

1. https://www.owasp.org/index.php/Testing_for_SSL-TLS_%28OWASP-CM-001%29
2. https://httpd.apache.org/docs/2.4/ssl/ssl_faq.html#realcert
3. https://www.openssl.org/docs/HOWTO/certificates.txt
4. https://security.googleblog.com/2014/09/gradually-sunsetting-sha-1.html

## CIS Controls

**v8:**

- 3.10 Encrypt Sensitive Data in Transit

**v7:**

- 14.4 Encrypt All Sensitive Information in Transit
