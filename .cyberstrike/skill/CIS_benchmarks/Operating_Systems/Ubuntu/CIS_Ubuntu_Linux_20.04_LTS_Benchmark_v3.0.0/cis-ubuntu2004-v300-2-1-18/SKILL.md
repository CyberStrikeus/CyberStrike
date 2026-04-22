---
name: cis-ubuntu2004-v300-2-1-18
description: "Ensure web server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.18"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.18 Ensure web server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Web servers provide the ability to host web site content. The two most common web server packages available are apache2 and nginx.

## Rationale

If there is no need to run the system as a web server, it is recommended that the service be disabled to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following commands to verify apache2 and nginx are not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' apache2 nginx
```

If installed, run:

```bash
# systemctl is-enabled apache2.socket apache2.service nginx.service
# systemctl is-active apache2.socket apache2.service nginx.service
```

Verify the services are not enabled and not active.

## Expected Result

apache2 and nginx should not be installed, or if installed, the services should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge web servers:

```bash
# systemctl stop apache2.socket apache2.service nginx.service
# systemctl mask apache2.socket apache2.service nginx.service
# apt purge apache2 nginx
```

## Default Value

apache2 and nginx are not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
