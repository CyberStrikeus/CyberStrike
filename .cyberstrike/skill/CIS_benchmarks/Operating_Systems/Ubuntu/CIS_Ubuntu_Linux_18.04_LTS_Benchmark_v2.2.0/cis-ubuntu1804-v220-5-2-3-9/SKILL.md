---
name: cis-ubuntu1804-v220-5-2-3-9
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure discretionary access control permission modification events are collected
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.9 Ensure discretionary access control permission modification events are collected

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor changes to file permissions, attributes, ownership and group. The parameters in this section track changes for system calls that affect file permissions and attributes. The following commands and system calls effect the permissions, ownership and various attributes of files:

- `chmod`
- `fchmod`
- `fchmodat`
- `chown`
- `fchown`
- `fchownat`
- `lchown`
- `setxattr`
- `lsetxattr`
- `fsetxattr`
- `removexattr`
- `lremovexattr`
- `fremovexattr`

In all cases, an audit record will only be written for non-system user ids and will ignore Daemon events. All audit records will be tagged with the identifier "perm_mod."

## Rationale

Monitoring for changes in file attributes could alert a system administrator to activity that could indicate intruder activity or policy violation.

## Audit

Run the following commands to check on disk configuration and loaded rules. The output for both commands should be the same.

### On disk configuration

```bash
awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -S/ \
&&(/chmod/ \
 ||/fchmod/ \
 ||/fchmodat/ \
 ||/chown/ \
 ||/fchown/ \
 ||/fchownat/ \
 ||/lchown/ \
 ||/setxattr/ \
 ||/lsetxattr/ \
 ||/fsetxattr/ \
 ||/removexattr/ \
 ||/lremovexattr/ \
 ||/fremovexattr/) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/' /etc/audit/rules.d/*.rules
```

### Running configuration

```bash
auditctl -l | awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -S/ \
&&(/chmod/ \
 ||/fchmod/ \
 ||/fchmodat/ \
 ||/chown/ \
 ||/fchown/ \
 ||/fchownat/ \
 ||/lchown/ \
 ||/setxattr/ \
 ||/lsetxattr/ \
 ||/fsetxattr/ \
 ||/removexattr/ \
 ||/lremovexattr/ \
 ||/fremovexattr/) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/'
```

Verify the output for both includes similar rules for 32 and 64 bit architecture for each of the system calls.

## Remediation

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules` extension, with the relevant rules for monitoring discretionary access control permission modification events.

Example:

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
-a always,exit -F arch=b64 -S chmod,fchmod,fchmodat -F auid>=%s -F auid!=unset -F key=perm_mod
-a always,exit -F arch=b64 -S chown,fchown,lchown,fchownat -F auid>=%s -F auid!=unset -F key=perm_mod
-a always,exit -F arch=b32 -S chmod,fchmod,fchmodat -F auid>=%s -F auid!=unset -F key=perm_mod
-a always,exit -F arch=b32 -S lchown,fchown,chown,fchownat -F auid>=%s -F auid!=unset -F key=perm_mod
-a always,exit -F arch=b64 -S setxattr,lsetxattr,fsetxattr,removexattr,lremovexattr,fremovexattr -F auid>=%s -F auid!=unset -F key=perm_mod
-a always,exit -F arch=b32 -S setxattr,lsetxattr,fsetxattr,removexattr,lremovexattr,fremovexattr -F auid>=%s -F auid!=unset -F key=perm_mod
" "${UID_MIN}" "${UID_MIN}" "${UID_MIN}" "${UID_MIN}" "${UID_MIN}" "${UID_MIN}" >> /etc/audit/rules.d/50-perm_mod.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
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

| Version | Control                                                             | IG 1 | IG 2 | IG 3 |
| ------- | ------------------------------------------------------------------- | ---- | ---- | ---- |
| v8      | 8.5 Collect Detailed Audit Logs                                     |      | ●    | ●    |
| v7      | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data |      |      | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1562, T1562.006            | TA0005  | M1047       |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination.
