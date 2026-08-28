---
name: cis-ubuntu1204-v110-11-3
description: "Set Graphical Warning Banner"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, banner, graphical, display-manager, gdm]
cis_id: "11.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 11.3 Set Graphical Warning Banner (Not Scored)

## Profile Applicability

- Level 1

## Description

Ubuntu defaults to using lightdm for graphical login session management which provides no built in banner setting. The GNOME Display Manager and KDM are both available but must be manually installed.

## Rationale

Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place. Consult your organization's legal counsel for the appropriate wording for your specific organization.

## Audit Procedure

### Using Command Line

If the X Window system is in use ensure a warning banner consistent with your organizations policy is in place.

## Expected Result

A warning banner consistent with organizational policy is displayed prior to graphical login.

## Remediation

### Using Command Line

Set a banner for the display manager in use consistent with your organizations policy. This process depends on the specific Display Manager and theme in use, consult your documentation for more details.

## Default Value

No graphical warning banner is configured by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
