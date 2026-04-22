---
name: cis-ubuntu1804-v220-2-2-1
description: "Ensure X Window System is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, x-window]
cis_id: "2.2.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.1 Ensure X Window System is not installed (Automated)

## Profile

- Level 2 - Server

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
dpkg-query -s xserver-xorg &>/dev/null && echo "xserver-xorg is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Remove the X Windows System packages:

```bash
apt purge xserver-xorg*
```

## References

1. NIST SP 800-53 Rev. 5: CM-11

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 2.6 - Address unapproved software
