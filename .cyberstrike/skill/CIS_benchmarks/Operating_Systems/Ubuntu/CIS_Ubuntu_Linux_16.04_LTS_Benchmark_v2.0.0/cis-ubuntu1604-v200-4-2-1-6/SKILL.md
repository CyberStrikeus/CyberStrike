---
name: cis-ubuntu1604-v200-4-2-1-6
description: "Ensure remote rsyslog messages are only accepted on designated log hosts"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.1.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.1.6

## Profile
- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

By default, `rsyslog` does not listen for log messages coming in from remote systems. The `ModLoad` tells `rsyslog` to load the `imtcp.so` module so it can listen over a network via TCP. The `InputTCPServerRun` option instructs `rsyslogd` to listen on the specified TCP port.

## Rationale

The guidance in the section ensures that remote log hosts are configured to only accept `rsyslog` data from hosts within the specified domain and that those systems that are not designed to be log hosts do not accept any remote `rsyslog` messages. This provides protection from spoofed log data and ensures that system administrators are reviewing reasonably complete syslog data in a central location.

**Note:** The `$ModLoad imtcp` line can have the `.so` extension added to the end of the module, or use the full path to the module.

## Impact

None.

## Audit Procedure

Run the following commands and verify the resulting lines are:
- Not commented on designated log hosts
- Commented or not present on all others

### Command Line

Run the following command and verify the output for `$ModLoad imtcp`:

```bash
grep '$ModLoad imtcp' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

Output for designated log hosts:

```
$ModLoad imtcp
```

Output for systems that are not log hosts: *(No output is also acceptable)*

```
# $ModLoad imtcp
```

Run the following command and verify the output for `$InputTCPServerRun`:

```bash
grep '$InputTCPServerRun' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

Output for designated log hosts:

```
$InputTCPServerRun 514
```

Output for systems that are not log hosts: *(No output is also acceptable)*

```
# $InputTCPServerRun 514
```

## Expected Result

On designated log hosts, `$ModLoad imtcp` and `$InputTCPServerRun 514` should be uncommented. On all other systems, these lines should be commented out or not present.

## Remediation

For hosts that are designated as log hosts, edit the `/etc/rsyslog.conf` file and un-comment or add the following lines:

### Command Line

```bash
# Add or uncomment in /etc/rsyslog.conf for designated log hosts:
$ModLoad imtcp
$InputTCPServerRun 514
```

For hosts that are not designated as log hosts, edit the `/etc/rsyslog.conf` file and comment or remove the following lines:

```bash
# Comment out in /etc/rsyslog.conf for non-log hosts:
# $ModLoad imtcp
# $InputTCPServerRun 514
```

Run the following command to reload the `rsyslogd` configuration:

```bash
systemctl restart rsyslog
```

## Default Value

rsyslog does not accept remote messages by default.

## References

1. See the rsyslog(8) man page for more information.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v7 | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running<br/>Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system. | | | |
