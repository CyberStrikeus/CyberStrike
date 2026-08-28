---
name: cis-ubuntu1604-v200-1-1-23
description: "Disable Automounting"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, autofs, automount, removable-media]
cis_id: "1.1.23"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Disable Automounting

## Description

autofs allows automatic mounting of devices, typically including CD/DVDs and USB drives.

Note: This control should align with the tolerance of the use of portable drives and optical media in the organization. On a server requiring an admin to manually mount media can be part of defense-in-depth to reduce the risk of unapproved software or information being introduced or proprietary software or information being exfiltrated. If admins commonly use flash drives and Server access has sufficient physical controls, requiring manual mounting may not increase security.

## Rationale

With automounting enabled anyone with physical access could attach a USB drive or disc and have its contents available in system even if they lacked permissions to mount it themselves.

## Impact

The use of portable hard drives is very common for workstation users. If your organization allows the use of portable storage or media on workstations and physical access controls to workstations is considered adequate there is little value add in turning off automounting.

## Audit Procedure

### Command Line

```bash
# autofs should be removed or disabled.
# Run the following commands to verify that autofs is not installed or is disabled

# Run the following command to verify autofs is not enabled:
systemctl is-enabled autofs
# Verify result is not "enabled".

# OR
# Run the following command to verify that autofs is not installed
dpkg -s autofs
# Output should include: package 'autofs' is not installed
```

## Expected Result

```
disabled
```

OR

```
package `autofs` is not installed
```

## Remediation

### Command Line

```bash
# Run one of the following commands:
# Run the following command to disable autofs:
systemctl --now disable autofs

# OR
# Run the following command to remove autofs
apt purge autofs
```

## Default Value

autofs is not installed by default.

## References

- CIS Controls Version 7 - 8.4 Configure Anti-Malware Scanning of Removable Devices: Configure devices so that they automatically conduct an anti-malware scan of removable media when inserted or connected.
- CIS Controls Version 7 - 8.5 Configure Devices Not To Auto-run Content: Configure devices to not auto-run content from removable media.

## Profile

Level 1 - Server / Level 2 - Workstation, Assessment: Automated
