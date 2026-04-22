---
name: cis-ubuntu1804-v220-4-2-15
description: "Ensure sshd MaxAuthTries is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.15"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.15

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `MaxAuthTries` parameter specifies the maximum number of authentication attempts permitted per connection. When the login failure count reaches half the number, error messages will be written to the syslog file detailing the login failure.

## Rationale

Setting the `MaxAuthTries` parameter to a low number will minimize the risk of successful brute force attacks to the SSH server. While the recommended setting is 4, set the number based on site policy.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i maxauthtries
```

### Expected Result

```
maxauthtries 4
```

Value should be 4 or less.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
MaxAuthTries 4
```

## Default Value

MaxAuthTries 6

## References

1. NIST SP 800-53 Rev. 5: AU-3, AU-12

## CIS Controls

v8 - 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data.

v7 - 16.13 Alert on Account Login Behavior Deviation.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
