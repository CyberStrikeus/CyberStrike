---
name: cis-apache-5.13
description: "Ensure the IP Addresses for Listening for Requests Are Specified"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, options]
cis_id: "5.13"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the IP Addresses for Listening for Requests Are Specified

## Description

The Apache `Listen` directive specifies the IP addresses and port numbers the Apache web server will listen on for requests. Rather than be unrestricted to listen on all IP addresses available to the system, the specific IP address or addresses intended should be explicitly specified. Specifically, a `Listen` directive with no IP address specified or with an IP address of all zeroes should not be used.

## Rationale

Having multiple interfaces on web servers is fairly common, and without explicit `Listen` directives, the web server is likely to be listening on an IP address or interface that was not intended for the web server. Single-homed systems with a single IP address are also required to have an explicit IP address in the `Listen` directive, in case additional interfaces are added to the system at a later date.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Verify that no `Listen` directives are in the Apache configuration file with no IP address specified or with an IP address of all zeroes.

## Remediation

Perform the following to implement the recommended state:

1. Find any `Listen` directives in the Apache configuration file with no IP address specified or with an IP address of all zeroes similar to the examples below. Keep in mind there may be both IPv4 and IPv6 addresses on the system.

```
Listen 80
Listen 0.0.0.0:80
Listen [::ffff:0.0.0.0]:80
```

2. Modify the `Listen` directives in the Apache configuration file to have explicit IP addresses according to the intended usage. Multiple `Listen` directives may be specified for each IP address and port.

```
Listen 10.1.2.3:80
Listen 192.168.4.5:80
Listen [2001:db8::a00:20ff:fea7:ccea]:80
```

## Default Value

`Listen 80`

## References

1. https://httpd.apache.org/docs/2.2/mod/mpm_common.html#listen

## CIS Controls

**Version 6**

9.1 Limit Open Ports, Protocols, and Services
Ensure that only ports, protocols, and services with validated business needs are running on each system.

**Version 7**

9.2 Ensure Only Approved Ports, Protocols and Services Are Running
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile

Level 2 | Scored
