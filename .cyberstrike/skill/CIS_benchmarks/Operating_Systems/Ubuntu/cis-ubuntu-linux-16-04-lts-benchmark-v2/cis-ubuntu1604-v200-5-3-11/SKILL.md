---
name: cis-ubuntu1604-v200-5-3-11
description: "Ensure SSH root login is disabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.11"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.11

## Description

The `PermitRootLogin` parameter specifies if the root user can log in using ssh. The default is no.

## Rationale

Disallowing root logins over SSH requires system admins to authenticate using their own individual account, then escalating to root via `sudo`. This in turn limits opportunity for non-repudiation and provides a clear audit trail in the event of a security incident.

## Audit Procedure

### Command Line

Run the following command and verify that output matches:

```bash
sshd -T -C user=root -C host="$(hostname)" -C addr="$(grep $(hostname) /etc/hosts | awk '{print $1}')" | grep permitrootlogin
```

### Expected Result

```
permitrootlogin no
```

Run the following command and verify the output:

```bash
grep -Ei '^\s*PermitRootLogin\s+yes' /etc/ssh/sshd_config
```

Nothing should be returned.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
PermitRootLogin no
```

## Default Value

PermitRootLogin without-password

## References

1. SSHD_CONFIG(5)

## CIS Controls

Version 7

4.3 Ensure the Use of Dedicated Administrative Accounts - Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
