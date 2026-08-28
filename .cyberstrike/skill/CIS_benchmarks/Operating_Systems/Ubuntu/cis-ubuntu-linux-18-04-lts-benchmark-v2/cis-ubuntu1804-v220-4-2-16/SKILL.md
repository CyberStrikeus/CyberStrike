---
name: cis-ubuntu1804-v220-4-2-16
description: "Ensure sshd MaxSessions is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.16"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.16

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `MaxSessions` parameter specifies the maximum number of open sessions permitted from a given connection.

## Rationale

To protect a system from denial of service due to a large number of concurrent sessions, use the rate limiting function of `MaxSessions` to protect availability of sshd logins and prevent overwhelming the daemon.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i maxsessions
```

### Expected Result

```
maxsessions 10
```

Value should be 10 or less.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
MaxSessions 10
```

## Default Value

MaxSessions 10

## References

1. NIST SP 800-53 Rev. 5: CM-6

## CIS Controls

None

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
