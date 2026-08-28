---
name: cis-apache24-10.4
description: "Ensure the LimitRequestBody Directive is Set to 102400 or Less but not 0 (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, request-limits, buffer-overflow, limit-request-body]
cis_id: "10.4"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the LimitRequestBody Directive is Set to 102400 or Less but not 0 (Automated)

## Profile Applicability

- Level 2

## Description

The `LimitRequestBody` directive limits the number of bytes that are allowed in a request body. Size of requests may vary greatly; for example, during a file upload the size of the file must fit within this limit.

## Rationale

The limiting of the size of the request body is helpful so that the web server can prevent an unexpectedly long or large request from being passed to a potentially vulnerable program. Of course, the underlying dependency is that we need to set the limits high enough to not interfere with any one application on the server, while setting them low enough to be of value in protecting the applications. The `LimitRequestBody` may be configured on a per directory, or per location context. Please read the Apache documentation carefully, as these requests may interfere with the expected functionality of some web applications.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Verify that the `LimitRequestBody` directive in the Apache configuration to have a value of `102400` (100K) or less, but not 0.

## Remediation

Perform the following to implement the recommended state:

Add or modify the `LimitRequestBody` directive in the Apache configuration to have a value of `102400` (100K) or less. Please read the Apache documentation so that it is understood that this directive will limit the size of file up-loads to the web server.

```apache
LimitRequestBody 102400
```

## Default Value

```apache
LimitRequestBody 0 (unlimited)
```

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#limitrequestbody

## CIS Controls

**v8:**

- 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure
  - Establish and maintain a secure configuration process for network devices. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**v7:**

- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

- Level 2
