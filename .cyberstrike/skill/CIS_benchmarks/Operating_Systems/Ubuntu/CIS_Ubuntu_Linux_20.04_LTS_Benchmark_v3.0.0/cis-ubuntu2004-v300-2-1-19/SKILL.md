---
name: cis-ubuntu2004-v300-2-1-19
description: "Ensure xinetd services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.19"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.19 Ensure xinetd services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The eXtended InterNET Daemon (xinetd) is an open source super daemon that replaced the original inetd daemon. The xinetd daemon listens for well known services and dispatches the appropriate daemon to properly respond to service requests.

## Rationale

If there is no need for xinetd, it is recommended that the daemon be disabled in order to reduce the remote attack surface.

## Audit Procedure

### Command Line

Run the following command to verify xinetd is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' xinetd
```

If installed, run:

```bash
# systemctl is-enabled xinetd.service
# systemctl is-active xinetd.service
```

Verify the service is not enabled and not active.

## Expected Result

xinetd should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge xinetd:

```bash
# systemctl stop xinetd.service
# systemctl mask xinetd.service
# apt purge xinetd
```

## Default Value

xinetd is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
