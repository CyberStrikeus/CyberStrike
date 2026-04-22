---
name: "CIS Ubuntu 14.04 LTS - 4.2.1.4 Ensure rsyslog is configured to send logs to a remote log host"
description: "Configure rsyslog to forward logs to a remote log host for centralized logging"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - rsyslog
  - remote-logging
  - logging
cis_id: "4.2.1.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.2.1.4 Ensure rsyslog is configured to send logs to a remote log host (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `rsyslog` utility supports the ability to send logs it gathers to a remote log host running `syslogd(8)` or to receive messages from remote hosts, reducing administrative overhead.

## Rationale

Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

## Audit Procedure

Review the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files and verify that logs are sent to a central host (where `loghost.example.com` is the name of your central log host):

```bash
grep "^*.*[^I][^I]*@" /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

## Expected Result

```
*.* @@loghost.example.com
```

## Remediation

Edit the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files and add the following line (where `loghost.example.com` is the name of your central log host).

```bash
*.* @@loghost.example.com
```

Run the following command to reload the `rsyslogd` configuration:

```bash
pkill -HUP rsyslogd
```

**Notes:** The double "at" sign (`@@`) directs `rsyslog` to use TCP to send log messages to the server, which is a more reliable transport mechanism than the default UDP protocol.

## Default Value

Not configured by default.

## References

1. See the rsyslog.conf(5) man page for more information.

## Profile

- Level 1 - Server
- Level 1 - Workstation
