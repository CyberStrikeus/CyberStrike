---
name: cis-apache24-7.3
description: "Ensure the Server's Private Key Is Protected"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, certificates, encryption]
cis_id: "7.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Server's Private Key Is Protected (Manual)

## Profile Applicability

Level 1

## Description

It is critical to protect the server's private key. The server's private key is encrypted by default as a means of protecting it. However, having it encrypted means that the passphrase is required each time the server is started up, and now it is necessary to protect the passphrase as well. The passphrase may be typed in when it is manually started up or provided by an automated program. To summarize, the options are:

1. Use SSLPassPhraseDialog builtin, - requires a passphrase to be manually entered.
2. Use SSLPassPhraseDialog |/path/to/program to provide the passphrase.
3. Use SSLPassPhraseDialog exec:/path/to/program to provide the passphrase,
4. Store the private key in clear text so that a passphrase is not required.

Any of the above options 1-4 are acceptable as long as the key and passphrase are protected as described below. Option 1 has the additional security benefit of not storing the passphrase, but is not generally acceptable for most production web servers, since it requires the web server to be manually started. Options 2 and 3 can provide additional security if the programs providing them are secure. Option 4 is the simplest, is widely used and is acceptable as long as the private key is appropriately protected.

## Rationale

If the private key were to be disclosed, it could be used to decrypt all of the SSL communications with the web server as well as to impersonate the web server.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. For each certificate file referenced in the Apache configuration files with the SSLCertificateFile directive, examine the file for a private key, clearly identified by the string PRIVATE KEY---.

2. For each file referenced in the Apache configuration files with the SSLCertificateKeyFile directive, verify the ownership is root:root and the permission 0400.

## Remediation

Perform the following to implement the recommended state:

1. All private keys must be stored separately from the public certificates. Find all SSLCertificateFile directives in the Apache configuration files. For any SSLCertificateFile directives that do not have a corresponding separate SSLCertificateKeyFile directive, move the key to a separate file from the certificate, and add the SSLCertificateKeyFile directive for the key file.

2. For each of the SSLCertificateKeyFile directives, change the ownership and permissions on the server private key to be owned by root:root with permission 0400.
   ```
   # chown root:root <ssl_certificate_key_file>
   # chmod 0400 <ssl_certificate_key_file>
   ```

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html
2. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html#sslpassphrasedialog

## CIS Controls

**v8:**
- 6.8 Define and Maintain Role-Based Access Control

**v7:**
- 14.6 Protect Information through Access Control Lists
