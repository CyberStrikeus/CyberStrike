---
name: "CIS Ubuntu 14.04 LTS - 2.2.2 Ensure X Window System is not installed"
description: "Verify that X Window System packages are not installed on servers"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - services
cis_id: "2.2.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.2 Ensure X Window System is not installed (Scored)

## Profile Applicability

- Level 1 - Server

## Description

The X Window System provides a Graphical User Interface (GUI) where users can have multiple windows in which to run programs and various add on. The X Windows system is typically used on workstations where users login, but not on servers where users typically do not login.

## Rationale

Unless your organization specifically requires graphical login access via X Windows, remove it to reduce the potential attack surface.

## Audit Procedure

Run the following command and verify X Windows System is not installed:

```bash
dpkg -l xserver-xorg*
```

## Expected Result

No xserver-xorg packages should be installed.

## Remediation

Run the following command to remove the X Windows System packages:

```bash
apt-get remove xserver-xorg*
```

## Default Value

X Window System may be installed on workstation installations.

## References

- CIS Controls: 2 Inventory of Authorized and Unauthorized Software

## Profile

- Level 1 - Server
