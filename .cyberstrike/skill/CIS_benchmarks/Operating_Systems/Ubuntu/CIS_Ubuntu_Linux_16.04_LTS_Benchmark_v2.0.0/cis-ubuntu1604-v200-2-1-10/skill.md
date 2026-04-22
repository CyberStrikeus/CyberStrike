---
name: cis-ubuntu1604-v200-2-1-10
description: "Ensure HTTP server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.10"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.10 Ensure HTTP server is not installed (Automated)

## Description

HTTP or web servers provide the ability to host web site content.

## Rationale

Unless there is a need to run the system as a web server, it is recommended that the package be deleted to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify apache is not installed:

```bash
dpkg -s apache2 | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'apache2' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove apache:

```bash
apt purge apache2
```

## Default Value

apache2 is not installed on minimal server installations. Several httpd servers exist and can use other service names. apache2 and nginx are example services that provide an HTTP server. These and other services should also be audited.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
