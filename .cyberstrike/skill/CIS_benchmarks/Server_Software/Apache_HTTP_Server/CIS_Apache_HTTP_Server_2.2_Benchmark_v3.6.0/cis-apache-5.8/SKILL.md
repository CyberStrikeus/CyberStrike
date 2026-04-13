---
name: cis-apache-5.8
description: "Ensure the HTTP TRACE Method Is Disabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options, http-methods]
cis_id: "5.8"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the HTTP TRACE Method Is Disabled

## Description

Use the Apache `TraceEnable` directive to disable the HTTP `TRACE` request method. Refer to the Apache documentation for more details:
http://httpd.apache.org/docs/2.2/mod/core.html#traceenable

## Rationale

The HTTP 1.1 protocol requires support for the `TRACE` request method, which reflects the request back as a response and was intended for diagnostics purposes. The `TRACE` method is not needed and is easily subjected to abuse, so it should be disabled.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Verify there is a single `TraceEnable` directive configured with a value of `off`.

## Remediation

Perform the following to implement the recommended state:

1. Locate the main Apache configuration file such as `httpd.conf`.
2. Add a `TraceEnable` directive to the server level configuration with a value of `off`. Server level configuration is the top level configuration, not nested within any other directives like `<Directory>` or `<Location>`.

```apache
TraceEnable off
```

## Default Value

on

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#traceenable
2. https://www.ietf.org/rfc/rfc2616.txt

## CIS Controls

Version 6

9.1 Limit Open Ports, Protocols, and Services
Ensure that only ports, protocols, and services with validated business needs are running on each system.

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile

Level 1 | Scored
