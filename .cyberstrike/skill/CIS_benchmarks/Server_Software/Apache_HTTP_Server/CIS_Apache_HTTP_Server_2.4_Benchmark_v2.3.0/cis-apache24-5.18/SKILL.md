---
name: cis-apache24-5.18
description: "Ensure HTTP Header Permissions-Policy is set appropriately"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.18"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure HTTP Header Permissions-Policy is set appropriately (Manual)

## Profile Applicability

Level 2

## Description

The HTTP Permissions-Policy is a control that provides a way to allow or deny the use of certain browser features within a document or within any element in the document.

## Rationale

Having and using the ability to control browser features as needed with the directive follows the zero trust model and comply directly with CIS Controls section 2 of versions 7 and 8.

## Impact

You must only limit the origins and directives to what is needed to support the request. Limiting it too much may disrupt the ability to get a proper/expected response.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

- Query a Header directive for Permissions-Policy is present in the Apache configuration and has the condition Header Set 'Permissions-Policy' shown below:
  ```
  # grep -I Permissions-Policy $APACHE_PREFIX/conf/httpd.conf
  ```
  ```
  Header set Permissions-Policy "<Directive> <allowlist>"
  ```

Header Permissions-Policy configurations should be set to match required browser features, functions and origins.

## Remediation

Perform the following to implement the recommended state:

Add or modify the Header directive for the Permissions-Policy header in the Apache configuration to have the appropriate condition as shown below.

```
Header set Permissions-Policy "<Directive> <allowlist>"
```

## Default Value

Permissions-Policy Policy is not set by Default

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_headers.html#header
2. https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy

## CIS Controls

**v8:**

- 2.7 Allowlist Authorized Scripts
  - Use technical controls, such as digital signatures and version control, to ensure that only authorized scripts, such as specific .ps1, .py, etc., files, are allowed to execute. Block unauthorized scripts from executing. Reassess bi-annually, or more frequently.

- 13.10 Perform Application Layer Filtering
  - Perform application layer filtering. Example implementations include a filtering proxy, application layer firewall, or gateway.

**v7:**

- 2.7 Utilize Application Whitelisting
  - Utilize application whitelisting technology on all assets to ensure that only authorized software executes and all unauthorized software is blocked from executing on assets.

- 9.4 Apply Host-based Firewalls or Port Filtering
  - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
