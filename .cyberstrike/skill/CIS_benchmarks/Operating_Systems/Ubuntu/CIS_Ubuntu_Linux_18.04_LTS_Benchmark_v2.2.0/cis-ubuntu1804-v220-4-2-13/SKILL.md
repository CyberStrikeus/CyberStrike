---
name: cis-ubuntu1804-v220-4-2-13
description: "Ensure sshd LogLevel is configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.13"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.13

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

SSH provides several logging levels with varying amounts of verbosity. `DEBUG` is specifically not recommended other than strictly for debugging SSH communications since it provides so much data that it is difficult to identify important security information.

## Rationale

SSH `LogLevel` should be set to `VERBOSE` or `INFO` level. This ensures login and logout activity, as well as key fingerprints, are logged. The `INFO` level outputs only minimal information, while `VERBOSE` provides additional SSH key information.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i loglevel
```

### Expected Result

```
loglevel VERBOSE
```

OR

```
loglevel INFO
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
LogLevel VERBOSE
```

## Default Value

LogLevel INFO

## References

1. NIST SP 800-53 Rev. 5: AU-3, AU-12

## CIS Controls

v8 - 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data.

v7 - 6.2 Activate Audit Logging - Ensure that local logging has been enabled on all systems and networking devices.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
