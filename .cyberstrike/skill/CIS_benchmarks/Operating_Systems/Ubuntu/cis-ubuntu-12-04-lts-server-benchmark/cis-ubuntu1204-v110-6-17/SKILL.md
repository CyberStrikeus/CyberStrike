---
name: cis-ubuntu1204-v110-6-17
description: "Ensure Biosdevname is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, biosdevname, udev, device-naming, attack-surface]
cis_id: "6.17"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.17 Ensure Biosdevname is not enabled (Scored)

## Profile Applicability

- Level 1

## Description

`biosdevname` is an external tool that works with the udev framework for naming devices.

`biosdevname` uses three methods to determine NIC names:

1. PCI firmware spec 3.1
2. smbios (matches # after "em" to OEM # printed on board or housing)
3. PCI IRQ Routing Table (uses # of NIC position in the device history). If the BIOS does not support `biosdevname`, no NICs are re-named.

## Rationale

`biosdevname` is an external tool that works with the `udev` framework for custom renaming of system hardware connections made by the kernel and BIOS. As allowing the renaming of devices can severely disrupt network communications by creating resource conflicts and provide an attack vector for denial of service exploits, this capability should be disabled or restricted according to the needs of the organization.

## Audit Procedure

### Using Command Line

Run the following command:

```bash
dpkg -s biosdevname
```

## Expected Result

Ensure package status is not-installed or dpkg returns no info is available.

## Remediation

### Using Command Line

Uninstall the `biosdevname` package:

```bash
apt-get purge biosdevname
```

## Default Value

Not installed by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
