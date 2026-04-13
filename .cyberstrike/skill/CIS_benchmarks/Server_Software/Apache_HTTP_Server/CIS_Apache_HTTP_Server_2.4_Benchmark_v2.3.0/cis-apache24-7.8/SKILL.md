---
name: cis-apache24-7.8
description: "Ensure Medium Strength SSL/TLS Ciphers Are Disabled (Manual)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, cipher-suite, 3des, idea, sweet32]
cis_id: "7.8"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Medium Strength SSL/TLS Ciphers Are Disabled (Manual)

## Profile Applicability
- Level 1

## Description

The SSLCipherSuite directive specifies which ciphers are allowed in the negotiation with the client. Disable the medium strength ciphers such as Triple DES (3DES) and IDEA by adding `!3DES` and `!IDEA` in the SSLCipherSuite directive.

## Rationale

Although Triple DES has been a trusted standard in the past, several vulnerabilities for it have been published over the years and it is no longer considered secure. A vulnerable against 3DES in CBC mode was nicknamed the SWEET32 attack, was published in 2016 as CVE-2016-2183. The IDEA cipher in CBC mode, is also vulnerable to the SWEET32 attack.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

- The SSL protocols and ciphers supported can be easily tested by connecting to a running web server with an up-to-date version of the sslscan tool. The tool is available on Kali Linux https://www.kali.org/ or via github https://github.com/rbsec/sslscan Use the command below to detect 3DES and IDEA ciphers. No output means the ciphers are not allowed.
  - `$ sslscan --no-colour www.example.org | egrep 'IDEA|DES'`
  - `Accepted TLSv1.2 112 bits ECDHE-RSA-DES-CBC3-SHA Curve P-256 DHE 256`
  - `Accepted TLSv1.2 112 bits EDH-RSA-DES-CBC3-SHA DHE 2048 bits`
  - `Accepted TLSv1.2 112 bits DES-CBC3-SHA`
  - `Accepted TLSv1.1 112 bits ECDHE-RSA-DES-CBC3-SHA Curve P-256 DHE 256`
  - `Accepted TLSv1.1 112 bits EDH-RSA-DES-CBC3-SHA DHE 2048 bits`
  - `Accepted TLSv1.1 112 bits DES-CBC3-SHA`
- Alternatively, the Qualys SSL Labs has a website that may be used for testing external servers. https://www.ssllabs.com/
- Alternatively, verify the `SSLCipherSuite` directive includes the `!3DES` and the `!IDEA` to disable the ciphers in the Apache server level configuration and every virtual host that is SSL/TLS enabled.

## Remediation

Perform the following to implement the recommended state: Add or modify the following lines in the Apache server level configuration and every virtual host that is SSL/TLS enabled:

```apache
SSLHonorCipherOrder On
SSLCipherSuite ALL:!EXP:!NULL:!LOW:!SSLv2:!RC4:!aNULL:!3DES:!IDEA
```

**IMPORTANT NOTE:** The above `SSLCipherSuite` value disables only the weak and medium ciphers but allows other ciphers which should also be disabled. Refer to the remaining TLS benchmark recommendations for more stronger cipher suite values. The following cipher suite value will meet all of the level 1 and level 2 benchmark recommendations. As always, testing prior to production use is highly recommended.

```apache
SSLHonorCipherOrder On
SSLCipherSuite EECDH:EDH:!NULL:!SSLv2:!RC4:!aNULL:!3DES:!IDEA
```

## Default Value

The following are the default values:

`SSLCipherSuite` default depends on OpenSSL version.

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html#sslprotocol
2. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html#sslciphersuite
3. https://sweet32.info/
4. https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2016-2183
5. https://github.com/rbsec/sslscan
6. https://www.openssl.org/

## CIS Controls

**v8:**
- 3.10 Encrypt Sensitive Data in Transit
  - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH).

**v7:**
- 14.4 Encrypt All Sensitive Information in Transit
  - Encrypt all sensitive information in transit.

## Profile
- Level 1
