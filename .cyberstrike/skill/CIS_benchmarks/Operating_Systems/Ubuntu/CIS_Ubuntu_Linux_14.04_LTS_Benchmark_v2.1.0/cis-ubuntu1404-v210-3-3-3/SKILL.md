---
name: "CIS Ubuntu 14.04 LTS - 3.3.3 Ensure IPv6 is disabled"
description: "Verify that IPv6 is disabled if not required to reduce the attack surface"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - ipv6
  - network
cis_id: "3.3.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 3.3.3 Ensure IPv6 is disabled (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Although IPv6 has many advantages over IPv4, few organizations have implemented IPv6.

## Rationale

If IPv6 is not to be used, it is recommended that it be disabled to reduce the attack surface of the system.

## Audit Procedure

Run the following command and verify that each linux line has the `ipv6.disable=1` parameter set:

```bash
grep "^\s*linux" /boot/grub/grub.cfg
```

## Expected Result

Each linux line should contain `ipv6.disable=1`.

## Remediation

Edit `/etc/default/grub` and add `ipv6.disable=1` to GRUB_CMDLINE_LINUX:

```
GRUB_CMDLINE_LINUX="ipv6.disable=1"
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

## Default Value

IPv6 is enabled by default.

## References

- CIS Controls: 3 - Secure Configurations for Hardware and Software on Mobile Devices, Laptops, Workstations, and Servers
- CIS Controls: 11 - Secure Configurations for Network Devices such as Firewalls, Routers and switches

## Profile

- Level 1 - Server
- Level 1 - Workstation
