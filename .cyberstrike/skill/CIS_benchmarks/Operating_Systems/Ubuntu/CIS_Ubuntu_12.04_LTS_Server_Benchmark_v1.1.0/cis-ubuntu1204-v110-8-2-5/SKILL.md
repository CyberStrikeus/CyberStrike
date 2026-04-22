---
name: cis-ubuntu1204-v110-8-2-5
description: "Configure rsyslog to Send Logs to a Remote Log Host"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, rsyslog, remote-logging, centralized-logging]
cis_id: "8.2.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.2.5 Configure rsyslog to Send Logs to a Remote Log Host (Scored)

## Profile Applicability
- Level 1

## Description
The `rsyslog` utility supports the ability to send logs it gathers to a remote log host running `syslogd(8)` or to receive messages from remote hosts, reducing administrative overhead.

## Rationale
Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

## Audit Procedure
### Using Command Line
Review the `/etc/rsyslog.conf` file and verify that logs are sent to a central host (where `loghost.example.com` is the name of your central log host):
```bash
grep "^\*\.\*[^I][^I]*@" /etc/rsyslog.conf
```

## Expected Result
```
*.* @@loghost.example.com
```

## Remediation
### Using Command Line
Edit the `/etc/rsyslog.conf` file and add the following line (where `loghost.example.com` is the name of your central log host):
```bash
*.* @@loghost.example.com
```

Execute the following command to restart rsyslogd:
```bash
pkill -HUP rsyslogd
```

**Note:** The double "at" sign (`@@`) directs `rsyslog` to use TCP to send log messages to the server, which is a more reliable transport mechanism than the default UDP protocol.

## Default Value
By default, rsyslog does not send logs to a remote host.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- See the rsyslog.conf(5) man page for more information.

## Profile
Level 1 - Scored
