---
name: cis-ubuntu1604-v200-5-3-9
description: "Ensure SSH IgnoreRhosts is enabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.9"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.9

## Description

The `IgnoreRhosts` parameter specifies that `.rhosts` and `.shosts` files will not be used in `RhostsRSAAuthentication` or `HostbasedAuthentication`.

## Rationale

Setting this parameter forces users to enter a password when authenticating with ssh.

## Audit Procedure

### Command Line

Run the following command and verify that output matches:

```bash
sshd -T -C user=root -C host="$(hostname)" -C addr="$(grep $(hostname) /etc/hosts | awk '{print $1}')" | grep ignorerhosts
```

### Expected Result

```
ignorerhosts yes
```

Run the following command and verify the output:

```bash
grep -Ei '^\s*ignorerhosts\s+no\b' /etc/ssh/sshd_config
```

Nothing should be returned.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
IgnoreRhosts yes
```

## Default Value

IgnoreRhosts yes

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
