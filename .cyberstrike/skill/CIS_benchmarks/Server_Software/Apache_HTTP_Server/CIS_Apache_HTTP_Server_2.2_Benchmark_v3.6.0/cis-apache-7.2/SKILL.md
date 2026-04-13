---
name: cis-apache-7.2
description: "Ensure a Valid Trusted Certificate Is Installed"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, certificates, encryption]
cis_id: "7.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure a Valid Trusted Certificate Is Installed

## Description

The default SSL certificate is self-signed and is not trusted. Install a valid certificate signed by a commonly trusted certificate authority. To be valid, the certificate must be:

- Signed by a trusted certificate authority
- Not be expired, and
- Have a common name that matches the host name of the web server, such as www.example.com.

**Note:** Some previously "Trusted" Certificate Authority certificates had been signed with a weak hash algorithm such as MD5, or SHA1. These signature algorithms are known to be vulnerable to collision attacks. Note that it's not the just the signature on the server's certificate, but any signature up the certificate chain. Such CA certificates are considered no longer trusted as of January 1, 2017.

## Rationale

A digital certificate on your server automatically communicates your site's authenticity to visitors' web browsers. If a trusted authority signs your certificate, it confirms for visitors they are actually communicating with you, and not with a fraudulent site stealing credit card numbers or personal information.

## Impact

None documented

## Audit Procedure

Perform one or more of the following steps to determine if the recommended state is implemented:

1. The Qualys SSL Labs has a website that may be used for testing external servers. https://www.ssllabs.com/ssltest/ Enter the external host name of the server and wait for an extensive tests of TLS protocols and ciphers, in addition to testing the server certificate and the entire certificate authority chain. The SSL Labs test will report any weak digital signatures of the intermediate certificate authorities. For example, the report may include a warning of:

```
Intermediate certificate has an insecure signature. Upgrade to SHA2 as
soon as possible to avoid browser warnings.
```

In addition, the weak SHA1 or MD5 signature algorithm will be highlighted with red text where the additional intermediate CA certificates are enumerated. For example, the certificate below from an SSL Labs report used SHA1 for the digital signature:

- Subject The Go Daddy Group, Inc.
- Fingerprint SHA256: 18f8a7...
- Pin SHA256: VjLZe...
- Valid until Sat, 29 Jun ...
- Key RSA 2048 bits (e 3)
- Issuer http://www...
- Signature algorithm **SHA1withRSA INSECURE**

If a weak signature is found, then follow your certificate authority's process for having the server certificate re-issued / re-signed, in order to ensure that it is signed with a strong digital signature.

2. If the server is not an external server, or is not running on the standard port 443, a vulnerability scanner such as Nessus can also be used to validate both the server certificate and the intermediate certificate chain. Custom certificate authorities may also be tested by loading the root certificate into the vulnerability scanner.

3. The testing can also be done by connecting to a running web server with your favorite browser and checking for a warning with regard to the certificate trust. However, some browsers may not warn of weak digital signatures, or other certificate issues.

4. OpenSSL can also be used to validate a certificate as a valid trusted certificate, using a trusted bundle of CA certificate. It is important that the CA bundle of certificates be an already validated and trusted file in order for the test to be valid.

```
$ openssl verify -CAfile /etc/ssl/certs/ca-bundle.crt -purpose
sslserver
/etc/ssl/certs/example.com.crt
/etc/ssl/certs/example.com.crt: OK
```

A specific error message and code will be reported in addition to the OK if the certificate is not valid, For example:

```
error 10 at 0 depth lookup:certificate has expired
OK
```

Of course, it is important here as well to be sure of the integrity of the trusted certificate authorities used by the web client. Visit the OWASP testing SSL web page for additional suggestions:
https://www.owasp.org/index.php/Testing_for_SSL-TLS_%28OWASP-CM-001%29

## Remediation

Perform the following to implement the recommended state:

1. Decide on the hostname to be used for the certificate. It is important to remember that the browser will compare the hostname in the URL to the common name in the certificate, so it is important that all https: URLs match the correct hostname. Specifically, the hostname www.example.com is not the same as example.com nor the same as ssl.example.com.

2. Generate a private key using openssl. Although certificate key lengths of 1024 have been common in the past, a key length of 2048 is now recommended for strong authentication. The key must be kept confidential and will be encrypted with a passphrase by default. Follow the steps below and respond to the prompts for a passphrase. See the Apache or OpenSSL documentation for details:
   - http://httpd.apache.org/docs/2.2/ssl/ssl_faq.html#realcert
   - http://www.openssl.org/docs/HOWTO/certificates.txt

```
# cd /etc/pki/tls/certs
# umask 077
# openssl genrsa -aes128 2048 > example.com.key
Generating RSA private key, 2048 bit long modulus
...+++
...........+++
e is 65537 (0x10001)
Enter pass phrase:
Verifying - Enter pass phrase:
```

3. Create a certificate specific template configuration file. It is important that common name in the certificate exactly make the web host name in the intended URL. If there are multiple host names which may be used, as is very common, then the subjectAltName (SAN) field should be filled with all of the alternate names. Creating a template configuration file specific to the server certificate is helpful, as it allows for multiple entries in the subjectAltName. Also, any typos in the CSR can be potentially costly due to the lost time, so using a file, rather than hand typing helps prevent errors. To create a file, make a local copy of the openssl.cnf typically found in /etc/ssl/ or /etc/pki/tls/

