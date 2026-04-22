---
name: cis-ubuntu2004-v300-2-1-6
description: "Ensure ftp server services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.6 Ensure ftp server services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

FTP (File Transfer Protocol) is a traditional and widely used standard tool for transferring files between a server and clients over a network, especially where no authentication is necessary (permits anonymous users to connect to a server).

## Rationale

FTP does not protect the confidentiality of data or authentication credentials. It is recommended SFTP be used if file transfer is required. Unless there is a need to run the system as an FTP server, it is recommended that the service be disabled to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify vsftpd is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' vsftpd
```

If installed, run:

```bash
# systemctl is-enabled vsftpd.service
# systemctl is-active vsftpd.service
```

Verify the service is not enabled and not active.

## Expected Result

vsftpd should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge vsftpd:

```bash
# systemctl stop vsftpd.service
# systemctl mask vsftpd.service
# apt purge vsftpd
```

## Default Value

vsftpd is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | x | x |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | x | x |

MITRE ATT&CK Mappings: T1203, T1210, T1543, T1543.002 | TA0008 | M1042
