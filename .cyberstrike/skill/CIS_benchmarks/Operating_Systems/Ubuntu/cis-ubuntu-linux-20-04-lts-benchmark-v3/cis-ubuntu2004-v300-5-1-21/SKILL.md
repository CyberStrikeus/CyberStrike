---
name: cis-ubuntu2004-v300-5-1-21
description: "Ensure sshd PermitUserEnvironment is disabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.21"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sshd PermitUserEnvironment is disabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PermitUserEnvironment` option allows users to present environment options to the SSH daemon.

## Rationale

Permitting users the ability to set environment variables through the SSH daemon could potentially allow users to bypass security controls (e.g. setting an execution path that has SSH executing trojan'd programs)

## Audit Procedure

### Command Line

Run the following command to verify `PermitUserEnvironment` is set to `no`:

```bash
# sshd -T | grep permituserenvironment
```

```
permituserenvironment no
```

## Expected Result

```
permituserenvironment no
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the `PermitUserEnvironment` parameter to `no` above any `Include` entries as follows:

```
PermitUserEnvironment no
```

Note: First occurrence of an option takes precedence. If Include locations are enabled, used, and order of precedence is understood in your environment, the entry may be created in a file in Include location.

## Default Value

PermitUserEnvironment no

## References

1. SSHD_CONFIG(5)
2. NIST SP 800-53 Rev. 5: CM-1,CM-2, CM-6, CM-7, IA-5
3. SSHD(8)

## CIS Controls

v8 - 0.0 Explicitly Not Mapped

v7 - 0.0 Explicitly Not Mapped

MITRE ATT&CK Mappings: T1021 | TA0008 | M1042
