---
name: cis-apache-9.1
description: "Ensure the TimeOut Is Set Properly"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, denial-of-service, timeout]
cis_id: "9.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the TimeOut Is Set Properly

## Description

The `TimeOut` directive controls the maximum time in seconds that Apache HTTP server will wait for an Input/Output call to complete. It is recommended that the `TimeOut` directive be set to `10` or less.

## Rationale

One common technique for DoS is to initiate many connections to the server. By decreasing the timeout for old connections, the server can free resources more quickly and be more responsive. By making the server more efficient, it will be more resilient to DoS conditions.

**Important Notice**: There is a slow form of DoS attack not adequately mitigated by these controls, such as the Slow Loris DoS attack of June 2009 http://ha.ckers.org/slowloris/. Upgrading to Apache 2.4 is recommended.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Verify that the `Timeout` directive is specified in the Apache configuration files to have a value of `10` seconds or less.

## Remediation

Perform the following to implement the recommended state:

Add or modify the `Timeout` directive in the Apache configuration files to have a value of `10` seconds or less.

```
Timeout 10
```

## Default Value

```
Timeout 300
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#timeout

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
