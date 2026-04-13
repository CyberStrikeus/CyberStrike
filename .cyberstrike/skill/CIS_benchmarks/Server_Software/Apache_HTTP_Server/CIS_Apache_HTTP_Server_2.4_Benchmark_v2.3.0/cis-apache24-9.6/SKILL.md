---
name: cis-apache24-9.6
description: "Ensure Timeout Limits for the Request Body is Set to 20 or Less (Manual)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, timeout, slow-post, request-body]
cis_id: "9.6"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Timeout Limits for the Request Body is Set to 20 or Less (Manual)

## Profile Applicability
- Level 1

## Description

The `RequestReadTimeout` directive also allows setting timeout values for the body portion of a request. The directive provides for an initial timeout value, and a maximum timeout and minimum rate. The minimum rate specifies that after the initial timeout, the server will wait an additional 1 second for each N bytes received. The recommended setting is to have a maximum timeout of `20` seconds or less. The default value is `body=20,MinRate=500`.

## Rationale

It is not sufficient to timeout only on the header portion of the request, as the server will still be vulnerable to attacks like the OWASP Slow `POST` attack, which provide the body of the request very slowly. Therefore, the body portion of the request must have a timeout as well. A timeout of `20` seconds or less is recommended.

## Audit

Perform the following to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Locate any `RequestReadTimeout` directives and verify the configuration has a maximum body request timeout of `20` seconds or less.
3. If the configuration does not contain any `RequestReadTimeout` directives, and the `mod_reqtimeout` module is being loaded, then the default value of `20` seconds is compliant with the benchmark recommendation.
   - `RequestReadTimeout header=XXXXXX body=20,MinRate=XXXXXXXXXX`

## Remediation

Load the `mod_requesttimeout` module in the Apache configuration with the following configuration.

```apache
LoadModule reqtimeout_module modules/mod_reqtimeout.so
```

Add a `RequestReadTimeout` directive similar to the one below with the maximum request body timeout value of `20` seconds or less.

```apache
RequestReadTimeout header=20-40,MinRate=500 body=20,MinRate=500
```

## Default Value

```apache
body=20,MinRate=500
```

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_reqtimeout.html

## CIS Controls

**v8:**
- 4.2 Establish and Maintain a Secure Configuration Process for Network Infrastructure
  - Establish and maintain a secure configuration process for network devices. Review and update documentation annually, or when significant enterprise changes occur that could impact this Safeguard.

**v7:**
- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile
- Level 1
