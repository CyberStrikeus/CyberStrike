---
name: cis-apache-5.12
description: "Ensure IP Address Based Requests Are Disallowed"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, protocol]
cis_id: "5.12"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure IP Address Based Requests Are Disallowed

## Description

The Apache module `mod_rewrite` should disallow access for requests that use an IP address instead of a host name for the URL. Most normal access to the website from browsers and automated software will use a hostname, and will therefore include the hostname in the HTTP HOST header.

Refer to the Apache 2.2 documentation for details:
http://httpd.apache.org/docs/2.2/mod/mod_rewrite.html

## Rationale

A common malware propagation and automated network scanning technique is to use IP addresses rather than hostnames for web requests, since it's simpler to automate. By denying IP-based web requests, these automated techniques will be denied access to the website. Malicious web scanning techniques continue to evolve, and many are now using hostnames, but denying access to IP-based requests is still a worthwhile defensive measure.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Verify there is a rewrite condition within the global server context that disallows IP-based requests by requiring a HTTP HOST header similar to the example shown below.

```
RewriteCond %{HTTP_HOST} !^www\.example\.com [NC]
RewriteCond %{REQUEST_URI} !^/error [NC]
RewriteRule ^.(.*) - [L,F]
```

## Remediation

Perform the following to implement the recommended state:

1. Load the `mod_rewrite` module for Apache by doing either one of the following:
   a. Build Apache with `mod_rewrite` statically loaded during the build by adding the `--enable-rewrite` option to the `./configure` script.

   ```
   /configure --enable-rewrite
   ```

   b. Or, dynamically load the module with the `LoadModule` directive in the `httpd.conf` configuration file.

   ```
   LoadModule rewrite_module modules/mod_rewrite.so
   ```

2. Add the `RewriteEngine` directive to the configuration within the global server context with the value of `on` so the rewrite engine is enabled.

```
RewriteEngine On
```

3. Locate the Apache configuration file such as `httpd.conf` and add the following rewrite condition to match the expected host name of the top server level configuration.

```
RewriteCond %{HTTP_HOST} !^www\.example\.com [NC]
RewriteCond %{REQUEST_URI} !^/error [NC]
RewriteRule ^.(.*) - [L,F]
```

## Default Value

`RewriteEngine off`

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_rewrite.html

## CIS Controls

**Version 6**

9.1 Limit Open Ports, Protocols, and Services
Ensure that only ports, protocols, and services with validated business needs are running on each system.

**Version 7**

9.2 Ensure Only Approved Ports, Protocols and Services Are Running
Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile

Level 2 | Scored
