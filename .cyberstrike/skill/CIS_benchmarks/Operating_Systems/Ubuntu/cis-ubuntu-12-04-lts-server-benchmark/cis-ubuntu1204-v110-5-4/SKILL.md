---
name: cis-ubuntu1204-v110-5-4
description: "Ensure echo is not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, echo, inetd, attack-surface]
cis_id: "5.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4 Ensure echo is not enabled (Scored)

## Profile Applicability

- Level 1

## Description

`echo` is a network service that responds to clients with the data sent to it by the client. This service is intended for debugging and testing purposes. It is recommended that this service be disabled.

## Rationale

Disabling this service will reduce the remote attack surface of the system.

## Audit Procedure

### Using Command Line

Ensure the `echo` services are not enabled:

```bash
grep ^echo /etc/inetd.conf
```

## Expected Result

No results should be returned.

## Remediation

### Using Command Line

Remove or comment out any `echo` lines in `/etc/inetd.conf`:

```bash
sed -i 's/^echo/#echo/' /etc/inetd.conf
```

## Default Value

Not enabled by default on Ubuntu 12.04 LTS Server.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
