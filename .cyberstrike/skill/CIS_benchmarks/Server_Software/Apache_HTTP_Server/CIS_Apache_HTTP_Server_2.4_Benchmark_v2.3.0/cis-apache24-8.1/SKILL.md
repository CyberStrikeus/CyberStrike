---
name: cis-apache24-8.1
description: "Ensure ServerTokens is Set to 'Prod' or 'ProductOnly' (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, information-leakage, server-tokens, fingerprinting]
cis_id: "8.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure ServerTokens is Set to 'Prod' or 'ProductOnly' (Automated)

## Profile Applicability
- Level 1

## Description

Configure the Apache `ServerTokens` directive to provide minimal information. By setting the value to `Prod` or `ProductOnly`, The only version information given in the server HTTP response header will be `Apache` rather than details on modules and versions installed.

## Rationale

Information is power and identifying web server details greatly increases the efficiency of any attack, as security vulnerabilities are extremely dependent upon specific software versions and configurations. Excessive probing and requests may cause too much "noise" being generated and may tip off an administrator. If an attacker can accurately target their exploits, the chances of successful compromise prior to detection increase dramatically. Script Kiddies are constantly scanning the Internet and documenting the version information openly provided by web servers. The purpose of this scanning is to accumulate a database of software installed on those hosts, which can then be used when new vulnerabilities are released.

## Audit

Perform the following steps to determine if the recommended state is implemented: Verify the `ServerTokens` directive is present in the Apache configuration and has a value of `Prod` or `ProductOnly`.

## Remediation

Perform the following to implement the recommended state: Add or modify the `ServerTokens` directive as shown below to have the value of `Prod` or `ProductOnly`:

```apache
ServerTokens Prod
```

## Default Value

The default value is `Full` which provides the most detailed information.

## References

1. https://httpd.apache.org/docs/2.4/mod/core.html#servertokens

## CIS Controls

**v8:**
- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.

**v7:**
- 14.7 Enforce Access Control to Data through Automated Tools
  - Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.

## Profile
- Level 1
