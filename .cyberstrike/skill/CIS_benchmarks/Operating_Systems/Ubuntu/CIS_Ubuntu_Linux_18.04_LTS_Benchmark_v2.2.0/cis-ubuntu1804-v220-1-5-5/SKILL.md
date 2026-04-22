---
name: cis-ubuntu1804-v220-1-5-5
description: "Ensure Automatic Error Reporting is not enabled"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, apport, error-reporting, process-hardening]
cis_id: "1.5.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.5 Ensure Automatic Error Reporting is not enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The Apport Error Reporting Service automatically generates crash reports for debugging.

## Rationale

Apport collects potentially sensitive data, such as core dumps, stack traces, and log files. They can contain passwords, credit card numbers, serial numbers, and other private material.

## Audit Procedure

### Command Line

Run the following command to verify that the Apport Error Reporting Service is not enabled:

```bash
dpkg-query -s apport > /dev/null 2>&1 && grep -Psi -- '^\h*enabled\h*=\h*[^0]\b' /etc/default/apport
```

Nothing should be returned.

Run the following command to verify that the apport service is not active:

```bash
systemctl is-active apport.service | grep '^active'
```

## Expected Result

Nothing should be returned for both commands.

## Remediation

### Command Line

Edit `/etc/default/apport` and add or edit the enabled parameter to equal `0`:

```
enabled=0
```

Run the following commands to stop and disable the apport service:

```bash
systemctl stop apport.service
systemctl --now disable apport.service
```

-- OR --

Run the following command to remove the apport package:

```bash
apt purge apport
```

## Default Value

enabled=1

## References

1. NIST SP 800-53 Rev. 5: CM-6

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | X    | X    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1005, T1005.000            | TA0007  | M1057       |
