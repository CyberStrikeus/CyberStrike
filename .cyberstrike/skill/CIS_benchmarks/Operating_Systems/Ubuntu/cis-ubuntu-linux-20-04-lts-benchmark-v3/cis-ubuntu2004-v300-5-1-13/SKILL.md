---
name: cis-ubuntu2004-v300-5-1-13
description: "Ensure sshd LoginGraceTime is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.13"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sshd LoginGraceTime is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `LoginGraceTime` parameter specifies the time allowed for successful authentication to the SSH server. The longer the Grace period is the more open unauthenticated connections can exist. Like other session controls in this session the Grace Period should be limited to appropriate organizational limits to ensure the service is available for needed access.

## Rationale

Setting the `LoginGraceTime` parameter to a low number will minimize the risk of successful brute force attacks to the SSH server. It will also limit the number of concurrent unauthenticated connections While the recommended setting is 60 seconds (1 Minute), set the number based on site policy.

## Audit Procedure

### Command Line

Run the following command and verify that output `LoginGraceTime` is between `1` and `60` seconds:

```bash
# sshd -T | grep logingracetime
```

```
logingracetime 60
```

## Expected Result

```
logingracetime 60
```

(or a value between 1 and 60)

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the `LoginGraceTime` parameter to `60` seconds or less above any `Include` entry as follows:

```
LoginGraceTime 60
```

Note: First occurrence of a option takes precedence. If Include locations are enabled, used, and order of precedence is understood in your environment, the entry may be created in a file in Include location.

## Default Value

LoginGraceTime 120

## References

1. SSHD_CONFIG(5)
2. NIST SP 800-53 Rev. 5: CM-6
3. SSHD(8)

## CIS Controls

v8 - 0.0 Explicitly Not Mapped

v7 - 0.0 Explicitly Not Mapped

MITRE ATT&CK Mappings: T1110, T1110.001, T1110.003, T1110.004 | TA0006 | M1036
