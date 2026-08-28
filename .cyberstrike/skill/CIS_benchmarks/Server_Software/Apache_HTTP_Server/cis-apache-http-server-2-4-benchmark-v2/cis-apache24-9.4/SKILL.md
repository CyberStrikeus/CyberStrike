---
name: cis-apache24-9.4
description: "Ensure KeepAliveTimeout is Set to a Value of 15 or Less (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, keepalive, timeout]
cis_id: "9.4"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure KeepAliveTimeout is Set to a Value of 15 or Less (Automated)

## Profile Applicability

- Level 1

## Description

The `KeepAliveTimeout` directive specifies the number of seconds Apache will wait for a subsequent request before closing a connection that is being kept alive.

## Rationale

The `KeepAliveTimeout` directive is used mitigate some of the risk, by requiring more effort for a successful DoS attack. By enabling `KeepAlive` and keeping the timeout relatively low for old connections and we allow the server to free up resources more quickly and be more responsive.

## Audit

Perform the following steps to determine if the recommended state is implemented: Verify that the `KeepAliveTimeout` directive in the Apache configuration to have a value of `15` or less. If the directive is not present the default value is `5` seconds.

## Remediation

Perform the following to implement the recommended state: Add or modify the `KeepAliveTimeout` directive in the Apache configuration to have a value of `15` or less.

```apache
KeepAliveTimeout 15
```

## Default Value

```apache
KeepAliveTimeout 5
```

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#keepalivetimeout

## CIS Controls

**v8:**

- 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure
  - Establish and maintain a secure configuration process for network devices. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**v7:**

- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

- Level 1
