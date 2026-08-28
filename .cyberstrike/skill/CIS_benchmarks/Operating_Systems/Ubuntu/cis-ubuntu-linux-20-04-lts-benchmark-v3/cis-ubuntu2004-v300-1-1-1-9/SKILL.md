---
name: cis-ubuntu2004-v300-1-1-1-9
description: "Ensure usb-storage kernel module is not available"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "1.1.1.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure usb-storage kernel module is not available

## Profile

Level 1 - Server, Level 2 - Workstation, Assessment: Automated

## Description

USB storage provides a means to transfer and store files ensuring persistence and availability of the files independent of network connection status. Its popularity and utility has led to USB-based malware being a simple and common means for network infiltration and a first step to establishing a persistent threat within a networked environment.

## Rationale

Restricting USB access on the system will decrease the physical attack surface for a device and diminish the possible vectors to introduce malware.

## Impact

Disabling the `usb-storage` module will disable any usage of USB storage devices.

If requirements and local site policy allow the use of such devices, other solutions should be configured accordingly instead. One example of a commonly used solution is `USBGuard`.

## Audit Procedure

### Command Line

Verify the `usb-storage` kernel module is not available on the system - OR - has been disabled.

Run the following script to determine if the `usb-storage` kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
   l_mod_name="usb-storage" l_mod_type="drivers"
   while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name}//-/\/" ] &&  [ -n "$(ls -A "$l_mod_path/${l_mod_name}//-/\/")" ]; then
         printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
   done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f /lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the `usb-storage` kernel module is not available on the system and no further audit steps are required.

Note: Some systems may include the `usb-storage` filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned, verify the `usb-storage` kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the `usb-storage` kernel module is not loaded:

```bash
# lsmod | grep -P -- 'usb(_|-)storage'
```

Nothing should be returned

Run the following command to verify the `usb-storage` kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+usb_storage\b'
```

Verify the output includes:

```
blacklist usb_storage
 -AND-
install usb_storage /bin/false
 -OR-
install usb_storage /bin/true
```

## Expected Result

```
blacklist usb_storage
install usb_storage /bin/false
```

## Remediation

### Command Line

Run the following commands to unload the `usb-storage` kernel module:

```bash
# modprobe -r usb-storage 2>/dev/null
# rmmod usb-storage 2>/dev/null
```

Perform the following to disable the `usb-storage` kernel module:

Create a file ending in `.conf` with `install usb_storage /bin/false` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "install usb_storage /bin/false" >> usb-storage.conf
```

Create a file ending in `.conf` with `blacklist usb_storage` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "blacklist usb_storage" >> usb-storage.conf
```

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53 Rev. 5: SI-3
2. RHEL 8 STIG Vul ID: V-230503
3. RHEL 8 STIG Rule ID: SV-230503r942936
4. Ubuntu 22.04 STIG Vul ID: V-260540
5. Ubuntu 22.04 STIG Rule ID: SV-260540r986276

## CIS Controls

v8 - 10.3 Disable Autorun and Autoplay for Removable Media (IG 1, IG 2, IG 3)
v7 - 13.7 Manage USB Devices (IG 2, IG 3)

MITRE ATT&CK Mappings: T1052, T1052.001, T1091, T1091.000, T1200, T1200.000 | TA0001, TA0010 | M1034
