---
name: cis-ubuntu1804-v220-3-1-3
description: "Ensure bluetooth services are not in use"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, bluetooth]
cis_id: "3.1.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.1.3

## Description

Bluetooth is a short-range wireless technology standard that is used for exchanging data between devices over short distances.

## Rationale

If Bluetooth is not to be used, it should be disabled to reduce the potential attack surface.

## Impact

Many workstations and some servers may need to use Bluetooth to connect with peripherals. If so, Bluetooth will need to remain enabled.

## Audit Procedure

### Command Line

Run the following command to verify `bluetooth.service` is not active:

```bash
systemctl is-active bluetooth.service 2>/dev/null | grep '^active'
```

Nothing should be returned.

Run the following command to verify the `bluetooth` package is not installed:

```bash
dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' bluez 2>/dev/null | grep -P 'installed'
```

Nothing should be returned.

## Expected Result

Both commands should return no output (the bluetooth service is inactive and the bluez package is not installed).

## Remediation

### Command Line

Run the following commands to stop and mask the `bluetooth.service`:

```bash
systemctl stop bluetooth.service
systemctl mask bluetooth.service
```

Run the following command to uninstall the `bluez` package:

```bash
apt purge bluez
```

## Default Value

Bluetooth may be enabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7, SC-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software.

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile Applicability

- Level 1 - Server
- Level 2 - Workstation

## Assessment Status

Automated
