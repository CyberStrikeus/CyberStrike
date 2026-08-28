---
name: cis-ubuntu1604-v200-5-3-7
description: "Ensure SSH X11 forwarding is disabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.7"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.7

## Description

The X11Forwarding parameter provides the ability to tunnel X11 traffic through an existing SSH shell session to enable remote graphic connections.

## Rationale

Disable X11 forwarding unless there is an operational requirement to use X11 applications directly. There is a small risk that the remote X11 servers of users who are logged in via SSH with X11 forwarding could be compromised by other users on the X11 server. Note that even if X11 forwarding is disabled, users can always install their own forwarders.

## Impact

X11 programs on the server will not be able to be forwarded to a ssh-client display.

## Audit Procedure

### Command Line

Run the following command and verify that output matches:

```bash
sshd -T -C user=root -C host="$(hostname)" -C addr="$(grep $(hostname) /etc/hosts | awk '{print $1}')" | grep -i x11forwarding
```

### Expected Result

```
x11forwarding no
```

Run the following command and verify that the output matches:

```bash
grep -Ei '^\s*x11forwarding\s+yes' /etc/ssh/sshd_config
```

Nothing is returned.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
X11Forwarding no
```

## Default Value

X11Forwarding yes

## References

1. SSHD_CONFIG(5)

## CIS Controls

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile Applicability

- Level 1 - Workstation
- Level 2 - Server

## Assessment Status

Automated
