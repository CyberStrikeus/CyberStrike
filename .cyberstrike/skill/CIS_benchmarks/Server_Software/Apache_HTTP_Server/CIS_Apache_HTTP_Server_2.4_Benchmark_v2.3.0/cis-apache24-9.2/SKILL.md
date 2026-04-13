---
name: cis-apache24-9.2
description: "Ensure KeepAlive Is Enabled (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, keepalive, tcp-reuse]
cis_id: "9.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure KeepAlive Is Enabled (Automated)

## Profile Applicability
- Level 1

## Description

The `KeepAlive` directive controls whether Apache will reuse the same TCP connection per client to process subsequent HTTP requests from that client. It is recommended that the `KeepAlive` directive be set to `On`.

## Rationale

Allowing per-client reuse of TCP sockets reduces the amount of system and network resources required to serve requests. This efficiency gain may improve a server's resiliency to DoS attacks.

## Audit

Perform the following steps to determine if the recommended state is implemented: Verify that the `KeepAlive` directive in the Apache configuration to have a value of `On`, or is not present. If the directive is not present the default value is `On`.

## Remediation

Perform the following to implement the recommended state: Add or modify the `KeepAlive` directive in the Apache configuration to have a value of `On`, so that `KeepAlive` connections are enabled.

```apache
KeepAlive On
```

## Default Value

```apache
KeepAlive On
```

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#keepalive

## CIS Controls

**v8:**
- 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure
  - Establish and maintain a secure configuration process for network devices. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**v7:**
- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile
- Level 1
