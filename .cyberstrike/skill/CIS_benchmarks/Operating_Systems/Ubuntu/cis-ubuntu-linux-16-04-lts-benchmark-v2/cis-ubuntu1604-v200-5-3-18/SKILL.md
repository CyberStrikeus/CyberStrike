---
name: cis-ubuntu1604-v200-5-3-18
description: "Ensure SSH LoginGraceTime is set to one minute or less"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.18"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.18

## Description

The `LoginGraceTime` parameter specifies the time allowed for successful authentication to the SSH server. The longer the Grace period is the more open unauthenticated connections can exist. Like other session controls in this session the Grace Period should be limited to appropriate organizational limits to ensure the service is available for needed access.

## Rationale

Setting the `LoginGraceTime` parameter to a low number will minimize the risk of successful brute force attacks to the SSH server. It will also limit the number of concurrent unauthenticated connections. While the recommended setting is 60 seconds (1 Minute), set the number based on site policy.

## Audit Procedure

### Command Line

Run the following command and verify that output `LoginGraceTime` is between `1` and `60` seconds or `1m`:

```bash
sshd -T -C user=root -C host="$(hostname)" -C addr="$(grep $(hostname) /etc/hosts | awk '{print $1}')" | grep logingracetime
```

### Expected Result

```
logingracetime 60
```

Run the following command and verify the output:

```bash
grep -Ei '^\s*LoginGraceTime\s+(0|6[1-9]|[7-9][0-9]|[1-9][0-9][0-9]+|[^1]m)' /etc/ssh/sshd_config
```

Nothing should be returned.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
LoginGraceTime 60
```

## Default Value

LoginGraceTime 2m

## References

1. SSHD_CONFIG(5)

## CIS Controls

Version 7

5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
