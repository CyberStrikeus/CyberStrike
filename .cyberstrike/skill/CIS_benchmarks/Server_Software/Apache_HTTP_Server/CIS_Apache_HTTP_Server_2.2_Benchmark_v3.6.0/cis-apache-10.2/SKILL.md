---
name: cis-apache-10.2
description: "Ensure the LimitRequestFields Directive is Set to 100 or Less"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, request-limits, hardening]
cis_id: "10.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the LimitRequestFields Directive is Set to 100 or Less

## Description

The `LimitRequestFields` directive limits the number of fields allowed in an HTTP request.

## Rationale

The limiting of the number of fields is helpful so that the web server can prevent an unexpectedly high number of fields from being passed to a potentially vulnerable CGI program, module or application that would have attempted to process the request. Of course, the underlying dependency is that we need to set the limits high enough to not interfere with any one application on the server, while setting them low enough to be of value in protecting the applications. Since the configuration directives are available only at the server configuration level, it is not possible to tune the value for different portions of the same web server. Please read the Apache documentation carefully, as these requests may interfere with the expected functionality of some web applications.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Verify that the `LimitRequestFields` directive is in the Apache configuration and has a value of `100` or less.

## Remediation

Perform the following to implement the recommended state:

Add or modify the `LimitRequestFields` directive in the Apache configuration to have a value of `100` or less. If the directive is not present, the default depends on a compile time configuration, but defaults to a value of `100`.

```
LimitRequestFields 100
```

## Default Value

```
LimitRequestFields 100
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#limitrequestfields

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