```
# cp /etc/ssl/openssl.cnf ex1.cnf>
```

4. Find the request section which follows the line "[ req ]". Then add or modify the configuration file to include the appropriate values for the host names. It is recommended (but not required) that the first subjectAltName match the commonName.

```
[ req ]
. . .
distinguished_name = req_distinguished_name
req_extensions = req_ext
```

5. Continue editing the configuration file under the request distinguished name section to change the existing default values in the configuration file to match the desired certificates information.

```
[ req_distinguished_name ]
countryName_default             = GB
stateOrProvinceName_default     = Scotland
localityName_default            = Glasgow
0.organizationName_default      = Example Company Ltd
organizationalUnitName_default  = ICT
commonName_default              = www.example.com
```

6. Now generate the CSR from the template file, verifying the information. If the default values were placed in the template, then just press enter to confirm the default value.

```
# openssl req -new -config ex2.cnf -out example.com.csr -key
example.com.key
Enter pass phrase for example.com.key:
You are about to be asked to enter information that will be
incorporated
into your certificate request.
What you are about to enter is what is called a Distinguished Name or a
DN.
There are quite a few fields but you can leave some blank
For some fields there will be a default value,
If you enter '.', the field will be left blank.
-----
Country Name (2 letter code) [GB]:
State or Province Name (full name) [Scotland]:
Locality Name (eg, city) [Glasgow]:
Organization Name (eg, company) [Example Company Ltd]:
Organizational Unit Name (eg, section) [ICT]:
Common Name (e.g. server FQDN or YOUR name) [www.example.com]:
```

7. Review and verify the CSR information including the SAN by displaying the information.

```
# openssl req -in ex2.csr -text | more

Certificate Request:
    Data:
        Version: 1 (0x0)
        Subject: C = GB, ST = Scotland, L = Glasgow, O = Example
Company Ltd, OU = ICT, CN = www.example.com
            Subject Public Key Info:
                Public Key Algorithm: rsaEncryption
                    Public-Key: (2048 bit)
                    Modulus:
                        00:cb:c2:7a:04:13:19:7a:c0:74:00:63:dd:e9:6e:
                        . . . <snip> . . .
                        3a:9d:aa:50:09:4a:40:48:b4:e2:24:ef:fa:7b:42:
                        a4:33
                    Exponent: 65537 (0x10001)
            Attributes:
            Requested Extensions:
                X509v3 Subject Alternative Name:
                    DNS:www.example.com, DNS:example.com,
DNS:app.example.com, DNS:ws.example.com
                    X509v3 Basic Constraints:
                        CA:FALSE
                    X509v3 Key Usage:
                        Digital Signature, Non Repudiation, Key Encipherment
            Signature Algorithm: sha256WithRSAEncryption
                73:f0:e3:90:a7:ab:01:e4:7f:12:19:b7:6a:dd:be:4e:5c:f1:
                . . .
```

8. Now move the private key to its intended directory.

```
# mv www.example.com.key /etc/ssl/private/
```

9. Send the certificate signing request (CSR) to a certificate signing authority to be signed, and follow their instructions for submission and validation. The CSR and the final signed certificate are just encoded text and need to be protected for integrity, but not confidentiality. This certificate will be given out for every SSL connection made.

10. The resulting signed certificate may be named www.example.com.crt and placed in /etc/ssl/certs/ as readable by root (umask 444). Please note that the certificate authority does not need the private key (example.com.key) and this file must be carefully protected. With a decrypted copy of the private key, it would be possible to decrypt all conversations with the server.

11. Do not forget the passphrase used to encrypt the private key. It will be required every time the server is started in https mode. If it is necessary to avoid requiring an administrator having to type the passphrase every time the httpd service is started, the private key may be stored in clear text. Storing the private key in clear text increases the convenience while increasing the risk of disclosure of the key, but may be appropriate for the sake of being able to restart, if the risks are well managed. Be sure that the key file is only readable by root. To decrypt the private key and store it in clear text file the following openssl command may be used. You can tell by the private key headers whether it is encrypted or clear text.

```
# cd /etc/ssl/private/
# umask 077
```

12. Locate the Apache configuration file for mod_ssl and add or modify the SSLCertificateFile and SSLCertificateKeyFile directives to have the correct path for the private key and signed certificate files. If a clear text key is referenced then a passphrase will not be required. You may need to configure the CA's certificate along with any intermediate CA certificates that signed your certificate using the SSLCertificateChainFile directive. As an alternative, starting with Apache version 2.4.8 the CA and intermediate certificates may be concatenated to the server certificate configured with the SSLCertificateFile directive instead.

```
SSLCertificateFile /etc/ssl/certs/example.com.crt
SSLCertificateKeyFile /etc/ssl/private/example.com.key
# Default CA file, can be concatenated with your CA certificate.
SSLCertificateChainFile /etc/ssl/certs/server-chain.crt
```

13. Lastly, start or restart the httpd service and verify correct functioning with your favorite browser.

## References

1. https://www.owasp.org/index.php/Testing_for_SSL-TLS_%28OWASP-CM-001%29
2. https://httpd.apache.org/docs/2.2/ssl/ssl_faq.html#realcert
3. https://www.openssl.org/docs/HOWTO/certificates.txt
4. https://security.googleblog.com/2014/09/gradually-sunsetting-sha-1.html

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
