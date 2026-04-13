---
name: cis-apache24-6.5
description: "Ensure Applicable Patches Are Applied"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring, maintenance]
cis_id: "6.5"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Applicable Patches Are Applied (Manual)

## Profile Applicability

Level 1

## Description

Apply available Apache patches within 1 month of availability.

## Rationale

Obviously knowing about newly discovered vulnerabilities is only part of the solution; there needs to be a process in place where patches are tested and installed. These patches fix diverse problems, including security issues. It is recommended to use the Apache packages and updates provided by the Linux platform vendor rather than building from source when possible, in order to minimize the disruption and the work of keeping the software up-to-date.

## Audit Procedure

1. When Apache was built from source:
   - Check the Apache web site for latest versions, date of releases and any security patches
   - If newer versions with security patches more than 1 month old and are not installed, then the installation is not sufficiently up-to-date.

2. When using platform packages
   - Check for vendor supplied updates from the vendor web site.
   - If newer versions with security patches more than 1 month old are not installed, then the installation is not sufficiently up-to-date.

## Remediation

Update to the latest Apache release available according to either of the following:

1. When building from source:
   - Read release notes and related security patch information
   - Download latest source and any dependent modules such as mod_security
   - Build new Apache software according to your build process with the same configuration options
   - Install and test the new software according to your organization's testing process
   - Move to production according to your organization's deployment process

2. When using platform packages:
   - Read release notes and related security patch information
   - Download and install latest available Apache package and any dependent software
   - Test the new software according to your organization's testing process
   - Move to production according to your organization's deployment process

## Default Value

Not Applicable

## References

1. https://httpd.apache.org/security/vulnerabilities_24.html

## CIS Controls

**v8:**
- 7.4 Perform Automated Application Patch Management

**v7:**
- 3.4 Deploy Automated Operating System Patch Management Tools
- 18.4 Only Use Up-to-date And Trusted Third-Party Components
