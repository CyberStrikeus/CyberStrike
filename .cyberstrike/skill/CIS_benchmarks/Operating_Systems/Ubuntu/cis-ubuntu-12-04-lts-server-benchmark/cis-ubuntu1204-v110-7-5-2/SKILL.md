---
name: cis-ubuntu1204-v110-7-5-2
description: "Disable SCTP"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, sctp, kernel-module, attack-surface]
cis_id: "7.5.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.5.2 Disable SCTP (Not Scored)

## Profile Applicability

- Level 1

## Description

The Stream Control Transmission Protocol (SCTP) is a transport layer protocol used to support message oriented communication, with several streams of messages in one connection. It serves a similar function as TCP and UDP, incorporating features of both. It is message-oriented like UDP, and ensures reliable in-sequence transport of messages with congestion control like TCP.

## Rationale

If the protocol is not being used, it is recommended that kernel module not be loaded, disabling the service to reduce the potential attack surface.

## Audit Procedure

### Using Command Line

Perform the following to determine if SCTP is disabled.

```bash
grep "install sctp /bin/true" /etc/modprobe.d/CIS.conf
```

## Expected Result

```
install sctp /bin/true
```

## Remediation

### Using Command Line

```bash
echo "install sctp /bin/true" >> /etc/modprobe.d/CIS.conf
```

## Default Value

SCTP kernel module is available by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
