---
name: "CIS Ubuntu 14.04 LTS - 5.2.13 Ensure SSH LoginGraceTime is set to one minute or less"
description: "Verify SSH LoginGraceTime is set to 60 seconds or less to limit unauthenticated connections"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - ssh
cis_id: "5.2.13"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.2.13 Ensure SSH LoginGraceTime is set to one minute or less (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `LoginGraceTime` parameter specifies the time allowed for successful authentication to the SSH server. The longer the Grace period is the more open unauthenticated connections can exist. Like other session controls in this session the Grace Period should be limited to appropriate organizational limits to ensure the service is available for needed access.

## Rationale

Setting the `LoginGraceTime` parameter to a low number will minimize the risk of successful brute force attacks to the SSH server. It will also limit the number of concurrent unauthenticated connections. While the recommended setting is 60 seconds (1 Minute), set the number based on site policy.

## Audit Procedure

Run the following command and verify that output `LoginGraceTime` is between 1 and 60:

```bash
grep "^LoginGraceTime" /etc/ssh/sshd_config
```

## Expected Result

```
LoginGraceTime 60
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
LoginGraceTime 60
```

## Default Value

LoginGraceTime 120

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
