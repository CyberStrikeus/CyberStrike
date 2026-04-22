---
name: cis-ubuntu1804-v220-5-2-3-21
description: Ensure the running and on disk configuration is the same
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# CIS Ubuntu 18.04 - Ensure the running and on disk configuration is the same (5.2.3.21)

## Metadata
- **ID**: cis-ubuntu1804-v220-5-2-3-21
- **Title**: Ensure the running and on disk configuration is the same
- **CIS Control**: 5.2.3.21
- **Profile Applicability**: Level 2 - Server, Level 2 - Workstation
- **Benchmark**: CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0
- **Category**: cis-logging
- **Tags**: cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Severity**: medium
- **Version**: 2.2.0

## Description
Verify that the running configuration matches what is defined in the on-disk audit configuration files.

The audit system can operate in several modes:
- **Enabled (1)**: Audit rules can be loaded and changed
- **Immutable (2)**: Audit rules cannot be changed until reboot

It is important to verify that the running audit configuration matches the on-disk configuration to ensure that all required audit rules are actively monitoring system events.

## Rationale
If the running audit configuration differs from the on-disk configuration, critical audit rules may not be active, leading to gaps in security monitoring and compliance violations. This could allow unauthorized activities to go undetected.

## Impact
None. This is a verification check to ensure consistency between running and on-disk configurations.

## Audit

### Compare Running vs On-Disk Configuration
```bash
# Check if audit is enabled
auditctl -s | grep enabled

# Check running rule count
auditctl -l | wc -l

# Check on-disk rule count (excluding comments and blank lines)
cat /etc/audit/rules.d/*.rules | grep -v '^#' | grep -v '^$' | wc -l

# Detailed comparison (optional)
diff <(auditctl -l | sort) <(cat /etc/audit/rules.d/*.rules | augenrules --check | sort)
```

**Expected Behavior**:
- Audit should be enabled (`enabled 1` or `enabled 2`)
- Running rule count should match or be close to on-disk rule count
- No significant differences between running and on-disk rules

### Check if Reboot is Required
```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then
    printf "Audit is in immutable mode - reboot required to load new rules\n"
fi
```

## Remediation

### Load On-Disk Configuration into Running Configuration

If the running configuration differs from the on-disk configuration, load the rules:

```bash
# Merge and load all rules from /etc/audit/rules.d/
augenrules --load
```

### Verify Rules Were Loaded
```bash
auditctl -l
```

### If Audit is in Immutable Mode
If audit is configured in immutable mode (`-e 2`), you **must** reboot the system to apply any changes:

```bash
# Check if immutable mode is enabled
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then
    printf "Reboot required to load rules\n"
    # Schedule reboot (optional)
    # shutdown -r +5 "Rebooting to apply audit configuration changes"
fi
```

### Best Practices
1. Always verify running configuration after making changes to audit rules
2. Test audit rules in enabled mode (`-e 1`) before setting to immutable mode (`-e 2`)
3. Document all changes to audit configuration
4. Maintain version control of audit rule files

## References
- NIST SP 800-53 Rev. 5: AU-9, CM-6

## CIS Controls
- **v8**: 8.5 Collect Detailed Audit Logs
- **v7**: 6.2 Activate audit logging, 6.3 Enable Detailed Logging

## MITRE ATT&CK Mappings
- **Techniques**: T1562, T1562.006
- **Tactics**: TA0005
- **Mitigations**: M1022

## Additional Information

### Potential Reboot Required
If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

### Common Discrepancies
Running and on-disk configurations may differ due to:
1. Manual changes made with `auditctl` (not persisted to disk)
2. Changes made to `/etc/audit/rules.d/*.rules` files without running `augenrules --load`
3. System in immutable mode preventing rule updates
4. Service restart issues

### Troubleshooting
If rules fail to load:
1. Check audit daemon status: `systemctl status auditd`
2. Review audit logs: `journalctl -u auditd`
3. Validate rule syntax: `augenrules --check`
4. Ensure no conflicting rules exist
5. Verify sufficient permissions to modify audit configuration
