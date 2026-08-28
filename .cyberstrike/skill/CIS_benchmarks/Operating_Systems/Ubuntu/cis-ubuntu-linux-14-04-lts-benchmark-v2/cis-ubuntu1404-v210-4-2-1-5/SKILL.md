---
name: "CIS Ubuntu 14.04 LTS - 4.2.1.5 Ensure remote rsyslog messages are only accepted on designated log hosts"
description: "Configure rsyslog to accept remote messages only on designated log hosts"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - rsyslog
  - remote-logging
  - logging
cis_id: "4.2.1.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.2.1.5 Ensure remote rsyslog messages are only accepted on designated log hosts (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

By default, `rsyslog` does not listen for log messages coming in from remote systems. The `ModLoad` tells `rsyslog` to load the `imtcp.so` module so it can listen over a network via TCP. The `InputTCPServerRun` option instructs `rsyslogd` to listen on the specified TCP port.

## Rationale

The guidance in the section ensures that remote log hosts are configured to only accept `rsyslog` data from hosts within the specified domain and that those systems that are not designed to be log hosts do not accept any remote `rsyslog` messages. This provides protection from spoofed log data and ensures that system administrators are reviewing reasonably complete syslog data in a central location.

## Audit Procedure

Run the following commands and verify the resulting lines are uncommented on designated log hosts and commented or removed on all others:

```bash
grep '$ModLoad imtcp' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
grep '$InputTCPServerRun' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

## Expected Result

On designated log hosts:

```
$ModLoad imtcp
$InputTCPServerRun 514
```

On non-log hosts, these lines should be commented out or absent.

## Remediation

For hosts that are designated as log hosts, edit the `/etc/rsyslog.conf` file and un-comment or add the following lines:

```bash
$ModLoad imtcp
$InputTCPServerRun 514
```

For hosts that are not designated as log hosts, edit the `/etc/rsyslog.conf` file and comment or remove the following lines:

```bash
# $ModLoad imtcp
# $InputTCPServerRun 514
```

Run the following command to reload the `rsyslogd` configuration:

```bash
pkill -HUP rsyslogd
```

**Notes:** The `$MoadLoad imtcp` line can have the `.so` extension added to the end of the module, or use the full path to the module.

## Default Value

rsyslog does not listen for remote messages by default.

## References

1. See the rsyslog(8) man page for more information.

## Profile

- Level 1 - Server
- Level 1 - Workstation
