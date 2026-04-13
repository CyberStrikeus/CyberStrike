---
name: cis-apache24-5.8
description: "Ensure the HTTP TRACE Method Is Disabled"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.8"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.8 Ensure the HTTP TRACE Method Is Disabled

## Profile Applicability
- Level 1

## Description

Use the Apache `TraceEnable` directive to disable the HTTP `TRACE` request method.

## Rationale

The HTTP 1.1 protocol requires support for the `TRACE` request method which reflects the request back as a response and was intended for diagnostics purposes. The `TRACE` method is not needed and is easily subjected to abuse and should be disabled.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Verify there is a single `TraceEnable` directive configured with a value of `off`.

## Remediation

Perform the following to implement the recommended state:

1. Locate the main Apache configuration file such as `httpd.conf`.
2. Add a `TraceEnable` directive to the server level configuration with a value of `off`. Server level configuration is the top-level configuration, not nested within any other directives like `<Directory>` or `<Location>`.

## Default Value

The `TRACE` method is enabled.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#traceenable
2. https://www.ietf.org/rfc/rfc2616.txt

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 9.4 Restrict Unnecessary or Unauthorized Browser and Email Client Extensions<br>Restrict, either through uninstalling or disabling, any unauthorized or unnecessary browser or email client plugins, extensions, and add-on applications. | | ● | ● |
| v7 | 4.7 Limit Access to Script Tools<br>Limit access to scripting tools (such as Microsoft PowerShell and Python) to only administrative or development users with the need to access those capabilities. | | ● | ● |
| v7 | 7.2 Disable Unnecessary or Unauthorized Browser or Email Client Plugins<br>Uninstall or disable any unauthorized browser or email client plugins or add-on applications. | | ● | ● |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system. | | ● | ● |

## Profile
- Level 1 | Automated
