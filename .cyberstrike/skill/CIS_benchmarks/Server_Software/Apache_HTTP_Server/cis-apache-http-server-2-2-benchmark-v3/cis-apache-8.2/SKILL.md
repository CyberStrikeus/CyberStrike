---
name: cis-apache-8.2
description: "Ensure ServerSignature Is Not Enabled"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, information-leakage, server-signature, error-pages]
cis_id: "8.2"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure ServerSignature Is Not Enabled

## Description

Disable the server signatures, which is the generation of a signature line as a trailing footer at the bottom of server-generated documents such as error pages.

## Rationale

Server signatures are helpful when the server is acting as a proxy because they help the user distinguish errors from the proxy rather than the destination server. However, in this context there is no need for the additional information.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Verify the ServerSignature directive is either NOT present in the Apache configuration or is present and has a value of Off.

## Remediation

Perform the following to implement the recommended state:

Add or modify the ServerSignature directive as shown below to have the value of Off:

```
ServerSignature Off
```

## Default Value

```
Off
```

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#serversignature

## CIS Controls

Version 6

18 Application Software Security
Application Software Security

Version 7

13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile

Level 1 | Scored
Level 2 | Scored
