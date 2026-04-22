---
name: cis-apache24-9.1
description: "Ensure the TimeOut Is Set to 10 or Less (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, timeout, denial-of-service]
cis_id: "9.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the TimeOut Is Set to 10 or Less (Automated)

## Profile Applicability

- Level 1

## Description

Denial of Service (DoS) is an attack technique with the intent of preventing a web site from serving normal user activity. DoS attacks, which are normally applied to the network layer, are also possible at the application layer. These malicious attacks can succeed by starving a system of critical resources, vulnerability exploit, or abuse of functionality. Although there is no 100% solution for preventing DoS attacks, the following recommendation uses the `Timeout` directive to mitigate some of the risk, by requiring more effort for a successful DoS attack. Of course, DoS attacks can happen in rather unintentional ways as well as intentional and these directives will help in many of those situations as well.

## Rationale

One common technique for DoS is to initiate many connections to the server. By decreasing the timeout for old connections and we allow the server to free up resources more quickly and be more responsive. By making the server more efficient, it will be more resilient to DoS conditions. The `Timeout` directive affects several timeout values for Apache, so review the Apache document carefully. https://httpd.apache.org/docs/2.4/mod/core.html#timeout

## Audit

Perform the following steps to determine if the recommended state is implemented: Verify that the `Timeout` directive is specified in the Apache configuration files to have a value of `10` seconds or shorter.

## Remediation

Perform the following to implement the recommended state: Add or modify the Timeout directive in the Apache configuration to have a value of `10` seconds or shorter.

```apache
Timeout 10
```

## Default Value

```apache
Timeout 60
```

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#timeout

## CIS Controls

**v8:**

- 13.10 Perform Application Layer Filtering
  - Perform application layer filtering. Example implementations include a filtering proxy, application layer firewall, or gateway.

**v7:**

- 9 Limitation and Control of Network Ports, Protocols, and Services
  - Limitation and Control of Network Ports, Protocols, and Services

## Profile

- Level 1
