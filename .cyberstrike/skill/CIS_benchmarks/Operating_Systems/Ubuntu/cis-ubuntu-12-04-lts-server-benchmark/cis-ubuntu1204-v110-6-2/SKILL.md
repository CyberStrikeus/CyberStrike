---
name: cis-ubuntu1204-v110-6-2
description: "Ensure Avahi Server is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, avahi, zeroconf, mdns, attack-surface]
cis_id: "6.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2 Ensure Avahi Server is not enabled (Scored)

## Profile Applicability

- Level 1

## Description

Avahi is a free zeroconf implementation, including a system for multicast DNS/DNS-SD service discovery. Avahi allows programs to publish and discover services and hosts running on a local network with no specific configuration. For example, a user can plug a computer into a network and Avahi automatically finds printers to print to, files to look at and people to talk to, as well as network services running on the machine.

## Rationale

Since servers are not normally used for printing, this service is not needed unless dependencies require it. If this is the case, disable the service to reduce the potential attack surface.

## Audit Procedure

### Using Command Line

Ensure no start conditions listed for `avahi-daemon`:

```bash
initctl show-config avahi-daemon avahi-daemon
```

## Expected Result

No start conditions should be listed for avahi-daemon.

## Remediation

### Using Command Line

Remove or comment out start lines in `/etc/init/avahi-daemon.conf`:

```bash
sed -i 's/^start/#start/' /etc/init/avahi-daemon.conf
```

## Default Value

Enabled by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
