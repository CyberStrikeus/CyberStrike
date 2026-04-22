---
name: cis-apache24-5.14
description: "Ensure IP Address Based Requests Are Disallowed"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.14"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure IP Address Based Requests Are Disallowed (Automated)

## Profile Applicability

Level 2

## Description

The Apache module `mod_rewrite` can be used to disallow access for requests that use an IP address instead of a host name for the URL. Most normal access to the website from browsers and automated software will use a host name which will therefore include the host name in the HTTP HOST header.

## Rationale

A common malware propagation and automated network scanning technique is to use IP addresses rather than host names for web requests, since it's much simpler to automate. By denying IP based web requests, these automated techniques will be denied access to the website. Of course, malicious web scanning techniques continue to evolve, and many are now using hostnames, however denying access to the IP based requests is still a worthwhile defense.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Verify there is a rewrite condition within the global server context that disallows IP based requests by requiring a HTTP HOST header similar to the example shown below.

```
RewriteCond %{HTTP_HOST} !^www\.example\.com [NC]
RewriteCond %{REQUEST_URI} !^/error [NC]
RewriteRule ^.(.*) - [L,F]
```

## Remediation

Perform the following to implement the recommended state:

1. Load the `mod_rewrite` module for Apache by doing either one of the following:
   - Build Apache with `mod_rewrite` statically loaded during the build, by adding the `--enable-rewrite` to the `./configure` script.
   - `./configure --enable-rewrite`
   - Or, dynamically loading the module with the `LoadModule` directive in the `httpd.conf` configuration file.
   - `LoadModule rewrite_module modules/mod_rewrite.so`

2. Add the `RewriteEngine` directive to the configuration within the global server context with the value of `on` so that the rewrite engine is enabled.

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

1. https://httpd.apache.org/docs/2.4/mod/mod_rewrite.html

## CIS Controls

**v8:**

- 9.4 Restrict Unnecessary or Unauthorized Browser and Email Client Extensions
  - Restrict, either through uninstalling or disabling, any unauthorized or unnecessary browser or email client plugins, extensions, and add-on applications.

**v7:**

- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running
  - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

- 18.2 Ensure Explicit Error Checking is Performed for All In-house Developed Software
  - For in-house developed software, ensure that explicit error checking is performed and documented for all input, including for size, data type, and acceptable ranges or formats.
