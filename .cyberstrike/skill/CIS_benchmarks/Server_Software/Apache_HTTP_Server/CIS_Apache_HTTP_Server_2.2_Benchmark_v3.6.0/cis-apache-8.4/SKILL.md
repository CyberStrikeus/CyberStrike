---
name: cis-apache-8.4
description: "Ensure ETag Response Header Fields Do Not Include Inodes"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, information-leakage, etag, inode, fingerprinting]
cis_id: "8.4"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure ETag Response Header Fields Do Not Include Inodes

## Description

The FileETag directive configures the file attributes that are used to create the ETag (entity tag) response header field when the document is based on a static file. The ETag value is used in cache management to save network bandwidth. The value returned may be based on combinations of the file inode, the modification time, and the file size.

## Rationale

When the FileETag is configured to include the file inode number, a remote attacker may be able to discern the inode number from returned values. The inode is considered sensitive information, as it could be useful in assisting in other attacks.

## Audit

Perform the following step to determine if the recommended state is implemented:

1. For the server configurations, verify that the FileETag directive is present, and the configured value does not contain any of the values all, inode, or +inode.
2. For all virtual host and directory configurations, verify that either
   ○ The FileETag directive is not present, or
   ○ The configured FileETag value does not contain any of the values all, inode, or +inode.

## Remediation

Perform the following to implement the recommended state:

Add or modify the FileETag directive in the server and each virtual host configuration to have the value None or MTime Size.

## Default Value

```
INode MTime Size
```

## References

1. http://httpd.apache.org/docs/2.2/mod/core.html#FileETag
2. https://nvd.nist.gov/vuln/detail/CVE-2003-1418

## CIS Controls

Version 6

18.9 Sanitize Deployed Software Of Development Artifacts
For in-house developed applications, ensure that development artifacts (sample data and scripts; unused libraries, components, debug code; or tools) are not included in the deployed software, or accessible in the production environment.

Version 7

13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization
Remove sensitive data or systems not regularly accessed by the organization from the network. These systems shall only be used as stand alone systems (disconnected from the network) by the business unit needing to occasionally use the system or completely virtualized and powered off until needed.

## Profile

Level 2 | Scored
