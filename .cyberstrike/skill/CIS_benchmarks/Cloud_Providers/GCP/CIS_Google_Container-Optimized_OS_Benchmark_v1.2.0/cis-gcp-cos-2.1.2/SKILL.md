---
name: cis-gcp-cos-2.1.2
description: "Ensure X Window System is not installed"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, x-window, services]
cis_id: "2.1.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
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

Verify X Windows System is not installed. The following command should return empty result.

```bash
# grep xorg /etc/cos-package-info.json
```

## Expected Result

The command should return no output, confirming that X Window System packages are not installed.

## Remediation

An OS image update that does not include X Window System is required.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **2.3 Address Unauthorized Software** - Ensure that unauthorized software is either removed from use on enterprise assets or receives a documented exception. Review monthly, or more frequently. | X    | X    | X    |
| v7               | **2.6 Address unapproved software** - Ensure that unauthorized software is either removed or the inventory is updated in a timely manner                                                          | X    | X    | X    |

## Profile

- Level 1 - Server
