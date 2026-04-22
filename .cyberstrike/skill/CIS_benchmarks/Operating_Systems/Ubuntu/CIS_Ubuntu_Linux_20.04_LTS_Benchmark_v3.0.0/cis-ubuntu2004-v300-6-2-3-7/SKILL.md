---
name: cis-ubuntu2004-v300-6-2-3-7
description: "Ensure rsyslog is not configured to receive logs from a remote client"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, rsyslog]
cis_id: "6.2.3.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3.7 Ensure rsyslog is not configured to receive logs from a remote client (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

`rsyslog` supports the ability to receive messages from remote hosts, thus acting as a log server. Clients should not receive data from other hosts.

## Rationale

If a client is configured to also receive data, thus turning it into a server, the client system is acting outside its operational boundary.

## Audit Procedure

### Command Line

Unless the system's primary function is to serve as a logfile server, run the following script to review the `rsyslog` configuration and verify that the system is not configured to accept incoming logs.

advanced format:

```bash
# grep -P -- '^\h*module\(load="imtcp"\)|^\h*input\(type="imtcp" port="514"\)' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
# grep -P -- '^\h*module\(load="imudp"\)|^\h*input\(type="imudp" port="514"\)' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

No output expected.

obsolete legacy format:

```bash
# grep  -P -- '(^\$ModLoad imtcp|^\$InputTCPServerRun)' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
# grep  -P -- '(^\$ModLoad imudp|^\$UDPServerRun)' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

## Expected Result

No output expected for any of the above commands.

## Remediation

### Command Line

Unless the system's primary function is to serve as a logfile server, modify the files returned by the Audit Procedure and remove the specific lines highlighted by the audit.
Verify none of the following entries are present in the `rsyslog` configuration.

advanced format:

```
# module(load="imtcp")
# input(type="imtcp" port="514")
# module(load="imudp")
# input(type="imudp" port="514")
```

Note: `obsolete legacy` - previously known as the legacy format. This format is obsolete and should not be used when writing new configurations. It was aimed at small additions to the original `sysklogd` format and has been replaced due to its limitations.

Reload the service:

```bash
# systemctl reload-or-restart rsyslog
```

## Default Value

Not configured to receive remote logs by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-7, AU-12, CM-6
2. https://www.rsyslog.com/doc/index.html
3. https://www.rsyslog.com/doc/configuration/conf_formats.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software | | | |
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | | | |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|------------------------------|---------|-------------|
| T1070, T1070.002, T1562, T1562.006 | TA0005, TA0040 | M1029 |
