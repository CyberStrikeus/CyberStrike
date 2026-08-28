---
name: cis-apache-5.9
description: "Ensure Old HTTP Protocol Versions Are Disallowed"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options, http-methods]
cis_id: "5.9"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Old HTTP Protocol Versions Are Disallowed

## Description

The Apache modules `mod_rewrite` and `mod_security` can be used to disallow old and invalid HTTP versions. The HTTP 1.1 RFC is dated June 1999 and has been supported by Apache since version 1.2, so it should no longer be necessary to allow ancient versions of HTTP prior to 1.1. Refer to the Apache documentation on `mod_rewrite` for more details: http://httpd.apache.org/docs/2.2/mod/mod_rewrite.html

## Rationale

Many malicious automated programs, vulnerability scanners, and fingerprinting tools send requests using old HTTP versions to see how the web server responds. These requests are usually part of the attacker's enumeration process.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Verify there is a rewrite condition within the global server context that disallows requests that do not include the HTTP/1.1 header, as shown below.

```apache
RewriteEngine On
RewriteCond %{THE_REQUEST} !HTTP/1\.1$
RewriteRule .* - [F]
```

3. Verify the following directives are included in each section so that the main server settings will be inherited:

```apache
RewriteEngine On
RewriteOptions Inherit
```

## Remediation

Perform the following to implement the recommended state:

1. Load the `mod_rewrite` module for Apache by doing either one of the following:
   - Add a `LoadModule` directive in the main Apache configuration file
   - Build Apache with mod_rewrite compiled in statically
   - Use a package manager to install mod_rewrite as a shared module

2. Add the following rewrite directives to the global server context to reject HTTP requests that do not conform to HTTP/1.1:

```apache
RewriteEngine On
RewriteCond %{THE_REQUEST} !HTTP/1\.1$
RewriteRule .* - [F]
```

3. For each virtual host or other section that needs to inherit these settings, add:

```apache
RewriteEngine On
RewriteOptions Inherit
```

## Default Value

None documented

## References

1. http://httpd.apache.org/docs/2.2/mod/mod_rewrite.html

## CIS Controls

Version 6

9.1 Limit Open Ports, Protocols, and Services
Ensure that only ports, protocols, and services with validated business needs are running on each system.

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile

Level 1 | Scored
