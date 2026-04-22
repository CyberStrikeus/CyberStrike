---
name: cis-ubuntu1804-v220-5-2-3-14
description: Ensure events that modify the system's Mandatory Access Controls are collected
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# CIS Ubuntu 18.04 - Ensure events that modify the system's Mandatory Access Controls are collected (5.2.3.14)

## Metadata
- **ID**: cis-ubuntu1804-v220-5-2-3-14
- **Title**: Ensure events that modify the system's Mandatory Access Controls are collected
- **CIS Control**: 5.2.3.14
- **Profile Applicability**: Level 2 - Server, Level 2 - Workstation
- **Benchmark**: CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0
- **Category**: cis-logging
- **Tags**: cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Severity**: medium
- **Version**: 2.2.0

## Description
Monitor AppArmor, an implementation of mandatory access controls. The parameters below monitor any write access (potential additional, deletion or modification of files in the directory) or attribute changes to the `/etc/apparmor/` and `/etc/apparmor.d/` directories.

Note: If a different Mandatory Access Control method is used, changes to the corresponding directories should be audited.

## Rationale
Changes to files in the `/etc/apparmor/` and `/etc/apparmor.d/` directories could indicate that an unauthorized user is attempting to modify access controls and change security contexts, leading to a compromise of the system.

## Impact
None

## Audit

### On Disk Configuration
```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && awk "/^ *-w/ \
&&(/\/etc\/apparmor/ \
||/\/etc\/apparmor.d/) \
&&/ -p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" /etc/audit/rules.d/*.rules
```

**Expected Output**:
```
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

### Running Configuration
```bash
auditctl -l | awk "/^ *-w/ \
&&(/\/etc\/apparmor/ \
||/\/etc\/apparmor.d/) \
&&/ -p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/"
```

**Expected Output**:
```
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

## Remediation

### Create Audit Rules
Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor events that modify the system's Mandatory Access Controls.

Example:
```bash
printf "
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
" >> /etc/audit/rules.d/50-MAC-policy.rules
```

### Load Audit Rules
Merge and load the rules into active configuration:
```bash
augenrules --load
```

Check if reboot is required:
```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

## References
- NIST SP 800-53 Rev. 5: AU-3, CM-6

## CIS Controls
- **v8**: 8.5 Collect Detailed Audit Logs
- **v7**: 5.5 Implement Automated Configuration Monitoring Systems

## MITRE ATT&CK Mappings
- **Techniques**: T1562, T1562.006
- **Tactics**: TA0004
- **Mitigations**: M1022

## Additional Information

### Potential Reboot Required
If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

### System Call Structure
For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.
