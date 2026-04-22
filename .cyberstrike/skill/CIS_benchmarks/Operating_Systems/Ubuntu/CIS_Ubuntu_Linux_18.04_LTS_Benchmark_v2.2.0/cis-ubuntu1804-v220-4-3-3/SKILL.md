---
name: cis-ubuntu1804-v220-4-3-3
description: "Ensure sudo log file exists"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, sudo, privilege-escalation]
cis_id: "4.3.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.3.3

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` can use a custom log file.

## Rationale

A sudo log file simplifies auditing of sudo commands.

## Audit Procedure

### Command Line

Run the following command to verify that `sudo` has a custom log file configured:

```bash
grep -rPsi '^\h*Defaults\h+([^#]+,\h*)?logfile\h*=\h*(")?[\/\w]+(")?' /etc/sudoers /etc/sudoers.d/
```

### Expected Result

```
Defaults logfile="/var/log/sudo.log"
```

## Remediation

### Command Line

Edit the file `/etc/sudoers` or a file in `/etc/sudoers.d/` with `visudo` and add the following line:

```bash
Defaults logfile="/var/log/sudo.log"
```

## References

1. NIST SP 800-53 Rev. 5: AU-3, AU-12

## CIS Controls

v8 - 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data.

v7 - 6.3 Enable Detailed Logging.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
