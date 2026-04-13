---
name: cis-apache24-8.4
description: "Ensure ETag Response Header Fields Do Not Include Inodes (Automated)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, information-leakage, etag, inodes]
cis_id: "8.4"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure ETag Response Header Fields Do Not Include Inodes (Automated)

## Profile Applicability
- Level 2

## Description

The `FileETag` directive configures the file attributes that are used to create the `ETag` (entity tag) response header field when the document is based on a static file. The `ETag` value is used in cache management to save network bandwidth. The value returned may be based on combinations of the file `inode`, the modification time, and the file size.

## Rationale

When the `FileETag` is configured to include the file `inode` number, remote attackers may be able to discern the inode number from returned values. The `inode` is considered sensitive information, as it could be useful in assisting in other attacks.

## Audit

Perform the following step to determine if the recommended state is implemented:

For the server and all virtual host and directory configurations verify that either

1. The `FileETag` directive is not present, or
2. The configured `FileETag` value does not contain any of the values `all` or `inode` or `+inode`.

## Remediation

Perform the following to implement the recommended state:

Remove all instances of the `FileETag` directive. Alternatively, add or modify the `FileETag` directive in the server and each virtual host configuration to have either the value `None` or `MTime Size`.

## Default Value

The default value is `MTime Size`.

## References

1. http://httpd.apache.org/docs/2.4/mod/core.html#FileETag
2. https://nvd.nist.gov/vuln/detail/CVE-2003-1418

## CIS Controls

**v8:**
- 9.2 Use DNS Filtering Services
  - Use DNS filtering services on all enterprise assets to block access to known malicious domains.

**v7:**
- 7.4 Maintain and Enforce Network-Based URL Filters
  - Enforce network-based URL filters that limit a system's ability to connect to websites not approved by the organization. This filtering shall be enforced for each of the organization's systems, whether they are physically at an organization's facilities or not.
- 7.7 Use of DNS Filtering Services
  - Use DNS filtering services to help block access to known malicious domains.

## Profile
- Level 2
