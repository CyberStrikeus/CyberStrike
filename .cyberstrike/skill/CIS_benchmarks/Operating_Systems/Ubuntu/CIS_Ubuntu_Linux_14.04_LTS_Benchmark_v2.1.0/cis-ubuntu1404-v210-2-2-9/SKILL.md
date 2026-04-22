---
name: "CIS Ubuntu 14.04 LTS - 2.2.9 Ensure FTP Server is not enabled"
description: "Verify that vsftpd FTP server is disabled when not required"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - services
cis_id: "2.2.9"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 2.2.9 Ensure FTP Server is not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The File Transfer Protocol (FTP) provides networked computers with the ability to transfer files.

## Rationale

FTP does not protect the confidentiality of data or authentication credentials. It is recommended sftp be used if file transfer is required. Unless there is a need to run the system as a FTP server (for example, to allow anonymous downloads), it is recommended that the package be deleted to reduce the potential attack surface.

## Audit Procedure

Run the following commands to verify no start conditions listed for `vsftpd`:

```bash
initctl show-config vsftpd
```

Verify the output shows `vsftpd` with no start conditions.

## Expected Result

The `vsftpd` service should have no start conditions listed.

## Remediation

Remove or comment out start lines in `/etc/init/vsftpd.conf`:

```bash
#start on runlevel [2345] or net-device-up IFACE!=lo
```

**Note:** Additional FTP servers also exist and should be audited.

## Default Value

FTP server is not enabled by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
