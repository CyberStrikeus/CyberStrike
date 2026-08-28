---
name: cis-ubuntu2004-v300-3-1-3
description: "Ensure bluetooth services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, network]
cis_id: "3.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.3 Ensure bluetooth services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 2 - Workstation

## Description

Bluetooth is a short-range wireless technology standard that is used for exchanging data between devices over short distances. It employs UHF radio waves in the ISM bands, from 2.402 GHz to 2.48 GHz. It is mainly used as an alternative to wire connections.

## Rationale

An attacker may be able to find a way to access or corrupt your data. One example of this type of activity is bluesnarfing, which refers to attackers using a Bluetooth connection to steal information off of your Bluetooth device. Also, viruses or other malicious code can take advantage of Bluetooth technology to infect other devices. If you are infected, your data may be corrupted, compromised, stolen, or lost.

## Impact

Many personal electronic devices (PEDs) use Bluetooth technology. For example, you may be able to operate your computer with a wireless keyboard. Disabling Bluetooth will prevent these devices from connecting to the system.

There may be packages that are dependent on the bluez package. If the bluez package is removed, these dependent packages will be removed as well. Before removing the bluez package, review any dependent packages to determine if they are required on the system.

-IF- a dependent package is required: stop and mask bluetooth.service leaving the bluez package installed.

## Audit Procedure

### Command Line

Run the following command to verify the bluez package is not installed:

```bash
# dpkg-query -s bluez &>/dev/null && echo "bluez is installed"
```

Nothing should be returned.

- OR -
- IF - the bluez package is required as a dependency:
  Run the following command to verify bluetooth.service is not enabled:

```bash
# systemctl is-enabled bluetooth.service 2>/dev/null | grep 'enabled'
```

Nothing should be returned.
Run the following command to verify bluetooth.service is not active:

```bash
# systemctl is-active bluetooth.service 2>/dev/null | grep '^active'
```

Nothing should be returned.
Note: If the package is required for a dependency

- Ensure the dependent package is approved by local site policy
- Ensure stopping and masking the service and/or socket meets local site policy

## Expected Result

Nothing should be returned from any of the audit commands, indicating bluez is not installed or bluetooth.service is not enabled/active.

## Remediation

### Command Line

Run the following commands to stop bluetooth.service, and remove the bluez package:

```bash
# systemctl stop bluetooth.service
# apt purge bluez
```

- OR -
- IF - the bluez package is required as a dependency:
  Run the following commands to stop and mask bluetooth.service:

```bash
# systemctl stop bluetooth.service
# systemctl mask bluetooth.service
```

Note: A reboot may be required

## Default Value

bluez is not installed by default on server installations.

## References

1. https://www.cisa.gov/tips/st05-015
2. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |
