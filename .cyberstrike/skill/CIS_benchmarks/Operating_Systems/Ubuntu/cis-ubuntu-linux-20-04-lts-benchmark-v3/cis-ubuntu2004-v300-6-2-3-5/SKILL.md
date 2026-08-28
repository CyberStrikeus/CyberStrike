---
name: cis-ubuntu2004-v300-6-2-3-5
description: "Ensure rsyslog logging is configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, rsyslog]
cis_id: "6.2.3.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3.5 Ensure rsyslog logging is configured (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `rsyslog` and configuration files specifies rules for logging and which files are to be used to log certain classes of messages.

## Rationale

A great deal of important security-related information is sent via `rsyslog` (e.g., successful and failed su attempts, failed login attempts, root login attempts, etc.).

## Audit Procedure

### Command Line

Review the contents of `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files to ensure appropriate logging is set. In addition, run the following command and verify that the log files are logging information as expected:

```bash
# ls -l /var/log/
```

Example output:

```
/etc/rsyslog.d/60-rsyslog.conf:auth,authpriv.*          /var/log/secure
/etc/rsyslog.d/60-rsyslog.conf:mail.*                    -/var/log/mail
/etc/rsyslog.d/60-rsyslog.conf:mail.info                 -/var/log/mail.info
/etc/rsyslog.d/60-rsyslog.conf:mail.warning              -/var/log/mail.warn
/etc/rsyslog.d/60-rsyslog.conf:mail.err                  /var/log/mail.err
/etc/rsyslog.d/60-rsyslog.conf:cron.*                    /var/log/cron
/etc/rsyslog.d/60-rsyslog.conf:*.=warning;*.=err         -/var/log/warn
/etc/rsyslog.d/60-rsyslog.conf:*.crit                    /var/log/warn
/etc/rsyslog.d/60-rsyslog.conf:*.*;mail.none;news.none   -/var/log/messages
```

Note:

- Output is generated as <CONFIGURATION_FILE>:<PARAMETER>
- Files are listed in order of precedence. If the same parameter is listed multiple times, only the first occurrence will be used be the `rsyslog` daemon

## Expected Result

Verify that log files are configured as appropriate for your environment.

## Remediation

### Command Line

Edit the following lines in the configuration file(s) returned by the audit as appropriate for your environment.
Note: The below configuration is shown for example purposes only. Due care should be given to how the organization wishes to store log data.

```
*.emerg                                  :omusrmsg:*
auth,authpriv.*                          /var/log/secure
mail.*                                   -/var/log/mail
mail.info                                -/var/log/mail.info
mail.warning                             -/var/log/mail.warn
mail.err                                 /var/log/mail.err
cron.*                                   /var/log/cron
*.=warning;*.=err                        -/var/log/warn
*.crit                                   /var/log/warn
*.*;mail.none;news.none                  -/var/log/messages
local0,local1.*                          -/var/log/localmessages
local2,local3.*                          -/var/log/localmessages
local4,local5.*                          -/var/log/localmessages
local6,local7.*                          -/var/log/localmessages
```

Run the following command to reload the `rsyslogd` configuration:

```bash
# systemctl reload-or-restart rsyslog
```

## Default Value

Not specifically configured by default.

## References

1. See the rsyslog.conf(5) man page for more information.
2. NIST SP 800-53 Rev. 5: AU-2, AU-7, AU-12

## CIS Controls

| Controls Version | Control                     | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs      |      |      |      |
| v7               | 6.2 Activate audit logging  |      |      |      |
| v7               | 6.3 Enable Detailed Logging |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1070, T1070.002            | TA0005  | M1047       |
