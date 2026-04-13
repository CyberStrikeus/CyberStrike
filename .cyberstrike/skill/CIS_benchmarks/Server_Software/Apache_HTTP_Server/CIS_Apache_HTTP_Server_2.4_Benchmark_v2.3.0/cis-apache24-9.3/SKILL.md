---
name: cis-apache24-9.3
description: "Ensure MaxKeepAliveRequests is Set to a Value of 100 or Greater (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, keepalive, max-requests]
cis_id: "9.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure MaxKeepAliveRequests is Set to a Value of 100 or Greater (Automated)

## Profile Applicability
- Level 1

## Description

The `MaxKeepAliveRequests` directive limits the number of requests allowed per connection when `KeepAlive` is on. If it is set to 0, unlimited requests will be allowed.

## Rationale

The `MaxKeepAliveRequests` directive is important to be used to mitigate the risk of Denial of Service (DoS) attack technique by reducing the overhead imposed on the server. The `KeepAlive` directive must be enabled before it is effective. Enabling `KeepAlives` allows for multiple HTTP requests to be sent while keeping the same TCP connection alive. This reduces the overhead of having to setup and tear down TCP connections for each request. By making the server more efficient, it will be more resilient to DoS conditions.

## Audit

Perform the following steps to determine if the recommended state is implemented: Verify that the `MaxKeepAliveRequests` directive in the Apache configuration to have a value of `100` or more. If the directive is not present the default value is `100`.

## Remediation

Perform the following to implement the recommended state: Add or modify the `MaxKeepAliveRequests` directive in the Apache configuration to have a value of `100` or more.

```apache
MaxKeepAliveRequests 100
```

## Default Value

```apache
MaxKeepAliveRequests 100
```

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#maxkeepaliverequests

## CIS Controls

**v8:**
- 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure
  - Establish and maintain a secure configuration process for network devices. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**v7:**
- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile
- Level 1
