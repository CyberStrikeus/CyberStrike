---
name: cis-ubuntu1604-v200-2-1-2
description: "Ensure X Window System is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.2 Ensure X Window System is not installed (Automated)

## Description

The X Window System provides a Graphical User Interface (GUI) where users can have multiple windows in which to run programs and various add on. The X Windows system is typically used on workstations where users login, but not on servers where users typically do not login.

## Rationale

Unless your organization specifically requires graphical login access via X Windows, remove it to reduce the potential attack surface.

## Impact

Many Linux systems run applications which require a Java runtime. Some Linux Java packages have a dependency on specific X Windows xorg-x11-fonts. One workaround to avoid this dependency is to use the "headless" Java packages for your specific Java runtime, if provided by your distribution.

## Audit Procedure

### Command Line

Verify X Windows System is not installed:

```bash
dpkg -l xserver-xorg*
```

## Expected Result

No xserver-xorg packages should be installed.

## Remediation

### Command Line

Remove the X Windows System packages:

```bash
apt purge xserver-xorg*
```

## Default Value

X Window System is not installed on minimal server installations.

## References

1. CIS Controls v7 - 2.6 Address unapproved software

## Profile

- Level 1 - Server
