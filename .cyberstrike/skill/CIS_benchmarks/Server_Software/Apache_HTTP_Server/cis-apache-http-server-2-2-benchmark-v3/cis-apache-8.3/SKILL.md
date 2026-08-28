---
name: cis-apache-8.3
description: "Ensure All Default Apache Content Is Removed"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, information-leakage, default-content, icons, fingerprinting]
cis_id: "8.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure All Default Apache Content Is Removed

## Description

In previous recommendations, we have removed default content such as the Apache manuals and default CGI programs. However, if you want to further restrict information leakage about the web server, it is important that default content such as icons are not left on the web server.

## Rationale

To identify the type of web servers and versions software installed, it is common for attackers to scan for icons or special content specific to the server type and version. A simple request like http://example.com/icons/apache_pb2.png may tell the attacker that the server is Apache 2.2. Many icons are used primarily for auto indexing, which is recommended to be disabled.

## Audit

Perform the following step to determine if the recommended state is implemented:

Verify there is no alias or directory access to the apache icons directory in any of the Apache configuration files.

## Remediation

Perform either of the following to implement the recommended state:

1. The default source build places the auto-index and icon configurations in the extra/httpd-autoindex.conf file, so it can be disabled by leaving the include line commented out in the main httpd.conf file, as shown below.

```
# Fancy directory listings
#Include conf/extra/httpd-autoindex.conf
```

2. Alternatively, the icon alias directive and the directory access control configuration can be commented out as shown:

```
# We include the /icons/ alias for FancyIndexed directory listings. If
# you do not use FancyIndexing, you may comment this out.
#
```

## Default Value

The default source build does not enable access to the Apache icons.

## CIS Controls

Version 6

18.9 Sanitize Deployed Software Of Development Artifacts
For in-house developed applications, ensure that development artifacts (sample data and scripts; unused libraries, components, debug code; or tools) are not included in the deployed software, or accessible in the production environment.

Version 7

13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile

Level 2 | Scored
