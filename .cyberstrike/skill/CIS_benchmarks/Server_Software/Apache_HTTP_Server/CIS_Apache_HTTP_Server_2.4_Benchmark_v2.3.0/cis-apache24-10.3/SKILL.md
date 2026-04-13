---
name: cis-apache24-10.3
description: "Ensure the LimitRequestFieldsize Directive is Set to 8190 or Less (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, request-limits, buffer-overflow, limit-request-fieldsize]
cis_id: "10.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the LimitRequestFieldsize Directive is Set to 8190 or Less (Automated)

## Profile Applicability
- Level 2

## Description

The `LimitRequestFieldSize` limits the number of bytes that will be allowed in an HTTP request header. It is recommended that the `LimitRequestFieldSize` directive be set to the default value of `8190` or less.

## Rationale

By limiting of the size of request headers is helpful so that the web server can prevent an unexpectedly long or large value from being passed to a potentially vulnerable program. Of course, the underlying dependency is that we need to set the limits high enough to not interfere with any one application on the server, while setting them low enough to be of value in protecting the applications. Since the configuration directives are available only at the server configuration level, it is not possible to tune the value for different portions of the same web server. Please read the Apache documentation carefully, as these requests may interfere with the expected functionality of some web applications.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Verify that the `LimitRequestFieldsize` directive is in the Apache configuration and has a value of `8190` or less.

## Remediation

Perform the following to implement the recommended state:

Add or modify the `LimitRequestFieldsize` directive in the Apache configuration to have a value of `8190` or less.

```apache
LimitRequestFieldsize 8190
```

## Default Value

```apache
LimitRequestFieldsize=8190
```

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#limitrequestfieldsize

## CIS Controls

**v8:**
- 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure
  - Establish and maintain a secure configuration process for network devices. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**v7:**
- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile
- Level 2
