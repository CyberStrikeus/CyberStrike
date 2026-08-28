---
name: "CIS Ubuntu 14.04 LTS - 3.7 Ensure wireless interfaces are disabled"
description: "Verify that wireless interfaces are disabled to reduce the attack surface"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - network
  - wireless
cis_id: "3.7"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 3.7 Ensure wireless interfaces are disabled (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 2 - Workstation

## Description

Wireless networking is used when wired networks are unavailable. Ubuntu contains a wireless tool kit to allow system administrators to configure and use wireless networks.

## Rationale

If wireless is not to be used, wireless devices can be disabled to reduce the potential attack surface.

## Audit Procedure

Run the following command to determine wireless interfaces on the system:

```bash
iwconfig
```

Run the following command and verify wireless interfaces are active:

```bash
ip link show up
```

## Expected Result

No wireless interfaces should be active (UP state).

## Remediation

Run the following command to disable any wireless interfaces:

```bash
ip link set <interface> down
```

Disable any wireless interfaces in your network configuration.

## Default Value

Wireless interfaces are enabled if hardware is present. Note: Many if not all laptop workstations and some desktop workstations will connect via wireless requiring these interfaces be enabled.

## References

- CIS Controls: 15.4 - Configure Only Authorized Wireless Access On Client Machines

## Profile

- Level 1 - Server
- Level 2 - Workstation
