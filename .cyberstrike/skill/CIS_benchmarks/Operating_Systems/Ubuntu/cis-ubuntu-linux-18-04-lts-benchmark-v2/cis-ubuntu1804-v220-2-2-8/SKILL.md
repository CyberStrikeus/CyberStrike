---
name: cis-ubuntu1804-v220-2-2-8
description: "Ensure FTP Server is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, ftp]
cis_id: "2.2.8"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.8 Ensure FTP Server is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The File Transfer Protocol (FTP) provides networked computers with the ability to transfer files.

## Rationale

FTP does not protect the confidentiality of data or authentication credentials. It is recommended SFTP be used if file transfer is required. Unless there is a need to run the system as a FTP server (for example, to allow anonymous downloads), it is recommended that the package be deleted to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify `vsftpd` is not installed:

```bash
# dpkg-query -s vsftpd &>/dev/null && echo "vsftpd is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Run the following command to remove `vsftpd`:

```bash
# apt purge vsftpd
```

## References

1. NIST SP 800-53 Rev. 5: CM-7

Additional Information:

Additional FTP servers also exist and should be audited.

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
