---
name: cis-ubuntu2004-v300-6-3-1-2
description: "Ensure auditd service is enabled and active"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.1.2 Ensure auditd service is enabled and active (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

Turn on the `auditd` daemon to record system events.

## Rationale

The capturing of system events provides system administrators with information to allow them to determine if unauthorized access to their system is occurring.

## Audit Procedure

### Command Line

Run the following command to verify `auditd` is enabled:

```bash
# systemctl is-enabled auditd | grep '^enabled'
enabled
```

Verify result is "enabled".

Run the following command to verify `auditd` is active:

```bash
# systemctl is-active auditd | grep '^active'
active
```

Verify result is "active".

## Expected Result

`auditd` should be enabled and active.

## Remediation

### Command Line

Run the following commands to unmask, enable and start `auditd`:

```bash
# systemctl unmask auditd
# systemctl enable auditd
# systemctl start auditd
```

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-12, SI-5
2. STIG ID: UBTU-20-010182 | RULE ID: SV-238298r958506 | CAT II
3. STIG ID: UBTU-22-653015 | RULE ID: SV-260591r1015023 | CAT II

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |
| v7 | 6.3 Enable Detailed Logging | | X | X |

MITRE ATT&CK Mappings: T1562, T1562.001 / TA0005 / M1028
