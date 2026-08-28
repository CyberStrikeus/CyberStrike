---
name: cis-ubuntu1604-v200-5-3-10
description: "Ensure SSH HostbasedAuthentication is disabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.10"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.10

## Description

The `HostbasedAuthentication` parameter specifies if authentication is allowed through trusted hosts via the user of `.rhosts`, or `/etc/hosts.equiv`, along with successful public key client host authentication. This option only applies to SSH Protocol Version 2.

## Rationale

Even though the `.rhosts` files are ineffective if support is disabled in `/etc/pam.conf`, disabling the ability to use `.rhosts` files in SSH provides an additional layer of protection.

## Audit Procedure

### Command Line

Run the following command and verify that output matches:

```bash
sshd -T -C user=root -C host="$(hostname)" -C addr="$(grep $(hostname) /etc/hosts | awk '{print $1}')" | grep hostbasedauthentication
```

### Expected Result

```
hostbasedauthentication no
```

Run the following command and verify the output matches:

```bash
grep -Ei '^\s*HostbasedAuthentication\s+yes' /etc/ssh/sshd_config
```

Nothing should be returned.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
HostbasedAuthentication no
```

## Default Value

HostbasedAuthentication no

## References

1. SSHD_CONFIG(5)

## CIS Controls

Version 7

16.3 Require Multi-factor Authentication - Require multi-factor authentication for all user accounts, on all systems, whether managed onsite or by a third-party provider.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
