---
name: cis-ubuntu1804-v220-5-2-3-20
description: Ensure the audit configuration is immutable
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# CIS Ubuntu 18.04 - Ensure the audit configuration is immutable (5.2.3.20)

## Metadata

- **ID**: cis-ubuntu1804-v220-5-2-3-20
- **Title**: Ensure the audit configuration is immutable
- **CIS Control**: 5.2.3.20
- **Profile Applicability**: Level 2 - Server, Level 2 - Workstation
- **Benchmark**: CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0
- **Category**: cis-logging
- **Tags**: cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Severity**: medium
- **Version**: 2.2.0

## Description

Set system audit so that audit rules cannot be modified with `auditctl`. Setting the flag `-e 2` forces audit to be put in immutable mode. Audit changes can only be made on system reboot.

## Rationale

In immutable mode, unauthorized users cannot execute changes to the audit system to potentially hide malicious activity and then put the audit rules back. Users would most likely notice a system reboot and that could alert administrators of an attempt to make unauthorized audit changes.

## Impact

Once this setting is enabled, the audit daemon is locked in enabled mode and cannot be disabled until the system is rebooted. Also, audit rules cannot be changed until the system is rebooted. This creates difficulty in troubleshooting audit-related issues, as the administrator will need to reboot the system to make any changes to the audit configuration.

## Audit

### Check Immutable Flag

```bash
grep -Ph -- '^\h*-e\h+2\b' /etc/audit/rules.d/*.rules | tail -1
```

**Expected Output**:

```
-e 2
```

### Verify Loaded Configuration

```bash
auditctl -l | grep -P -- '^-e\h+2\b'
```

**Expected Output**:

```
-e 2
```

## Remediation

### Set Audit Configuration to Immutable

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules`.

Add the following line to the end of the file:

```bash
-e 2
```

Example:

```bash
printf -- "-e 2\n" >> /etc/audit/rules.d/99-finalize.rules
```

### Load Audit Rules

Merge and load the rules into active configuration:

```bash
augenrules --load
```

**Note**: This setting will NOT be loaded into the running configuration until the system is rebooted. To verify the setting is configured properly, run the audit check after a system reboot.

## References

- NIST SP 800-53 Rev. 5: AU-9

## CIS Controls

- **v8**: 8.5 Collect Detailed Audit Logs
- **v7**: 6.2 Activate audit logging, 6.3 Enable Detailed Logging

## MITRE ATT&CK Mappings

- **Techniques**: T1562, T1562.006
- **Tactics**: TA0005
- **Mitigations**: M1022

## Additional Information

### Potential Reboot Required

Setting the audit configuration to immutable mode requires a system reboot to take effect. Once enabled, audit rules cannot be modified until the next system reboot. This is by design to prevent unauthorized modification of audit rules.

### System Call Structure

For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.

### Troubleshooting

If you need to make changes to audit rules after setting immutable mode, you will need to:

1. Reboot the system
2. Make your changes before the `-e 2` rule is loaded
3. Ensure the `-e 2` rule is the last rule in your configuration files
