---
name: cis-ubuntu2004-v300-2-1-16
description: "Ensure tftp server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.16"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.16 Ensure tftp server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Trivial File Transfer Protocol (TFTP) is a simple protocol for exchanging files between two TCP/IP machines. TFTP servers allow connections from a TFTP Client for sending and receiving files.

## Rationale

TFTP does not support authentication nor does it ensure the confidentiality or integrity of data. It is recommended that TFTP be removed, unless there is a specific need for TFTP. In that case, extreme caution should be used when configuring the services.

## Audit Procedure

### Command Line

Run the following command to verify tftpd-hpa is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' tftpd-hpa
```

If installed, run:

```bash
# systemctl is-enabled tftpd-hpa.service
# systemctl is-active tftpd-hpa.service
```

Verify the service is not enabled and not active.

## Expected Result

tftpd-hpa should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge tftpd-hpa:

```bash
# systemctl stop tftpd-hpa.service
# systemctl mask tftpd-hpa.service
# apt purge tftpd-hpa
```

## Default Value

tftpd-hpa is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
