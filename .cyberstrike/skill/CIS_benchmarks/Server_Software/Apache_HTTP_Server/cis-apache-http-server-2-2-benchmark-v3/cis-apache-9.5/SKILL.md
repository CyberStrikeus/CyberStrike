---
name: cis-apache-9.5
description: "Ensure the Timeout Limits for Request Headers is Set to 40 or Less"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, dos, denial-of-service, timeout]
cis_id: "9.5"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Timeout Limits for Request Headers is Set to 40 or Less

## Description

The `RequestReadTimeout` directive allows configuration of timeout limits for client requests. The header portion of the directive provides for an initial timeout value, a maximum timeout, and a minimum rate specifies that after the initial timeout, the server will wait an additional second for each N bytes received. The recommended setting is to have a maximum timeout of `40` seconds or less. Keep in mind that for SSL/TLS virtual hosts, the time for the TLS handshake must fit within the timeout.

## Rationale

Setting a request header timeout is vital for mitigating DoS attacks based on slow requests. The slow request attacks are particularly lethal and relative easy to perform, because they require very little bandwidth and can easily be done through anonymous proxies. These attacks started in June 2009 with the Slow Loris DoS attack, which used a slow GET request, as published by Robert Hansen (RSnake) on his blog http://ha.ckers.org/slowloris/. Later in November 2010 at the OWASP App Sec DC conference, Wong Onn Chee demonstrated a slow POST request attack which was even more effective. For details, see: https://www.owasp.org/index.php/H....t....p....p....o....s....t

## Impact

None documented

## Audit Procedure

Perform the following to determine if the recommended state is implemented:

1. Locate the Apache configuration files and included configuration files.
2. Locate any `RequestReadTimeout` directives and verify that they have a maximum header request timeout of `40` seconds or less.
3. If the configuration does not contain any `RequestReadTimeout` directives and the `mod_reqtimeout` module is being loaded, then the default value of `40` seconds is compliant with the benchmark recommendation.

```
RequestReadTimeout header=XXX-40,MinRate=XXX  body=XXXXXXXXXX
```

## Remediation

Perform the following to implement the recommended state:

1. Load the `mod_reqtimeout` module in the Apache configuration with the following.

```
LoadModule reqtimeout_module modules/mod_reqtimeout.so
```

2. Add a `RequestReadTimeout` directive similar to the one below with the maximum request header timeout value of `40` seconds or less.

```
RequestReadTimeout header=20-40,MinRate=500 body=20,MinRate=500
```

## Default Value

```
header=20-40,MinRate=500
```

## References

1. http://ha.ckers.org/slowloris/
2. https://www.owasp.org/index.php/H....t....p....p....o....s....t
3. https://httpd.apache.org/docs/2.2/mod/mod_reqtimeout.html

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
