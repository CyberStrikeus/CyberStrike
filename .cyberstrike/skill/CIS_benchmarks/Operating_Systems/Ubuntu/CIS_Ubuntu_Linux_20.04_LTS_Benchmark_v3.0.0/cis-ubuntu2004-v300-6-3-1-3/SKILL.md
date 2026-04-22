---
name: cis-ubuntu2004-v300-6-3-1-3
description: "Ensure auditing for processes that start prior to auditd is enabled"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.1.3 Ensure auditing for processes that start prior to auditd is enabled (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

Configure `grub2` so that processes that are capable of being audited can be audited even if they start up prior to `auditd` startup.

## Rationale

Audit events need to be captured on processes that start up prior to `auditd`, so that potential malicious activity cannot go undetected.

## Audit Procedure

### Command Line

Run the following command:

```bash
# find /boot -type f -name 'grub.cfg' -exec grep -Ph -- '^\h*linux' {} + | grep -v 'audit=1'
```

Nothing should be returned.

## Expected Result

No output should be returned, confirming that `audit=1` is set on all kernel lines.

## Remediation

### Command Line

Edit `/etc/default/grub` and add `audit=1` to `GRUB_CMDLINE_LINUX`:

Example:

```
GRUB_CMDLINE_LINUX="audit=1"
```

Run the following command to update the `grub2` configuration:

```bash
# update-grub
```

## Default Value

Not set by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12
2. STIG ID: UBTU-20-010198 | RULE ID: SV-238299r991555 | CAT II
3. STIG ID: UBTU-22-212015 | RULE ID: SV-260471r991555 | CAT II

Additional Information: This recommendation is designed around the grub2 bootloader, if another bootloader is in use in your environment enact equivalent settings.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | X | X | X |
| v7 | 6.2 Activate audit logging | X | X | X |

MITRE ATT&CK Mappings: T1562, T1562.001 / TA0005 / M1047
