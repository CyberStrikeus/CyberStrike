---
name: cis-ubuntu1804-v220-4-2-12
description: "Ensure sshd LoginGraceTime is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.12"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.12

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `LoginGraceTime` parameter specifies the time allowed for successful authentication to the SSH server. The longer the Grace period is the more open unauthenticated connections can exist. Like other session controls in this session the Grace Period should be limited to appropriate organizational limits to ensure the service is available for needed access.

## Rationale

Setting the `LoginGraceTime` parameter to a low number will minimize the risk of successful brute force attacks to the SSH server. It will also limit the number of concurrent unauthenticated connections. While the recommended setting is 60 seconds (1 Minute), set the number based on site policy.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i logingracetime
```

### Expected Result

```
logingracetime 60
```

Value should be between 1 and 60 seconds.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
LoginGraceTime 60
```

## Default Value

LoginGraceTime 120

## References

1. NIST SP 800-53 Rev. 5: CM-6

## CIS Controls

None

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
