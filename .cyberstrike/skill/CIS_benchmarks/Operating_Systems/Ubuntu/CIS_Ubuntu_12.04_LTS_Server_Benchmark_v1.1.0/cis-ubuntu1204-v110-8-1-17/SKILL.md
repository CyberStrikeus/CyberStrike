---
name: cis-ubuntu1204-v110-8-1-17
description: "Collect Kernel Module Loading and Unloading"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, kernel, modules, insmod, rmmod, modprobe]
cis_id: "8.1.17"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.17 Collect Kernel Module Loading and Unloading (Scored)

## Profile Applicability
- Level 2

## Description
Monitor the loading and unloading of kernel modules. The programs `insmod` (install a kernel module), `rmmod` (remove a kernel module), and `modprobe` (a more sophisticated program to load and unload modules, as well as some other features) control loading and unloading of modules. The `init_module` (load a module) and `delete_module` (delete a module) system calls control loading and unloading of modules. Any execution of the loading and unloading module programs and system calls will trigger an audit record with an identifier of "modules".

## Rationale
Monitoring the use of `insmod`, `rmmod` and `modprobe` could provide system administrators with evidence that an unauthorized user loaded or unloaded a kernel module, possibly compromising the security of the system. Monitoring of the `init_module` and `delete_module` system calls would reflect an unauthorized user attempting to use a different program to load and unload modules.

## Audit Procedure
### Using Command Line
Perform the following to determine if kernel module loading and unloading is recorded.
```bash
grep modules /etc/audit/audit.rules
```

## Expected Result
```
-w /sbin/insmod -p x -k modules
-w /sbin/rmmod -p x -k modules
-w /sbin/modprobe -p x -k modules
```

For 32 bit systems:
```
-a always,exit -F arch=b32 -S init_module -S delete_module -k modules
```

For 64 bit systems:
```
-a always,exit -F arch=b64 -S init_module -S delete_module -k modules
```

## Remediation
### Using Command Line
Add the following lines to the `/etc/audit/audit.rules` file:
```bash
-w /sbin/insmod -p x -k modules
-w /sbin/rmmod -p x -k modules
-w /sbin/modprobe -p x -k modules
```

For 32 bit systems, add:
```bash
-a always,exit -F arch=b32 -S init_module -S delete_module -k modules
```

For 64 bit systems, add:
```bash
-a always,exit -F arch=b64 -S init_module -S delete_module -k modules
```

## Default Value
By default, kernel module loading and unloading events are not audited.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 2 - Scored
