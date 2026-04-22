---
name: cis-ubuntu1804-v220-1-1-9
description: "Disable Automounting"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, autofs, automount, service]
cis_id: "1.1.9"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Disable Automounting

## Profile

Level 1 - Server / Level 2 - Workstation, Assessment: Automated

## Description

autofs allows automatic mounting of devices, typically including CD/DVDs and USB drives.

## Rationale

With automounting enabled anyone with physical access could attach a USB drive or disc and have its contents available in system even if they lacked permissions to mount it themselves. autofs can be configured to mount on insertion or accessed directly.

## Impact

The use of portable hard drives is very common for workstation users. If your organization allows the use of portable storage or media on workstations and physical access controls to workstations are considered adequate, the risk of autofs can be mitigated.

## Audit Procedure

### Command Line

Run the following commands to verify autofs is not installed or the autofs service is masked:

If autofs is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' autofs
```

If autofs is installed, verify the service is masked:

```bash
# systemctl is-enabled autofs 2>/dev/null | grep 'enabled'
```

## Expected Result

If autofs is not installed, dpkg-query should return:
```
dpkg-query: no packages found matching autofs
```

If autofs is installed, `systemctl is-enabled autofs` should NOT return `enabled`. Ideally the service should be masked.

## Remediation

### Command Line

Run one of the following commands:

To remove autofs:

```bash
apt purge autofs
```

-OR-

To disable and mask the autofs service:

```bash
systemctl stop autofs
systemctl mask autofs
```

## Default Value

autofs is not installed by default on Ubuntu 18.04.

## References

1. NIST SP 800-53 Rev. 5: SI-3, MP-7

## CIS Controls

v8 - 10.3 Disable Autorun and Autoplay for Removable Media (IG 1, IG 2, IG 3)
v7 - 8.5 Configure Devices Not To Auto-run Content (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1068, T1068.000, T1203, T1203.000, T1211, T1211.000, T1212, T1212.000 (TA0001, TA0008) - M1042
