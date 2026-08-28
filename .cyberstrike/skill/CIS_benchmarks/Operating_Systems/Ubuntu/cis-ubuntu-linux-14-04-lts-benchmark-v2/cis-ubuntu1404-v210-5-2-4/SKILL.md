---
name: "CIS Ubuntu 14.04 LTS - 5.2.4 Ensure SSH X11 forwarding is disabled"
description: "Verify SSH X11 forwarding is disabled to prevent remote graphic connection tunneling"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - ssh
cis_id: "5.2.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.2.4 Ensure SSH X11 forwarding is disabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The X11Forwarding parameter provides the ability to tunnel X11 traffic through the connection to enable remote graphic connections.

## Rationale

Disable X11 forwarding unless there is an operational requirement to use X11 applications directly. There is a small risk that the remote X11 servers of users who are logged in via SSH with X11 forwarding could be compromised by other users on the X11 server. Note that even if X11 forwarding is disabled, users can always install their own forwarders.

## Audit Procedure

Run the following command and verify that output matches:

```bash
grep "^X11Forwarding" /etc/ssh/sshd_config
```

## Expected Result

```
X11Forwarding no
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
X11Forwarding no
```

## Default Value

X11Forwarding yes

## References

- CIS Controls: 3.4 - Use Only Secure Channels For Remote System Administration

## Profile

- Level 1 - Server
- Level 1 - Workstation
