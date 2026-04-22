---
name: cis-ubuntu1204-v110-6-9
description: "Ensure FTP Server is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, ftp, vsftpd, attack-surface]
cis_id: "6.9"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.9 Ensure FTP Server is not enabled (Not Scored)

## Profile Applicability
- Level 1

## Description
The File Transfer Protocol (FTP) provides networked computers with the ability to transfer files.

## Rationale
FTP does not protect the confidentiality of data or authentication credentials. It is recommended sftp be used if file transfer is required. Unless there is a need to run the system as a FTP server (for example, to allow anonymous downloads), it is recommended that the package be deleted to reduce the potential attack surface.

## Audit Procedure
### Using Command Line
Ensure no start conditions listed for `vsftpd`:
```bash
initctl show-config vsftpd vsftpd
```

## Expected Result
No start conditions should be listed for vsftpd.

## Remediation
### Using Command Line
Remove or comment out start lines in `/etc/init/vsftpd.conf`:
```bash
sed -i 's/^start/#start/' /etc/init/vsftpd.conf
```

## Default Value
Not installed by default on Ubuntu 12.04 LTS Server.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Not Scored
