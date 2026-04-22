---
name: cis-ubuntu2004-v300-2-1-2
description: "Ensure avahi daemon services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.2 Ensure avahi daemon services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 2 - Workstation

## Description

Avahi is a free zeroconf implementation, including a system for multicast DNS/DNS-SD service discovery. Avahi allows programs to publish and discover services and hosts running on a local network with no specific configuration.

## Rationale

Automatic discovery of network services is not normally required for system functionality. It is recommended to disable the service to reduce the remote attack surface.

## Audit Procedure

### Command Line

Run the following command to verify avahi-daemon is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' avahi-daemon
```

If installed, run:

```bash
# systemctl is-enabled avahi-daemon.socket avahi-daemon.service
# systemctl is-active avahi-daemon.socket avahi-daemon.service
```

Verify the services are not enabled and not active.

## Expected Result

avahi-daemon should not be installed, or if installed, the services should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge avahi-daemon:

```bash
# systemctl stop avahi-daemon.socket avahi-daemon.service
# systemctl mask avahi-daemon.socket avahi-daemon.service
# apt purge avahi-daemon
```

## Default Value

avahi-daemon is installed by default on desktop installations.

## References

1. NIST SP 800-53 Rev. 5: SI-4

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
