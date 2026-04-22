---
name: cis-ubuntu1804-v220-5-2-3-19
description: Ensure kernel module loading and unloading is collected
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# CIS Ubuntu 18.04 - Ensure kernel module loading and unloading is collected (5.2.3.19)

## Metadata

- **ID**: cis-ubuntu1804-v220-5-2-3-19
- **Title**: Ensure kernel module loading and unloading is collected
- **CIS Control**: 5.2.3.19
- **Profile Applicability**: Level 2 - Server, Level 2 - Workstation
- **Benchmark**: CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0
- **Category**: cis-logging
- **Tags**: cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Severity**: medium
- **Version**: 2.2.0

## Description

Monitor the loading and unloading of kernel modules. The programs `insmod` (install a kernel module), `rmmod` (remove a kernel module), and `modprobe` (a more sophisticated program to load and unload modules, as well as load dependent modules) control loading and unloading of modules. The `init_module` (load a module) and `delete_module` (delete a module) system calls control loading and unloading of modules. Any execution of the loading and unloading module programs and system calls will trigger an audit record with an identifier of "modules".

## Rationale

Monitoring the use of `insmod`, `rmmod` and `modprobe` could provide system administrators with evidence that an unauthorized user loaded or unloaded a kernel module, possibly compromising the security of the system. Monitoring of the `init_module` and `delete_module` system calls would reflect an unauthorized user attempting to use a different program to load and unload modules.

## Impact

None

## Audit

### On Disk Configuration (64-bit)

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
On Disk rules:
" && awk "/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&/ -S/ \
&&(/init_module/||/finit_module/||/delete_module/) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" /etc/audit/rules.d/*.rules \
&& awk "/^ *-w/ \
&&(/\/usr\/sbin\/insmod/||/\/usr\/sbin\/rmmod/||/\/usr\/sbin\/modprobe/) \
&&/ -p *x/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" /etc/audit/rules.d/*.rules \
|| printf "ERROR: Variable 'UID_MIN' is unset.\n"
```

**Expected Output**:

```
-a always,exit -F arch=b64 -S init_module,finit_module,delete_module -F auid>=1000 -F auid!=unset -k kernel_modules
-a always,exit -F arch=b32 -S init_module,finit_module,delete_module -F auid>=1000 -F auid!=unset -k kernel_modules
-w /usr/sbin/insmod -p x -k kernel_modules
-w /usr/sbin/rmmod -p x -k kernel_modules
-w /usr/sbin/modprobe -p x -k kernel_modules
```

### Running Configuration (64-bit)

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
Running configuration rules:
" && auditctl -l | awk "/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&/ -S/ \
&&(/init_module/||/finit_module/||/delete_module/) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" \
&& auditctl -l | awk "/^ *-w/ \
&&(/\/usr\/sbin\/insmod/||/\/usr\/sbin\/rmmod/||/\/usr\/sbin\/modprobe/) \
&&/ -p *x/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/"
```

**Expected Output**:

```
-a always,exit -F arch=b64 -S init_module,finit_module,delete_module -F auid>=1000 -F auid!=-1 -F key=kernel_modules
-a always,exit -F arch=b32 -S init_module,finit_module,delete_module -F auid>=1000 -F auid!=-1 -F key=kernel_modules
-w /usr/sbin/insmod -p x -k kernel_modules
-w /usr/sbin/rmmod -p x -k kernel_modules
-w /usr/sbin/modprobe -p x -k kernel_modules
```

### 32-bit Systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## Remediation

### Create Audit Rules

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor kernel module loading and unloading.

Example:

```bash
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
[ -n "${UID_MIN}" ] && printf "
-a always,exit -F arch=b64 -S init_module,finit_module,delete_module -F auid>=${UID_MIN} -F auid!=unset -k kernel_modules
-a always,exit -F arch=b32 -S init_module,finit_module,delete_module -F auid>=${UID_MIN} -F auid!=unset -k kernel_modules
-w /usr/sbin/insmod -p x -k kernel_modules
-w /usr/sbin/rmmod -p x -k kernel_modules
-w /usr/sbin/modprobe -p x -k kernel_modules
" >> /etc/audit/rules.d/50-kernel_modules.rules || printf "ERROR: Variable 'UID_MIN' is unset.\n"
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

### 32-bit Systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## References

- NIST SP 800-53 Rev. 5: AU-2, AU-12, SI-5

## CIS Controls

- **v8**: 8.5 Collect Detailed Audit Logs
- **v7**: 5.1 Establish Secure Configurations

## MITRE ATT&CK Mappings

- **Techniques**: T1547, T1547.006
- **Tactics**: TA0003
- **Mitigations**: M1022

## Additional Information

### Potential Reboot Required

If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

### System Call Structure

For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination. This is important to understand for both the auditing and remediation sections as the examples given are optimized for performance as per the man page.
