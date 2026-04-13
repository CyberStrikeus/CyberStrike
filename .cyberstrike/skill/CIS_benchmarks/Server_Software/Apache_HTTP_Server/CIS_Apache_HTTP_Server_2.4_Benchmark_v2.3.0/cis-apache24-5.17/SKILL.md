---
name: cis-apache24-5.17
description: "Ensure HTTP Header Referrer-Policy is set appropriately"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content, options]
cis_id: "5.17"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure HTTP Header Referrer-Policy is set appropriately (Manual)

## Profile Applicability

Level 2

## Description

The server now allows for controlling the amount of "referrer" information being sent with requests. Limiting information to only what is needed is security best practice.

## Rationale

HTTP/S traffic is vulnerabe to attack - limiting what is sent in a request to only what is needed will limit the threat vector.

## Impact

You must only limit the header information to what is needed to support the request. Limiting it to much may disrupt the ability to get a proper/expected response.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

- Ensure a Header directive for Referrer-Policy is present in the Apache configuration and has the condition Header Set 'Referrer-Policy' shown below:
  ```
  # grep -I Referrer-Policy $APACHE_PREFIX/conf/httpd.conf
  ```
  ```
  Header set Referrer-Policy "<Directive>"
  ```

If header Referrer-Policy configuration is present and has as a compliant value, then the server is compliant.

## Remediation

Perform the following to implement the recommended state:

Add or modify the Header directive for the Referrer-Policy header in the Apache configuration to have the appropriate condition as shown below.

```
Header set Referrer-Policy "<Directive>"
```

## Default Value

Referrer-Policy Policy is not set by Default

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_headers.html#header
2. https://owasp.org/www-project-cheat-sheets/cheatsheets/Content_Security_Policy_Cheat_Sheet
3. https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
4. https://en.wikipedia.org/wiki/Clickjacking

## CIS Controls

**v8:**
- 9.4 Restrict Unnecessary or Unauthorized Browser and Email Client Extensions
  - Restrict, either through uninstalling or disabling, any unauthorized or unnecessary browser or email client plugins, extensions, and add-on applications.

- 13.10 Perform Application Layer Filtering
  - Perform application layer filtering. Example implementations include a filtering proxy, application layer firewall, or gateway.

**v7:**
- 9.4 Apply Host-based Firewalls or Port Filtering
  - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.

- 18.2 Ensure Explicit Error Checking is Performed for All In-house Developed Software
  - For in-house developed software, ensure that explicit error checking is performed and documented for all input, including for size, data type, and acceptable ranges or formats.
