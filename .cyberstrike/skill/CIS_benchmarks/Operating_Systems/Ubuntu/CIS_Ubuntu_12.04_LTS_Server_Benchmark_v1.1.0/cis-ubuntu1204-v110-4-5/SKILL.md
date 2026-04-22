---
name: cis-ubuntu1204-v110-4-5
description: "Activate AppArmor"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, process-hardening, apparmor, mac, mandatory-access-control]
cis_id: "4.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.5 Activate AppArmor (Scored)

## Profile Applicability
- Level 2

## Description
AppArmor provides a Mandatory Access Control (MAC) system that greatly augments the default Discretionary Access Control (DAC) model.

## Rationale
For an action to occur, both the traditional DAC permissions must be satisfied as well as the AppArmor MAC rules. The action will not be allowed if either one of these models does not permit the action. In this way, AppArmor rules can only make a system's permissions more restrictive and secure.

## Audit Procedure
### Using Command Line
Check the status of AppArmor:
```bash
apparmor_status
```

## Expected Result
The output should show:
- AppArmor module is loaded
- Profiles are loaded and in enforce mode
- No profiles are in complain mode
- No processes are unconfined but have a profile defined

Example compliant output:
```
apparmor module is loaded.
18 profiles are loaded.
18 profiles are in enforce mode.
0 profiles are in complain mode.
2 processes have profiles defined.
2 processes are in enforce mode.
0 processes are in complain mode.
0 processes are unconfined but have a profile defined
```

## Remediation
### Using Command Line
Install `apparmor` and `apparmor-utils` if missing (additional profiles can be found in the `apparmor-profiles` package):
```bash
apt-get install apparmor apparmor-utils
```

Remove `apparmor=0` from all kernels in `/boot/grub/menu.lst`:
```
kernel /boot/vmlinuz-3.0.80-0.7-ec2 root=/dev/sda1 xencons=xvc0 console=xvc0 splash=silent showopts
```

Set all profiles to enforce mode:
```bash
aa-enforce /etc/apparmor.d/*
```

## Default Value
By default, AppArmor is installed but may not have all profiles in enforce mode on Ubuntu 12.04.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 2 - Scored
