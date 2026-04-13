---
name: cis-apache-7.8
description: "Ensure Medium Strength SSL/TLS Ciphers Are Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, encryption, ciphers, 3des, idea]
cis_id: "7.8"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Medium Strength SSL/TLS Ciphers Are Disabled

## Description

The SSLCipherSuite directive specifies which ciphers are allowed in the negotiation with the client. Disable the medium strength ciphers such as Triple DES (3DES) and IDEA by adding !3DES and !IDEA in the SSLCipherSuite directive.

## Rationale

Although Triple DES was a trusted standard in the past, several vulnerabilities for it have been published over the years and it is no longer considered secure. A somewhat recent attack against 3DES in CBC mode, nicknamed the SWEET32 attack, was published in 2016 as CVE-2016-2183. The IDEA cipher in CBC mode is also vulnerable to the SWEET32 attack.

## Audit

Perform the following steps to determine if the recommended state is implemented:

• The SSL protocols and ciphers supported can be easily tested by connecting to a running web server with an up-to-date version of the sslscan tool. The tool is available on Kali Linux https://www.kali.org/ or via github https://github.com/rbsec/sslscan Use the command below to detect 3DES and IDEA ciphers. No output means the ciphers are not allowed.

```
$ sslscan --no-colour www.lugor.org | egrep 'IDEA|DES'
Accepted TLSv1.2 112 bits ECDHE-RSA-DES-CBC3-SHA        Curve P-256
DHE 256
Accepted TLSv1.2 112 bits EDH-RSA-DES-CBC3-SHA          DHE 2048
bits
Accepted TLSv1.2 112 bits DES-CBC3-SHA
Accepted TLSv1.1 112 bits ECDHE-RSA-DES-CBC3-SHA        Curve P-256
DHE 256
Accepted TLSv1.1 112 bits EDH-RSA-DES-CBC3-SHA          DHE 2048
bits
Accepted TLSv1.1 112 bits DES-CBC3-SHA
```

• Alternatively, the Qualys SSL Labs has a website that may be used for testing external servers https://www.ssllabs.com/.

• Alternatively, verify the SSLCipherSuite directive includes !3DES and !IDEA to disable the ciphers in the Apache server level configuration and every virtual host that is SSL/TLS enabled.

## Remediation

Perform the following to implement the recommended state:

Add or modify the following lines in the Apache server level configuration and every virtual host that is SSL/TLS enabled:

```
SSLHonorCipherOrder On
SSLCipherSuite ALL:!EXP:!NULL:!LOW:!SSLv2:!RC4:!aNULL:!3DES:!IDEA
```

**IMPORTANT NOTE:** The above SSLCipherSuite value disables only the weak and medium ciphers but allows other ciphers which should also be disabled. Refer to the remaining TLS benchmark recommenations for more stronger cipher suite values. The following cipher suite value will meet all of the level 1 and level 2 benchmark recommendations. As always, testing prior to production use is highly recommended.

```
SSLHonorCipherOrder On
SSLCipherSuite ECDH:EDH:!NULL:!SSLv2:!RC4:!aNULL:!3DES:!IDEA
```

## Default Value

The SSLCipherSuite default depends on the OpenSSL version.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_ssl.html#sslciphersuite
2. https://httpd.apache.org/docs/2.2/mod/mod_ssl.html#sslhonorcipherorder
3. https://sweet32.info/
4. https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2016-2183
5. https://github.com/rbsec/sslscan

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
