---
name: cis-ubuntu1804-v220-5-2-3-1
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure changes to system administration scope (sudoers) is collected
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.1 Ensure changes to system administration scope (sudoers) is collected

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor scope changes for system administrators. If the system has been properly configured to force system administrators to log in as themselves first and then use the `sudo` command to execute privileged commands, it is possible to monitor changes in scope. The file `/etc/sudoers`, or files in `/etc/sudoers.d`, will be written to when the file(s) or related attributes have changed. The audit records will be tagged with the identifier "scope".

## Rationale

Changes in the `/etc/sudoers` and `/etc/sudoers.d` files can indicate that an unauthorized change has been made to the scope of system administrator activity.

## Audit

### On disk configuration

Run the following command to check the on disk rules:

```bash
awk '/^ *-w/ \
&&(/\/etc\/sudoers/ \
 ||/\/etc\/sudoers.d/) \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/' /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d -p wa -k scope
```

### Running configuration

Run the following command to check loaded rules:

```bash
auditctl -l | awk '/^ *-w/ \
&&(/\/etc\/sudoers/ \
 ||/\/etc\/sudoers.d/) \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/'
```

Verify the output matches:

```
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d -p wa -k scope
```

## Remediation

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor scope changes for system administrators.

Example:

```bash
printf "
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d -p wa -k scope
" >> /etc/audit/rules.d/50-scope.rules
```

Merge and load the rules into active configuration:

```bash
augenrules --load
```

Check if reboot is required:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

## References

- NIST SP 800-53 Rev. 5: AU-3

## CIS Controls

| Version | Control                                                         | IG 1 | IG 2 | IG 3 |
| ------- | --------------------------------------------------------------- | ---- | ---- | ---- |
| v8      | 8.5 Collect Detailed Audit Logs                                 |      | ●    | ●    |
| v7      | 4.8 Log and Alert on Changes to Administrative Group Membership |      | ●    | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1562, T1562.006            | TA0004  | M1047       |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination.
