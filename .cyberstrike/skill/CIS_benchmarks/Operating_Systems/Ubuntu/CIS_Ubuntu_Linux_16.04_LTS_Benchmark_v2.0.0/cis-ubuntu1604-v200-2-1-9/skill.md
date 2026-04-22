---
name: cis-ubuntu1604-v200-2-1-9
description: "Ensure FTP Server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.9"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.9 Ensure FTP Server is not installed (Automated)

## Description

The File Transfer Protocol (FTP) provides networked computers with the ability to transfer files.

## Rationale

FTP does not protect the confidentiality of data or authentication credentials. It is recommended SFTP be used if file transfer is required. Unless there is a need to run the system as a FTP server (for example, to allow anonymous downloads), it is recommended that the package be deleted to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify vsftpd is not installed:

```bash
dpkg -s vsftpd | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'vsftpd' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove vsftpd:

```bash
apt purge vsftpd
```

## Default Value

vsftpd is not installed on minimal server installations. Additional FTP servers also exist and should be audited.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
