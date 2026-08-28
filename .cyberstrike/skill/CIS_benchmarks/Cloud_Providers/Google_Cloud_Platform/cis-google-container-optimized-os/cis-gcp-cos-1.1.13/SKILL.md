---
name: cis-gcp-cos-1.1.13
description: "Disable Automounting"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, filesystem, partitions, mount-options, automounting]
cis_id: "1.1.13"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.13 Disable Automounting (Automated)

## Description

`autofs` allows automatic mounting of devices, typically including CD/DVDs and USB drives.

## Rationale

With automounting enabled anyone with physical access could attach a USB drive or disc and have its contents available in system even if they lacked permissions to mount it themselves.

## Impact

The use of portable hard drives is very common for workstation users. If your organization allows the use of portable storage or media on workstations and physical access controls to workstations is considered adequate there is little value add in turning off automounting.

## Audit Procedure

Run the following command and verify result is not "enabled":

```bash
# systemctl is-enabled autofs
disabled
```

## Expected Result

The command should return `disabled` (not `enabled`).

## Remediation

Run the following command to disable `autofs`:

```bash
# systemctl disable autofs
```

## Default Value

Additional methods of disabling a service exist. Consult your distribution documentation for appropriate methods.

This control should align with the tolerance of the use of portable drives and optical media in the organization. On a server requiring an admin to manually mount media can be part of defense-in-depth to reduce the risk of unapproved software or information being introduced or proprietary software or information being exfiltrated. If admins commonly use flash drives and Server access has sufficient physical controls, requiring manual mounting may not increase security.

## Profile

Level 1 - Server | Automated
