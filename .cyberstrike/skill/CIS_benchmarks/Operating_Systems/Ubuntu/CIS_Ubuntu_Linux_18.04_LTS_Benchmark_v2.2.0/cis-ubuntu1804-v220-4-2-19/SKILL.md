---
name: cis-ubuntu1804-v220-4-2-19
description: "Ensure sshd PermitRootLogin is disabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.19"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.19

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PermitRootLogin` parameter specifies if the root user can log in using SSH. The default is `prohibit-password`.

## Rationale

Disallowing root logins over SSH requires system admins to authenticate using their own individual account, then escalating to root via sudo or su. This in turn limits opportunity for non-repudiation and provides a clear audit trail in the event of a security incident.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i permitrootlogin
```

### Expected Result

```
permitrootlogin no
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
PermitRootLogin no
```

## Default Value

PermitRootLogin prohibit-password

## References

1. NIST SP 800-53 Rev. 5: AC-6(2)

## CIS Controls

v8 - 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets.

v7 - 4.3 Ensure the Use of Dedicated Administrative Accounts.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
