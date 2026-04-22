---
name: cis-apache24-8.2
description: "Ensure ServerSignature Is Not Enabled (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, information-leakage, server-signature, fingerprinting]
cis_id: "8.2"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure ServerSignature Is Not Enabled (Automated)

## Profile Applicability

- Level 1

## Description

Disable the server signatures which generates a signature line as a trailing footer at the bottom of server generated documents such as error pages.

## Rationale

Server signatures are helpful when the server is acting as a proxy, since it helps the user distinguish errors from the proxy rather than the destination server, however in this context there is no need for the additional information.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Verify the `ServerSignature` directive is either NOT present in the Apache configuration or has a value of `Off`.

## Remediation

Perform the following to implement the recommended state: Add or modify the `ServerSignature` directive as shown below to have the value of `Off`:

```apache
ServerSignature Off
```

## Default Value

The default value is `Off` for `ServerSignature`.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#serversignature

## CIS Controls

**v8:**

- 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
  - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

**v7:**

- 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
  - Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile

- Level 1
