---
name: "CIS Ubuntu 14.04 LTS - 2.2.15 Ensure mail transfer agent is configured for local-only mode"
description: "Verify that MTA is configured to only listen on loopback address"
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
cis_id: "2.2.15"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.15 Ensure mail transfer agent is configured for local-only mode (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Mail Transfer Agents (MTA), such as sendmail and Postfix, are used to listen for incoming mail and transfer the messages to the appropriate user or mail server. If the system is not intended to be a mail server, it is recommended that the MTA be configured to only process local mail.

## Rationale

The software for all Mail Transfer Agents is complex and most have a long history of security issues. While it is important to ensure that the system can process local mail messages, it is not necessary to have the MTA's daemon listening on a port unless the server is intended to be a mail server that receives and processes mail from other systems.

## Audit Procedure

Run the following command and verify that the MTA is not listening on any non-loopback address (`127.0.0.1` or `::1`):

```bash
netstat -an | grep LIST | grep ":25[[:space:]]"
```

Expected output:

```
tcp 0 0 127.0.0.1:25 0.0.0.0:* LISTEN
```

## Expected Result

The MTA should only be listening on the loopback address (127.0.0.1:25 or ::1:25). No non-loopback addresses should appear.

## Remediation

Edit `/etc/postfix/main.cf` and add the following line to the RECEIVING MAIL section. If the line already exists, change it to look like the line below:

```
inet_interfaces = loopback-only
```

Restart postfix:

```bash
service postfix restart
```

**Note:** This recommendation is designed around the postfix mail server, depending on your environment you may have an alternative MTA installed such as sendmail. If this is the case consult the documentation for your installed MTA to configure the recommended state.

## Default Value

Postfix listens on all interfaces by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
