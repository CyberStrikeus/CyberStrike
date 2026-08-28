---
name: "CIS Ubuntu 14.04 LTS - 4.1.17 Ensure kernel module loading and unloading is collected"
description: "Collect audit events for kernel module loading and unloading operations"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - auditd
  - kernel
  - logging
cis_id: "4.1.17"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 4.1.17 Ensure kernel module loading and unloading is collected (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor the loading and unloading of kernel modules. The programs `insmod` (install a kernel module), `rmmod` (remove a kernel module), and `modprobe` (a more sophisticated program to load and unload modules, as well as some other features) control loading and unloading of modules. The `init_module` (load a module) and `delete_module` (delete a module) system calls control loading and unloading of modules. Any execution of the loading and unloading module programs and system calls will trigger an audit record with an identifier of "modules".

## Rationale

Monitoring the use of `insmod`, `rmmod` and `modprobe` could provide system administrators with evidence that an unauthorized user loaded or unloaded a kernel module, possibly compromising the security of the system. Monitoring of the `init_module` and `delete_module` system calls would reflect an unauthorized user attempting to use a different program to load and unload modules.

## Audit Procedure

On a 32 bit system run the following commands:

```bash
grep modules /etc/audit/audit.rules
auditctl -l | grep modules
```

Verify output of both matches:

```
-w /sbin/insmod -p x -k modules
-w /sbin/rmmod -p x -k modules
-w /sbin/modprobe -p x -k modules
-a always,exit -F arch=b32 -S init_module -S delete_module -k modules
```

On a 64 bit system run the following commands:

```bash
grep modules /etc/audit/audit.rules
auditctl -l | grep modules
```

Verify output of both matches:

```
-w /sbin/insmod -p x -k modules
-w /sbin/rmmod -p x -k modules
-w /sbin/modprobe -p x -k modules
-a always,exit -F arch=b64 -S init_module -S delete_module -k modules
```

## Expected Result

The audit rules for modules should be present and active.

## Remediation

For 32 bit systems add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /sbin/insmod -p x -k modules
-w /sbin/rmmod -p x -k modules
-w /sbin/modprobe -p x -k modules
-a always,exit -F arch=b32 -S init_module -S delete_module -k modules
```

For 64 bit systems add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /sbin/insmod -p x -k modules
-w /sbin/rmmod -p x -k modules
-w /sbin/modprobe -p x -k modules
-a always,exit -F arch=b64 -S init_module -S delete_module -k modules
```

**Notes:** Reloading the auditd config to set active settings may require a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 3 Secure Configurations for Hardware and Software on Mobile Devices, Laptops, Workstations, and Servers

## Profile

- Level 2 - Server
- Level 2 - Workstation
