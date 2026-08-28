---
name: cis-ubuntu2004-v300-6-3-3-14
description: "Ensure events that modify the system's Mandatory Access Controls are collected"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.3.14"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.3.14 Ensure events that modify the system's Mandatory Access Controls are collected (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor AppArmor, an implementation of mandatory access controls. The parameters below monitor any write access (potential additional, deletion or modification of files in the directory) or attribute changes to the `/etc/apparmor/` and `/etc/apparmor.d/` directories.

Note: If a different Mandatory Access Control method is used, changes to the corresponding directories should be audited.

## Rationale

Changes to files in the `/etc/apparmor/` and `/etc/apparmor.d/` directories could indicate that an unauthorized user is attempting to modify access controls and change security contexts, leading to a compromise of the system.

## Audit Procedure

### Command Line

On disk configuration - Run the following command to check the on disk rules:

```bash
# awk '/^ *-w/ \
&&(/\/etc\/apparmor/ \
  ||/\/etc\/apparmor.d/) \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)' /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

Running configuration - Run the following command to check loaded rules:

```bash
# auditctl -l | awk '/^ *-w/ \
&&(/\/etc\/apparmor/ \
  ||/\/etc\/apparmor.d/) \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)'
```

Verify the output matches:

```
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
```

## Expected Result

Both on disk and running configuration should show MAC-policy audit rules.

## Remediation

### Command Line

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor events that modify the system's Mandatory Access Controls.

Example:

```bash
# printf "
-w /etc/apparmor/ -p wa -k MAC-policy
-w /etc/apparmor.d/ -p wa -k MAC-policy
" >> /etc/audit/rules.d/50-MAC-policy.rules
```

Merge and load the rules into active configuration:

```bash
# augenrules --load
```

Check if reboot is required:

```bash
# if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

## References

1. NIST SP 800-53 Rev. 5: AU-3, CM-6

## CIS Controls

| Controls Version | Control                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs                          |      | X    | X    |
| v7               | 5.5 Implement Automated Configuration Monitoring Systems |      | X    | X    |

MITRE ATT&CK Mappings: T1562, T1562.006 / TA0004 / M1022
