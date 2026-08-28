---
name: cis-ubuntu1604-v200-1-1-24
description: "Disable USB Storage"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, usb-storage, kernel-module, physical-security]
cis_id: "1.1.24"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Disable USB Storage

## Description

USB storage provides a means to transfer and store files insuring persistence and availability of the files independent of network connection status. Its popularity and utility has led to USB-based malware being a simple and common means for network infiltration and a first step to establishing a persistent threat within a networked environment.

Note: An alternative solution to disabling the usb-storage module may be found in USBGuard. Use of USBGuard and construction of USB device policies should be done in alignment with site policy.

## Rationale

Restricting USB access on the system will decrease the physical attack surface for a device and diminish the possible vectors to introduce malware.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# Run the following commands and verify the output is as indicated:
modprobe -n -v usb-storage
# install /bin/true

lsmod | grep usb-storage
# <No output>
```

## Expected Result

```
install /bin/true
```

The `lsmod` command should return no output.

## Remediation

### Command Line

```bash
# Edit or create a file in the /etc/modprobe.d/ directory ending in .conf
# Example: vi /etc/modprobe.d/usb_storage.conf
# and add the following line:
install usb-storage /bin/true

# Run the following command to unload the usb-storage module:
rmmod usb-storage
```

## Default Value

Not disabled by default.

## References

- CIS Controls Version 7 - 8.4 Configure Anti-Malware Scanning of Removable Devices: Configure devices so that they automatically conduct an anti-malware scan of removable media when inserted or connected.
- CIS Controls Version 7 - 8.5 Configure Devices Not To Auto-run Content: Configure devices to not auto-run content from removable media.

## Profile

Level 1 - Server / Level 2 - Workstation, Assessment: Automated
