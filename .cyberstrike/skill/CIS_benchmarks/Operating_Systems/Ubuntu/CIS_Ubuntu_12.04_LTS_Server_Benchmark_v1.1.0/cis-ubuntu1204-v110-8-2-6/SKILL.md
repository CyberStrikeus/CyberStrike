---
name: cis-ubuntu1204-v110-8-2-6
description: "Accept Remote rsyslog Messages Only on Designated Log Hosts"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, rsyslog, remote-logging, log-host, tcp]
cis_id: "8.2.6"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.2.6 Accept Remote rsyslog Messages Only on Designated Log Hosts (Not Scored)

## Profile Applicability

- Level 1

## Description

By default, `rsyslog` does not listen for log messages coming in from remote systems. The `ModLoad` tells `rsyslog` to load the `imtcp.so` module so it can listen over a network via TCP. The `InputTCPServerRun` option instructs `rsyslogd` to listen on the specified TCP port.

## Rationale

The guidance in the section ensures that remote log hosts are configured to only accept `rsyslog` data from hosts within the specified domain and that those systems that are not designed to be log hosts do not accept any remote `rsyslog` messages. This provides protection from spoofed log data and ensures that system administrators are reviewing reasonably complete syslog data in a central location.

## Audit Procedure

### Using Command Line

```bash
grep '$ModLoad imtcp.so' /etc/rsyslog.conf
grep '$InputTCPServerRun' /etc/rsyslog.conf
```

## Expected Result

```
$ModLoad imtcp.so
$InputTCPServerRun 514
```

## Remediation

### Using Command Line

For hosts that are designated as log hosts, edit the `/etc/rsyslog.conf` file and uncomment the following lines:

```bash
$ModLoad imtcp.so
$InputTCPServerRun 514
```

Execute the following command to restart `rsyslogd`:

```bash
pkill -HUP rsyslogd
```

## Default Value

By default, rsyslog does not accept remote messages.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- See the rsyslog(8) man page for more information.

## Profile

Level 1 - Not Scored
