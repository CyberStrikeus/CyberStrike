---
name: cis-ubuntu1804-v220-4-2-20
description: "Ensure sshd PermitUserEnvironment is disabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.20"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.20

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PermitUserEnvironment` option allows users to present environment options to the SSH daemon.

## Rationale

Permitting users the ability to set environment variables through the SSH daemon could potentially allow users to bypass security controls (e.g. setting an execution path that has SSH executing trojan'd programs).

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i permituserenvironment
```

### Expected Result

```
permituserenvironment no
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
PermitUserEnvironment no
```

## Default Value

PermitUserEnvironment no

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
