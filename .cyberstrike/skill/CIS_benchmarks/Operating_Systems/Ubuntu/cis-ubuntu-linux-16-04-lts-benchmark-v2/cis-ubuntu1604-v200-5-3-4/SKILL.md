---
name: cis-ubuntu1604-v200-5-3-4
description: "Ensure SSH Protocol is set to 2"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.4

## Description

SSH supports two different and incompatible protocols: SSH1 and SSH2. SSH1 was the original protocol and was subject to security issues. SSH2 is more advanced and secure.

## Rationale

SSH v1 suffers from insecurities that do not affect SSH v2.

## Audit Procedure

### Command Line

Run the following command and verify that output matches:

```bash
sshd -T -C user=root -C host="$(hostname)" -C addr="$(grep $(hostname) /etc/hosts | awk '{print $1}')" | grep '^\s*protocol'
```

### Expected Result

```
protocol 2
```

Run the following command and verify the output:

```bash
grep -Ei '^\s*Protocol\s+[^2].*$' /etc/ssh/sshd_config
```

Nothing should be returned.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
Protocol 2
```

## Default Value

Protocol 2

## References

1. SSHD_CONFIG(5)

## CIS Controls

Version 7

9.2 Ensure Only Approved Ports, Protocols and Services Are Running - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
