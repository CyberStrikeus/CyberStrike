---
name: cis-ubuntu1604-v200-2-1-11
description: "Ensure IMAP and POP3 server are not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.11"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.11 Ensure IMAP and POP3 server are not installed (Automated)

## Description

dovecot-imapd and dovecot-pop3d are an open source IMAP and POP3 server for Linux based systems.

## Rationale

Unless POP3 and/or IMAP servers are to be provided by this system, it is recommended that the package be removed to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify dovecot-imapd and dovecot-pop3d are not installed:

```bash
dpkg -s dovecot-imapd dovecot-pop3d | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'dovecot-imapd' is not installed and no information is available
dpkg-query: package 'dovecot-pop3d' is not installed and no information is available
```

## Remediation

### Command Line

Run one of the following commands to remove dovecot-imapd and dovecot-pop3d:

```bash
apt purge dovecot-imapd dovecot-pop3d
```

## Default Value

dovecot-imapd and dovecot-pop3d are not installed on minimal server installations. Several IMAP/POP3 servers exist and can use other service names. courier-imap and cyrus-imap are example services that provide a mail server. These and other services should also be audited.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
