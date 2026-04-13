---
name: cis-apache-7.1
description: "Ensure mod_ssl and/or mod_nss Is Installed"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, encryption, certificates]
cis_id: "7.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure mod_ssl and/or mod_nss Is Installed

## Description

Secure Sockets Layer (SSL) was developed by Netscape and turned into an open standard and was renamed Transport Layer Security (TLS) as part of the process. TLS is important for protecting communication and can provide authentication of the server and even the client. However, contrary to vendor claims, implementing SSL does NOT directly make your web server more secure! SSL is used to encrypt traffic and therefore does provide confidentiality of private information and users credentials. Keep in mind, however that just because you have encrypted the data it does not mean that the data provided by the client is secure while it is on the server. Also, SSL does not protect the web server, as attackers will easily target SSL-Enabled web servers, and the attack will be hidden in the encrypted channel.

The mod_ssl module is the standard, most used module that implements SSL/TLS for Apache. A newer module found on Red Hat systems can be a compliment or replacement for mod_ssl and provides the same functionality plus additional security services. The mod_nss is an Apache module implementation of the Network Security Services (NSS) software from Mozilla, which implements a wide range of cryptographic functions in addition to TLS.

## Rationale

It is best to plan for SSL/TLS implementation from the beginning of any new web server because most web servers have some need for SSL/TLS due to:

- Non-public information submitted that should be protected as it's transmitted to the web server
- Non-public information that is downloaded from the web server
- Users authenticating to some portion of the web server
- Authenticating the web server to ensure users they have reached the real web server and have not been phished or redirected to a bogus site

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Ensure the mod_ssl and/or mod_nss is loaded in the Apache configuration:

```
# httpd -M | egrep 'ssl_module|nss_module'
```

Results should show "Syntax OK" along with either or both of the modules.

## Remediation

Perform either of the following to implement the recommended state:

1. For Apache installations built from source, use the option --with-ssl= to specify the openssl path, and the --enable=ssl configure option to add the SSL modules to the build. The --with-included-apr configure option may be necessary if there are conflicts with the platform openssl. See the Apache or OpenSSL documentation on building from source http://httpd.apache.org/docs/2.2/install.html for details.

```
# ./configure --with-included-apr --with-ssl=$OPENSSL_DIR --enable=ssl
```

2. For installations using OS packages, it is typically just a matter of ensuring the mod_ssl package is installed. The mod_nss package might also be installed. The following yum command is suitable for Red Hat Linux.

```
# yum install mod_ssl
```

## Default Value

SSL/TLS is not enabled by default.

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_ssl.html
2. https://developer.mozilla.org/en-US/docs/Mozilla/Projects/NSS/Reference/Building_and_installing_NSS

## CIS Controls

Version 6

14.2 Encrypt All Sensitive Information Over Less-trusted Networks
    All communication of sensitive information over less-trusted networks should be
    encrypted. Whenever information flows over a network with a lower trust level, the
    information should be encrypted.

Version 7

14.4 Encrypt All Sensitive Information in Transit
    Encrypt all sensitive information in transit.

## Profile

Level 1 | Scored
Level 2 | Scored
