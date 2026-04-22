---
name: cis-ubuntu1804-v220-2-2-2
description: "Ensure Avahi Server is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, avahi]
cis_id: "2.2.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.2 Ensure Avahi Server is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Avahi is a free zeroconf implementation, including a system for multicast DNS/DNS-SD service discovery. Avahi allows programs to publish and discover services and hosts running on a local network with no specific configuration. For example, a user can plug a computer into a network and Avahi automatically finds printers to print to, files to look at and people to talk to, as well as network services running on the machine.

## Rationale

Automatic discovery of network services is not normally required for system functionality. It is recommended to remove this package to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify `avahi-daemon` is not installed:

```bash
# dpkg-query -s avahi-daemon &>/dev/null && echo "avahi-daemon is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Run the following commands to remove `avahi-daemon`:

```bash
# systemctl stop avahi-daemon.service
# systemctl stop avahi-daemon.socket
# apt purge avahi-daemon
```

## References

1. NIST SP 800-53 Rev. 5: SI-4

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
