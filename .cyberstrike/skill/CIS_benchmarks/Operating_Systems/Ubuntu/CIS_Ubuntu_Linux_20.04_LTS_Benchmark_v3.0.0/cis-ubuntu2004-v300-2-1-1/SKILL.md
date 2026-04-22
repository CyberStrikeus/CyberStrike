---
name: cis-ubuntu2004-v300-2-1-1
description: "Ensure autofs services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.1 Ensure autofs services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 2 - Workstation

## Description

autofs allows automatic mounting of devices, typically including CD/DVDs and USB drives.

## Rationale

With automounting enabled anyone with physical access could attach a USB drive or disc and have its contents available in system even if they lacked permissions to mount it themselves.

- IF - autofs is required, additional steps may be needed to harden the autofs configuration.

## Audit Procedure

### Command Line

Run the following command to verify autofs is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' autofs
```

`autofs` should not be installed. If installed, run:

```bash
# systemctl is-enabled autofs.service
# systemctl is-active autofs.service
```

Verify the service is not enabled and not active.

## Expected Result

autofs should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge autofs:

```bash
# systemctl stop autofs.service
# systemctl mask autofs.service
# apt purge autofs
```

## Default Value

autofs is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: SI-3, MP-7
2. RHEL 8 STIG

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 10.3 Disable Autorun and Autoplay for Removable Media |      | x    | x    |
| v7               | 8.5 Configure Devices Not To Auto-run Content         |      | x    | x    |

MITRE ATT&CK Mappings: T1068, T1203, T1211, T1212 | TA0008 | M1042
