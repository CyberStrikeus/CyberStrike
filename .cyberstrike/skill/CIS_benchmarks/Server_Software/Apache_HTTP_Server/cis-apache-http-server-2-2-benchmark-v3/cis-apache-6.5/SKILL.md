---
name: cis-apache-6.5
description: "Ensure Applicable Patches Are Applied"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, patching, maintenance, vulnerability-management]
cis_id: "6.5"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Applicable Patches Are Applied

## Description

Apply Apache patches within one month of availability.

## Rationale

Obviously knowing about newly discovered vulnerabilities is only part of the solution; there needs to be a process in place where patches are tested and installed. These patches fix diverse problems, including security issues. It is recommended to use the Apache packages and updates provided by your Linux platform vendor rather than building from source whenever possible in order to minimize the disruption and the work of keeping the software up-to-date.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. When Apache was built from source:
   a. Check the Apache web site for latest versions, date of releases, and any security patches. http://httpd.apache.org/security/vulnerabilities_22.html Apache patches are available http://www.apache.org/dist/httpd/patches
   b. If newer versions with security patches more than one month old are not installed, the installation is not sufficiently up-to-date.

2. When using platform packages:
   a. Check for vendor supplied updates on the vendor web site.
   b. If newer versions with security patches more than one month old are not installed, the installation is not sufficiently up-to-date.

## Remediation

Update to the latest Apache release available according to either of the following:

1. When building from source:
   a. Read release notes and related security patch information.
   b. Download latest source and any dependent modules such as mod_security.
   c. Build new Apache software according to your build process with the same configuration options.
   d. Install and test the new software according to your organization's testing process.
   e. Move to production according to your organization's deployment process.

2. When using platform packages:
   a. Read release notes and related security patch information.
   b. Download and install latest available Apache package and any dependent software.
   c. Test the new software according to your organization's testing process.
   d. Move to production according to your organization's deployment process.

## Default Value

Not applicable

## References

1. https://httpd.apache.org/security/vulnerabilities_22.html

## CIS Controls

Version 6

4 Continuous Vulnerability Assessment and Remediation
Continuous Vulnerability Assessment and Remediation

Version 7

18.4 Only Use Up-to-date And Trusted Third-Party Components
Only use up-to-date and trusted third-party components for the software
developed by the organization.

## Profile

Level 1 | Scored
Level 2 | Scored
