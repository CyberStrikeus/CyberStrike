---
name: cis-apache-9.3
description: "Ensure MaxKeepAliveRequests Is Set Properly"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, denial-of-service, keepalive]
cis_id: "9.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure MaxKeepAliveRequests Is Set Properly

## Description

The `MaxKeepAliveRequests` directive limits the number of requests allowed per connection when `KeepAlive` is on. If it is set to `0`, unlimited requests will be allowed. It is recommended that the `MaxKeepAliveRequests` directive be set to `100` or greater.

## Rationale

Limiting the number of requests per connection may improve a server's resiliency to DoS attacks.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Verify that the `MaxKeepAliveRequests` directive in the Apache configuration either has a value of `100` or more or is not present. If the directive is not present, the default value is `100`.

## Remediation

Perform the following to implement the recommended state:

Add or modify the `MaxKeepAliveRequests` directive in the Apache configuration to have a value of `100` or more.

```
MaxKeepAliveRequests 100
```

## Default Value

```
MaxKeepAliveRequests 100
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#maxkeepaliverequests

## CIS Controls

**Version 6**

9 Limitation and Control of Network Ports, Protocols, and Services
  Limitation and Control of Network Ports, Protocols, and Services

**Version 7**

5.1 Establish Secure Configurations
    Maintain documented, standard security configuration standards for all authorized
    operating systems and software.

## Profile

Level 1 | Scored
