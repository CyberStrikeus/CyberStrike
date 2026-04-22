---
name: cis-ubuntu2004-v300-2-1-17
description: "Ensure web proxy server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.17"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.17 Ensure web proxy server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Squid is a standard proxy server used in many distributions and environments.

## Rationale

If there is no need for a proxy server, it is recommended that the squid proxy software be disabled to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify squid is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' squid
```

If installed, run:

```bash
# systemctl is-enabled squid.service
# systemctl is-active squid.service
```

Verify the service is not enabled and not active.

## Expected Result

squid should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge squid:

```bash
# systemctl stop squid.service
# systemctl mask squid.service
# apt purge squid
```

## Default Value

squid is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
