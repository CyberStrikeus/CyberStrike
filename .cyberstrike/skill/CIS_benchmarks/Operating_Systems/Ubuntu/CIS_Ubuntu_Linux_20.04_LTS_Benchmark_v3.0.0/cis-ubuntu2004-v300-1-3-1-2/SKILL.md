---
name: cis-ubuntu2004-v300-1-3-1-2
description: "Ensure AppArmor is enabled in the bootloader configuration"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, apparmor, bootloader, grub]
cis_id: "1.3.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.1.2 Ensure AppArmor is enabled in the bootloader configuration (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Configure AppArmor to be enabled at boot time and verify that it has not been overwritten by the bootloader boot parameters.

Note: This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

## Rationale

AppArmor must be enabled at boot time in your bootloader configuration to ensure that the controls it provides are not overridden.

## Audit Procedure

### Command Line

Run the following command to verify that all `linux` lines have the `apparmor=1` parameter set:

```bash
# grep "^\s*linux" /boot/grub/grub.cfg | grep -v "apparmor=1"
```

Nothing should be returned.

Run the following command to verify that all `linux` lines have the `security=apparmor` parameter set:

```bash
# grep "^\s*linux" /boot/grub/grub.cfg | grep -v "security=apparmor"
```

Nothing should be returned.

## Expected Result

No output should be returned for either command, indicating all linux lines have both `apparmor=1` and `security=apparmor` parameters set.

## Remediation

### Command Line

Edit `/etc/default/grub` and add the `apparmor=1` and `security=apparmor` parameters to the `GRUB_CMDLINE_LINUX=` line:

```
GRUB_CMDLINE_LINUX="apparmor=1 security=apparmor"
```

Run the following command to update the `grub2` configuration:

```bash
# update-grub
```

## References

1. NIST SP 800-53 Rev. 5: AC-3

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

MITRE ATT&CK Mappings: T1068, T1068.000, T1565, T1565.001, T1565.003 | TA0003 | M1026
