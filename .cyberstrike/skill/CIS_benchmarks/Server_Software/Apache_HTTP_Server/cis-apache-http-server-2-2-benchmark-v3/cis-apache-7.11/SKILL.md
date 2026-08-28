---
name: cis-apache-7.11
description: "Ensure HTTP Strict Transport Security Is Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, hsts, headers, downgrade-attack]
cis_id: "7.11"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure HTTP Strict Transport Security Is Enabled

## Description

HTTP Strict Transport Security (HSTS) is an optional web server security policy mechanism specified by an HTTP Server header. The HSTS header allows a server declaration that only HTTPS communication should be used rather than clear text HTTP communication.

## Rationale

Usage of HTTP Strict Transport Security (HSTS) helps protect HSTS-compliant browsers and other agents from HTTP downgrade attacks. Downgrade attacks include a variety of man-in-the-middle attacks which leave the web communication vulnerable to disclosure and modification by forcing the usage of HTTP rather than HTTPS communication. The sslstrip attack tool by Moxie Marlinspike released in 2009 is one such attack, which works when a server allows both HTTP and HTTPS communication. However, a man-in-the-middle HTTP-to-HTTPS proxy would be effective in cases where the server required HTTPS but did not publish an HSTS policy to the browser. This attack would also be effective on browsers which were not compliant with HSTS. All current up-to-date browsers support HSTS.

The HSTS header specifies a length of time in seconds that the browser/user agent should access the server only using HTTPS. The header may also specify if all subdomains should also be included in the same policy. Once a compliant browser receives the HSTS header, it will not allow access to the server via HTTP. Therefore, it is important you ensure there is no portion of the web site or web application that requires HTTP prior to enabling the HSTS protocol.

If all subdomains are to be included via the includeSubDomains option, carefully consider all various hostnames, web applications, and third-party services used to include any DNS CNAME values that may be impacted. An overly broad includeSubDomains policy will disable access to HTTP websites for all websites with the same domain name. Also consider that the access will be disabled for the number of seconds given in the max-age value, so in the event a mistake is made, a large value, such as a year, could create significant support issues. An optional flag of preload may be added if the website name is to be submitted to be preloaded in Chrome, Firefox and Safari browsers. See https://hstspreload.appspot.com/ for details.

## Audit

Perform either of the following steps to determine if the recommended state is implemented.

At the Apache server level configuration and for every virtual host that is SSL enabled, verify there is a Header directive present that sets the Strict-Transport-Security header with a max-age value of at least 480 seconds or more (8 minutes or more). For example:

```
Header always set Strict-Transport-Security "max-age=600"
```

As an alternative, the configuration may be validated by connecting to the HTTPS server and verifying the presence of the header, such as the openssl s_client command shown below:

```
openssl s_client -connect www.example.com:443
GET / HTTP1.1.
Host:www.example.com


HTTP/1.1 200 OK
Date: Mon, 08 Dec 2014 18:28:29 GMT
Server: Apache
X-Frame-Options: NONE
Strict-Transport-Security: max-age=600
Last-Modified: Mon, 19 Jun 2006 14:47:16 GMT
ETag: "152-4169dd7a92500"
Accept-Ranges: bytes
Content-Length: 438
Connection: close
Content-Type: text/html
```

## Remediation

Perform the following to implement the recommended state:

Add a Header directive as shown below in the Apache server level configuration and every virtual host that is SSL enabled. The includeSubDomains and preload flags may be included in the header, but are not required.

```
Header always set Strict-Transport-Security "max-age=600"; includeSubDomains;
preload
- or -
Header always set Strict-Transport-Security "max-age=600"
```

## Default Value

The Strict Transport Security header is not present by default.

## References

1. https://en.wikipedia.org/wiki/HTTP_Strict_Transport_Security
2. https://www.owasp.org/index.php/HTTP_Strict_Transport_Security
3. https://moxie.org/software/sslstrip/
4. https://developer.mozilla.org/en-US/docs/Web/Security/HTTP_strict_transport_security
5. https://hstspreload.appspot.com/

## CIS Controls

Version 6

14.2 Encrypt All Sensitive Information Over Less-trusted Networks
All communication of sensitive information over less-trusted networks should be encrypted. Whenever information flows over a network with a lower trust level, the information should be encrypted.

Version 7

14.4 Encrypt All Sensitive Information in Transit
Encrypt all sensitive information in transit.

## Profile

Level 2 | Scored
