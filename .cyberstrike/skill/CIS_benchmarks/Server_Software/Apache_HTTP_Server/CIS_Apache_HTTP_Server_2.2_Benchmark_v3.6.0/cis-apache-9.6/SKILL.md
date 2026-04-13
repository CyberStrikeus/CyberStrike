---
name: cis-apache-9.6
description: "Ensure Timeout Limits for the Request Body Are Set Properly"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, denial-of-service, timeout]
cis_id: "9.6"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Timeout Limits for the Request Body Are Set Properly

## Description

The `RequestReadTimeout` directive allows setting timeout values for the body portion of a request. The directive provides for an initial timeout value, a maximum timeout, and a minimum rate. The minimum rate specifies that after the initial timeout, the server will wait an additional second for each N bytes received. The recommended setting is to have a maximum timeout of `20` seconds or less.

## Rationale

It is not sufficient to timeout only on the header portion of the request, as the server will still be vulnerable to attacks like the OWASP Slow POST attack, which provide the body of the request very slowly. Therefore, the body portion of the request must have a timeout as well. A timeout of `20` seconds or less is recommended.

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Locate any `RequestReadTimeout` directives and verify the configuration has a maximum body request timeout of `20` seconds or less.
3. If the configuration does not contain any `RequestReadTimeout` directives and the `mod_reqtimeout` module is being loaded, then the default value of `20` seconds is compliant with the benchmark recommendation.

```
RequestReadTimeout header=XXXXXX body=20,MinRate=XXXXXXXXXX
```

## Remediation

Perform the following to implement the recommended state:

1. Load the `mod_reqtimeout` module in the Apache configuration with the following.

```
LoadModule reqtimeout_module modules/mod_reqtimeout.so
```

2. Add a `RequestReadTimeout` directive similar to the one below with the maximum request body timeout value of `20` seconds or less.

```
RequestReadTimeout header=20-40,MinRate=500 body=20,MinRate=500
```

## Default Value

```
body=20,MinRate=500
```

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_reqtimeout.html

## CIS Controls

**Version 6**

9 Limitation and Control of Network Ports, Protocols, and Services
  Limitation and Control of Network Ports, Protocols, and Services

**Version 7**

5.1 Establish Secure Configurations
    Maintain documented, standard security configuration standards for all authorized
    operating systems and software.

## Profile

Level 1 | Scored
