---
name: cis-ubuntu1804-v220-5-1-2-5
description: "Ensure logging is configured"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, rsyslog, logging]
cis_id: "5.1.2.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2.5 Ensure logging is configured (Manual)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

The `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files specifies rules for logging and which files are to be used to log certain classes of messages.

## Rationale

A great deal of important security-related information is sent via `rsyslog` (e.g., successful and failed su attempts, failed login attempts, root login attempts, etc.).

## Audit Procedure

### Command Line

Review the contents of `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files to ensure appropriate logging is set. In addition, run the following command and verify that the log files are logging information as expected:

```bash
ls -l /var/log/
```

## Expected Result

Log files should exist and be actively receiving log data appropriate for the system.

## Remediation

### Command Line

Edit the following lines in the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files as appropriate for your environment. NOTE: The below configuration is shown for example purposes only. Due care should be given to how the organization wish to store log data.

```
*.emerg                          :omusrmsg:*
auth,authpriv.*                  /var/log/secure
mail.*                           -/var/log/mail
mail.info                        -/var/log/mail.info
mail.warning                     -/var/log/mail.warn
mail.err                         /var/log/mail.err
cron.*                           /var/log/cron
*.=warning;*.=err                -/var/log/warn
*.crit                           /var/log/warn
*.*;mail.none;news.none          -/var/log/messages
local0,local1.*                  -/var/log/localmessages
local2,local3.*                  -/var/log/localmessages
local4,local5.*                  -/var/log/localmessages
local6,local7.*                  -/var/log/localmessages
```

Run the following command to reload the `rsyslogd` configuration:

```bash
systemctl restart rsyslog
```

## Default Value

Default logging is configured.

## References

1. See the rsyslog.conf(5) man page for more information.
2. NIST SP 800-53 Rev. 5: AU-2, AU-7, AU-12

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v8               | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.                                         |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |
| v7               | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
