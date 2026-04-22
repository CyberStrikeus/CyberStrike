---
name: cis-ubuntu1804-v220-4-2-18
description: "Ensure sshd PermitEmptyPasswords is disabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.18"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.18

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PermitEmptyPasswords` parameter specifies if the SSH server allows login to accounts with empty password strings.

## Rationale

Disallowing remote shell access to accounts that have an empty password reduces the probability of unauthorized access to the system.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i permitemptypasswords
```

### Expected Result

```
permitemptypasswords no
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
PermitEmptyPasswords no
```

## Default Value

PermitEmptyPasswords no

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software.

v7 - 9.2 Ensure Only Approved Ports, Protocols, and Services Are Running.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
