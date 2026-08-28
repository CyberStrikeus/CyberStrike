---
name: cis-ubuntu1204-v110-6-15
description: "Configure Mail Transfer Agent for Local-Only Mode"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, mta, postfix, mail, sendmail, attack-surface]
cis_id: "6.15"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.15 Configure Mail Transfer Agent for Local-Only Mode (Scored)

## Profile Applicability

- Level 1

## Description

Mail Transfer Agents (MTA), such as sendmail and Postfix, are used to listen for incoming mail and transfer the messages to the appropriate user or mail server. If the system is not intended to be a mail server, it is recommended that the MTA be configured to only process local mail.

## Rationale

The software for all Mail Transfer Agents is complex and most have a long history of security issues. While it is important to ensure that the system can process local mail messages, it is not necessary to have the MTA's daemon listening on a port unless the server is intended to be a mail server that receives and processes mail from other systems.

**Note:** The remediation given here provides instructions for configuring the postfix mail server, depending on your environment you may have an alternative MTA installed such as sendmail. If this is the case consult the documentation for your installed MTA to configure the recommended state.

## Audit Procedure

### Using Command Line

Perform the following command and make sure that the MTA is listening on the loopback address (127.0.0.1):

```bash
netstat -an | grep LIST | grep ":25[[:space:]]"
```

## Expected Result

```
tcp        0      0 127.0.0.1:25            0.0.0.0:*               LISTEN
```

The MTA should only be listening on localhost (127.0.0.1).

## Remediation

### Using Command Line

Edit `/etc/postfix/main.cf` and add the following line to the RECEIVING MAIL section. If the line already exists, change it to look like the line below:

```
inet_interfaces = localhost
```

Restart postfix:

```bash
service postfix restart
```

## Default Value

Postfix is installed and listening on all interfaces by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
