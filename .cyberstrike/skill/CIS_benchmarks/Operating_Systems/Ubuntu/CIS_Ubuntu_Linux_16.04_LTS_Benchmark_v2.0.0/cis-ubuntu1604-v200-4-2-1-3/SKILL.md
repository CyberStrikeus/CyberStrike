---
name: cis-ubuntu1604-v200-4-2-1-3
description: "Ensure logging is configured"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.1.3

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

The `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files specifies rules for logging and which files are to be used to log certain classes of messages.

## Rationale

A great deal of important security-related information is sent via `rsyslog` (e.g., successful and failed su attempts, failed login attempts, root login attempts, etc.).

## Impact

None.

## Audit Procedure

Review the contents of the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files to ensure appropriate logging is set. In addition, run the following command and verify that the log files are logging information:

### Command Line

```bash
ls -l /var/log/
```

## Expected Result

The output should show log files with recent timestamps and non-zero sizes, indicating active logging.

## Remediation

Edit the following lines in the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files as appropriate for your environment:

### Command Line

```bash
cat << 'EOF'
*.emerg                          :omusrmsg:*
auth,authpriv.*                  /var/log/auth.log
mail.*                           -/var/log/mail
mail.info                        -/var/log/mail.info
mail.warning                     -/var/log/mail.warn
mail.err                          /var/log/mail.err
news.crit                        -/var/log/news/news.crit
news.err                         -/var/log/news/news.err
news.notice                      -/var/log/news/news.notice
*.=warning;*.=err                -/var/log/warn
*.crit                            /var/log/warn
*.*;mail.none;news.none          -/var/log/messages
local0,local1.*                  -/var/log/localmessages
local2,local3.*                  -/var/log/localmessages
local4,local5.*                  -/var/log/localmessages
local6,local7.*                  -/var/log/localmessages
EOF
```

Run the following command to reload the `rsyslog` configuration:

```bash
systemctl reload rsyslog
```

## Default Value

Not all of the above logging rules are configured by default.

## References

1. See the rsyslog.conf(5) man page for more information.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 6.2 Activate audit logging<br/>Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |      |      |      |
| v7               | 6.3 Enable Detailed Logging<br/>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |      |      |      |
