---
name: cis-apache-7.12
description: "Ensure Only Cipher Suites That Provide Forward Secrecy Are Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, forward-secrecy, ciphers, ecdhe, dhe, pfs]
cis_id: "7.12"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Only Cipher Suites That Provide Forward Secrecy Are Enabled

## Description

In cryptography, forward secrecy (FS), which is also known as perfect forward secrecy (PFS), is a feature of specific key exchange protocols that give assurance that your session keys will not be compromised even if the private key of the server is compromised. Protocols such as RSA do not provide the forward secrecy, while the protocols ECDHE (Elliptic-Curve Diffie-Hellman Ephemeral) and the DHE (Diffie-Hellman Ephemeral) will provide forward secrecy. The ECDHE is the stronger protocol and should be preferred, while the DHE may be allowed for greater compatibility with older clients. The TLS ciphers should be configured to require either the ECDHE or the DHE ephemeral key exchange, while not allowing other cipher suites.

## Rationale

During the TLS handshake, after the initial client & server Hello, there is a pre-master secret generated, which is used to generate the master secret, and in turn generates the session key. When using protocols that do not provide forward secrecy, such as RSA, the pre-master secret is encrypted by the client with the server's public key and sent over the network. However, with protocols such as ECDHE (Elliptic-Curve Diffie-Hellman Ephemeral) the pre-master secret is not sent over the wire, even in encrypted format. The key exchange arrives at the shared secret in the clear using ephemeral keys that are not stored or used again. With FS, each session has a unique key exchange, so that future sessions are protected.

## Audit

Perform one of the following to determine if the recommended state is implemented:

• The SSL protocols and ciphers supported can be easily tested by connecting to a running web server with an up-to-date version of the sslscan tool. The tool is available on Kali Linux https://www.kali.org/, or via github https://github.com/rbsec/sslscan. Usage of Kali Linux for sslscan is highly recommended rather than other Linux distributions as it is important that the scan make use of an SSL library that still enables the old protocols. Current Linux versions often wisely eliminate support for older protocols such as SSLv3, and therefore may be unable to properly detect the availability of older protocols on a remote system. A statically compiled sslscan with its own openssl library that supports the older protocols may be used as well.

Check the output of sslscan, and confirm that all accepted ciphers begin with either 'ECDHE-' or 'DHE-'. Any ciphers not starting with one of the ephemeral Diffie-Hellman algorithms, is not implementing the recommended state. The sslscan command below includes regular expressions which will extract any ciphers which are not included in the recommendation. No output means that only the FS ciphers are allowed.

```
$ sslscan --no-colour --no-failed www.example.com | egrep
'(^Accepted)|(^Preferred)' | egrep -v '(
ECDHE-)|(  DHE-)'
```

• Alternatively, Qualys SSL Labs has a website that is very thorough and is commonly used for testing external servers. The report will show the cipher suites allowed along with many other details. https://www.ssllabs.com/ssltest/ The recommended cipher suites will start with TLS*ECDHE* or TLS*DHE* and have the initials FS at the end for forward secrecy.

• Alternatively find the specified values for the SSLCipherSuite directive in the Apache server level configuration and every virtual host that is SSL/TLS enabled. Then use the openssl command on the local system to verify the specified SSLCipherSuite directive only allows cipher suites that begin with the ECDHE- or DHE- algorithms. For example:

```
$ openssl ciphers -v
'ECDH:EDH:!NULL:!SSLv2:!RC4:!3DES:!IDEA:!aNULL:!SHA1'
ECDHE-RSA-AES256-GCM-SHA384 TLSv1.2 Kx=ECDH     Au=RSA  Enc=AESGCM(256)
Mac=AEAD
ECDHE-ECDSA-AES256-GCM-SHA384 TLSv1.2 Kx=ECDH    Au=ECDSA
Enc=AESGCM(256) Mac=AEAD
ECDHE-RSA-AES256-SHA384 TLSv1.2 Kx=ECDH      Au=RSA  Enc=AES(256)
Mac=SHA384
ECDHE-ECDSA-AES256-SHA384 TLSv1.2 Kx=ECDH     Au=ECDSA Enc=AES(256)
Mac=SHA384
ECDHE-RSA-AES128-GCM-SHA256 TLSv1.2 Kx=ECDH    Au=RSA  Enc=AESGCM(128)
Mac=AEAD
ECDHE-ECDSA-AES128-GCM-SHA256 TLSv1.2 Kx=ECDH      Au=ECDSA
Enc=AESGCM(128) Mac=AEAD
ECDHE-RSA-AES128-SHA256 TLSv1.2 Kx=ECDH      Au=RSA  Enc=AES(128)
Mac=SHA256
ECDHE-ECDSA-AES128-SHA256 TLSv1.2 Kx=ECDH     Au=ECDSA Enc=AES(128)
Mac=SHA256
DHE-DSS-AES256-GCM-SHA384 TLSv1.2 Kx=DH        Au=DSS  Enc=AESGCM(256)
Mac=AEAD
DHE-RSA-AES256-GCM-SHA384 TLSv1.2 Kx=DH        Au=RSA  Enc=AESGCM(256)
Mac=AEAD
DHE-RSA-AES256-SHA256   TLSv1.2 Kx=DH      Au=RSA  Enc=AES(256)
Mac=SHA256
```

## Remediation

Perform one of the following to implement the recommended state:

• Add or modify the following line in the Apache server level configuration and every virtual host that is SSL/TLS enabled:

```
SSLCipherSuite EEDH:EDH:!NULL:!SSLv2:!RC4:!aNULL:!3DES:!IDEA
```

• The more recent versions of openssl (such as 1.0.2 and newer) will support the usage of ECDHE as a synonym for EECDH and DHE as a synonym for EDH in the cipher specification. The usage of ECDHE and DHE are preferred so that the specification matches the expected output. So, the cipher specification could be:

```
SSLCipherSuite ECDHE:DHE:!NULL:!SSLv2:!RC4:!aNULL:!3DES:!IDEA
```

## Default Value

The default value for SSLCipherSuite depends on OpenSSL library version used.

## References

1. https://en.wikipedia.org/wiki/Forward_secrecy
2. https://scotthelme.co.uk/perfect-forward-secrecy/
3. https://www.owasp.org/index.php/TLS_Cipher_String_Cheat_Sheet

## CIS Controls

Version 6

14.2 Encrypt All Sensitive Information Over Less-trusted Networks
All communication of sensitive information over less-trusted networks should be encrypted. Whenever information flows over a network with a lower trust level, the information should be encrypted.

Version 7

14.4 Encrypt All Sensitive Information in Transit
Encrypt all sensitive information in transit.

18.5 Use Only Standardized and Extensively Reviewed Encryption Algorithms
Use only standardized and extensively reviewed encryption algorithms.

## Profile

Level 2 | Scored
