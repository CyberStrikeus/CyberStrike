---
name: cis-ubuntu1204-v110-8-2-3
description: "Configure /etc/rsyslog.conf"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, rsyslog, configuration, syslog]
cis_id: "8.2.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.2.3 Configure /etc/rsyslog.conf (Not Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/rsyslog.conf` file specifies rules for logging and which files are to be used to log certain classes of messages.

## Rationale

A great deal of important security-related information is sent via `rsyslog` (e.g., successful and failed su attempts, failed login attempts, root login attempts, etc.).

## Audit Procedure

### Using Command Line

Review the contents of the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*` files to ensure appropriate logging is set. In addition, perform the following command and ensure that the log files are logging information:

```bash
ls -l /var/log/
```

## Expected Result

Log files should exist and contain recent log entries as configured in `/etc/rsyslog.conf`.

## Remediation

### Using Command Line

Edit the following lines in the `/etc/rsyslog.conf` or `/etc/rsyslog.d/*` file as appropriate for your environment:

```bash
*.emerg :omusrmsg:* mail.* -
/var/log/mail mail.info -
/var/log/mail.info mail.warning -
/var/log/mail.warn mail.err
/var/log/mail.err news.crit -
/var/log/news/news.crit news.err -
/var/log/news/news.err news.notice -
/var/log/news/news.notice
*.=warning;*.=err -/var/log/warn
*.crit /var/log/warn
*.*;mail.none;news.none -/var/log/messages
local0,local1.* -/var/log/localmessages local2,local3.*
-/var/log/localmessages local4,local5.* -
/var/log/localmessages local6,local7.* -
/var/log/localmessages
```

Execute the following command to restart rsyslogd:

```bash
pkill -HUP rsyslogd
```

## Default Value

The default rsyslog.conf has basic logging configured.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- See the rsyslog.conf(5) man page for more information.

## Profile

Level 1 - Not Scored
