---
name: cis-apache24-5.15
description: "Ensure the IP Addresses for Listening for Requests Are Specified"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.15"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the IP Addresses for Listening for Requests Are Specified (Automated)

## Profile Applicability

Level 2

## Description

The Apache `Listen` directive specifies the IP addresses and port numbers the Apache web server will listen for requests. Rather than be unrestricted to listen on all IP addresses available to the system, the specific IP address or addresses intended should be explicitly specified. Specifically, a `Listen` directive with no IP address specified, or with an IP address of zeros should not be used.

## Rationale

Having multiple interfaces on web servers is fairly common, and without explicit `Listen` directives, the web server is likely to be listening on an inappropriate IP address / interface that was not intended for the web server. Single homed system with a single IP addressed are also required to have an explicit IP address in the `Listen` directive, in case additional interfaces are added to the system at a later date.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Verify that no `Listen` directives are in the Apache configuration file with no IP address specified, or with an IP address of all zeros.

## Remediation

Perform the following to implement the recommended state:

1. Find any `Listen` directives in the Apache configuration file with no IP address specified, or with an IP addresses of all zeros similar to the examples below. Keep in mind there may be both IPv4 and IPv6 addresses on the system.
   ```
   Listen 80
   Listen 0.0.0.0:80
   Listen [::ffff:0.0.0.0]:80
   ```

2. Modify the `Listen` directives in the Apache configuration file to have explicit IP addresses according to the intended usage. Multiple `Listen` directives may be specified for each IP address & Port.
   ```
   Listen 10.1.2.3:80
   Listen 192.168.4.5:80
   Listen [2001:db8::a00:20ff:fea7:ccea]:80
   ```

## Default Value

`Listen 80`

## References

1. https://httpd.apache.org/docs/2.4/mod/mpm_common.html#listen

## CIS Controls

**v8:**
- 2.7 Allowlist Authorized Scripts
  - Use technical controls, such as digital signatures and version control, to ensure that only authorized scripts, such as specific .ps1, .py, etc., files, are allowed to execute. Block unauthorized scripts from executing. Reassess bi-annually, or more frequently.

**v7:**
- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running
  - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.
