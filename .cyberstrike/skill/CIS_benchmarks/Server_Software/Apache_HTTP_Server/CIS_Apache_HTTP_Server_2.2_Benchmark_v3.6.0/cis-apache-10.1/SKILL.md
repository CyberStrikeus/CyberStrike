---
name: cis-apache-10.1
description: "Ensure the LimitRequestLine directive is Set to 512 or less"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, request-limits, hardening]
cis_id: "10.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the LimitRequestLine directive is Set to 512 or less

## Description

Buffer Overflow attacks attempt to exploit an application by providing more data than the application buffer can contain. If the application allows copying data to the buffer to overflow the boundaries of the buffer, the application is vulnerable to a buffer overflow. The results of Buffer overflow vulnerabilities vary, and may result in the application crashing, or may allow the attacker to execute instructions provided in the data. The Apache `LimitRequest*` directives allow the Apache web server to limit the sizes of requests and request fields and can be used to help protect programs and applications processing those requests.

Specifically, the `LimitRequestLine` directive limits the allowed size of a client's HTTP request-line, which consists of the HTTP method, URI, and protocol version.

## Rationale

The limiting of the size of the request line is helpful so that the web server can prevent an unexpectedly long or large request from being passed to a potentially vulnerable CGI program, module or application that would have attempted to process the request. Of course, the underlying dependency is that we need to set the limits high enough to not interfere with any one application on the server, while setting them low enough to be of value in protecting the applications. Since the configuration directive is available only at the server configuration level, it is not possible to tune the value for different portions of the same web server. Please read the Apache documentation carefully, as these requests may interfere with the expected functionality of some web applications.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Verify that the `LimitRequestLine` directive is in the Apache configuration and has a value of `512` or less.

## Remediation

Perform the following to implement the recommended state:

Add or modify the `LimitRequestLine` directive in the Apache configuration to have a value of `512` or less.

```
LimitRequestLine 512
```

## Default Value

```
LimitRequestline 8190
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#limitrequestline

## CIS Controls

**Version 6**

9 Limitation and Control of Network Ports, Protocols, and Services
Limitation and Control of Network Ports, Protocols, and Services

**Version 7**

5.1 Establish Secure Configurations
Maintain documented, standard security configuration standards for all authorized
operating systems and software.

## Profile

Level 2 | Scored
