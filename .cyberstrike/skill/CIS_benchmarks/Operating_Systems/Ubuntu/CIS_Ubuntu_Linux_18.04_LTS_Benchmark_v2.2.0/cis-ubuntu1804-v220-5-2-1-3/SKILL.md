---
skill_id: cis-ubuntu1804-v220-5-2-1-3
name: cis-ubuntu1804-v220-5-2-1-3
description: "Configure grub2 to enable auditing for processes that start prior to auditd daemon startup"
version: "2.2.0"
category: cis-logging
tags:
  - cis
  - ubuntu
  - linux
  - ubuntu-18.04
  - auditing
  - auditd
profile_applicability:
  - "Level 2 - Server"
  - "Level 2 - Workstation"
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## Control 5.2.1.3 - Ensure auditing for processes that start prior to auditd is enabled (Automated)

### Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

### Description
Configure grub2 so that processes that are capable of being audited can be audited even if they start up prior to auditd startup.

### Rationale
Audit events need to be captured on processes that start up prior to auditd, so that potential malicious activity cannot go undetected.

### Audit

Run the following command:

```bash
find /boot -type f -name 'grub.cfg' -exec grep -Ph -- '^\h*linux\b' {} + | grep -v 'audit=1'
```

**Expected Output:**
Nothing should be returned.

### Remediation

Edit `/etc/default/grub` and add `audit=1` to `GRUB_CMDLINE_LINUX`:

**Example:**
```
GRUB_CMDLINE_LINUX="audit=1"
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

### References
- NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12

### Additional Information
This recommendation is designed around the grub2 bootloader, if another bootloader is in use in your environment enact equivalent settings.

### CIS Controls
- v8 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.
- v7 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.

### MITRE ATT&CK Mappings
- Techniques: T1562, T1562.001
- Tactics: TA0005 (Defense Evasion)
- Mitigations: M1047 (Audit)

### Benchmark
CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

### Automation Status
Automated
