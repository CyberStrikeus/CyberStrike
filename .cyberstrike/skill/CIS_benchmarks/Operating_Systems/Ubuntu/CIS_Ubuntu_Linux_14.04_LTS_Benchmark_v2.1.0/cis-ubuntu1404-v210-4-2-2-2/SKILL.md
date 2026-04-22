---
name: "CIS Ubuntu 14.04 LTS - 4.2.2.2 Ensure logging is configured"
description: "Configure syslog-ng to capture appropriate logging for all facilities"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - syslog-ng
  - logging
cis_id: "4.2.2.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.2.2.2 Ensure logging is configured (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/syslog-ng/syslog-ng.conf` file specifies rules for logging and which files are to be used to log certain classes of messages.

## Rationale

A great deal of important security-related information is sent via `syslog-ng` (e.g., successful and failed su attempts, failed login attempts, root login attempts, etc.).

## Audit Procedure

Review the contents of the `/etc/syslog-ng/syslog-ng.conf` file to ensure appropriate logging is set. In addition, run the following command and ensure that the log files are logging information:

```bash
ls -l /var/log/
```

## Expected Result

Log files should exist and contain recent entries for all configured facilities.

## Remediation

Edit the log lines in the `/etc/syslog-ng/syslog-ng.conf` file as appropriate for your environment:

```
log { source(src); source(chroots); filter(f_console); destination(console); };
log { source(src); source(chroots); filter(f_console); destination(xconsole); };
log { source(src); source(chroots); filter(f_newscrit); destination(newscrit); };
log { source(src); source(chroots); filter(f_newserr); destination(newserr); };
log { source(src); source(chroots); filter(f_newsnotice); destination(newsnotice); };
log { source(src); source(chroots); filter(f_mailinfo); destination(mailinfo); };
log { source(src); source(chroots); filter(f_mailwarn); destination(mailwarn); };
log { source(src); source(chroots); filter(f_mailerr); destination(mailerr); };
log { source(src); source(chroots); filter(f_mail); destination(mail); };
log { source(src); source(chroots); filter(f_acpid); destination(acpid); flags(final); };
log { source(src); source(chroots); filter(f_acpid_full); destination(devnull); flags(final); };
log { source(src); source(chroots); filter(f_acpid_old); destination(acpid); flags(final); };
log { source(src); source(chroots); filter(f_netmgm); destination(netmgm); flags(final); };
log { source(src); source(chroots); filter(f_local); destination(localmessages); };
log { source(src); source(chroots); filter(f_messages); destination(messages); };
log { source(src); source(chroots); filter(f_iptables); destination(firewall); };
log { source(src); source(chroots); filter(f_warn); destination(warn); };
```

Run the following command to reload the `syslog-ng` configuration:

```bash
pkill -HUP syslog-ng
```

## Default Value

Basic logging is configured by default.

## References

1. See the syslog-ng man page for more information.

## Profile

- Level 1 - Server
- Level 1 - Workstation
