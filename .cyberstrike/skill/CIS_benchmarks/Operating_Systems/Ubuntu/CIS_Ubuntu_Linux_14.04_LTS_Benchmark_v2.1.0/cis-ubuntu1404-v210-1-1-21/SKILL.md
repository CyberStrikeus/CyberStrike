---
name: "CIS Ubuntu 14.04 LTS - 1.1.21 Disable Automounting"
description: "Disable autofs to prevent automatic mounting of removable media devices"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - filesystem
cis_id: "1.1.21"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.21 Disable Automounting (Scored)

## Profile Applicability
- Level 1 - Server
- Level 2 - Workstation

## Description
autofs allows automatic mounting of devices, typically including CD/DVDs and USB drives.

## Rationale
With automounting enabled anyone with physical access could attach a USB drive or disc and have its contents available in system even if they lacked permissions to mount it themselves.

## Audit Procedure
```bash
# Run the following commands to verify no start conditions listed for autofs:
initctl show-config autofs
# Expected output: autofs
```

## Expected Result
The output should show autofs with no start conditions listed (no `start on` directives).

## Remediation
```bash
# Remove or comment out start lines in /etc/init/autofs.conf:
#start on runlevel [2345]
```

## Default Value
By default, autofs may be enabled.

## Impact
The use of portable hard drives is very common for workstation users. If your organization allows the use of portable storage or media on workstations and physical access controls to workstations is considered adequate there is little value add in turning off automounting.

## Notes
This control should align with the tolerance of the use of portable drives and optical media in the organization. On a server requiring an admin to manually mount media can be part of defense-in-depth to reduce the risk of unapproved software or information being introduced or proprietary software or information being exfiltrated.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0

## Profile
- Level 1
