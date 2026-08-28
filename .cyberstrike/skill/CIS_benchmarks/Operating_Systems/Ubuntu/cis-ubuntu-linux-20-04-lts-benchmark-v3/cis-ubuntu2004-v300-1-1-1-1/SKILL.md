---
name: cis-ubuntu2004-v300-1-1-1-1
description: "Ensure cramfs kernel module is not available"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "1.1.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure cramfs kernel module is not available

## Profile

Level 1 - Server, Level 1 - Workstation, Assessment: Automated

## Description

The `cramfs` filesystem type is a compressed read-only Linux filesystem embedded in small footprint systems. A `cramfs` image can be used without having to first decompress the image.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Audit Procedure

### Command Line

Verify the `cramfs` kernel module is not available on the system - OR - has been disabled.

Run the following script to determine if the `cramfs` kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
   l_mod_name="cramfs" l_mod_type="fs"
   while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name}/-/\/" ] &&  [ -n "$(ls -A "$l_mod_path/${l_mod_name}/-/\/")" ]; then
         printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
   done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f /lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the `cramfs` kernel module is not available on the system and no further audit steps are required.

Note: Some systems may include the `cramfs` filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned by the above script, verify the `cramfs` kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the `cramfs` kernel module is not loaded:

```bash
# lsmod | grep 'cramfs'
```

Nothing should be returned

Run the following command to verify the `cramfs` kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+cramfs\b'
```

Verify the output includes:

```
blacklist cramfs
 -AND EITHER-
install cramfs /bin/false
 -OR-
install cramfs /bin/true
```

## Expected Result

```
blacklist cramfs
install cramfs /bin/false
```

## Remediation

### Command Line

Run the following to unload and disable the `cramfs` kernel module.

```bash
# modprobe -r cramfs 2>/dev/null
# rmmod cramfs 2>/dev/null
```

Perform the following to disable the `cramfs` kernel module:

Create a file ending in `.conf` with `install cramfs /bin/false` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "install cramfs /bin/false" >> cramfs.conf
```

Create a file ending in `.conf` with `blacklist cramfs` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "blacklist cramfs" >> cramfs.conf
```

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53: CM-7 a
2. NIST SP 800-53A :: CM-7.1 (ii)
3. RHEL 8 STIG Group ID: V-230498
4. RHEL 9 STIG Group ID: V-257880

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)

MITRE ATT&CK Mappings: T1005, T1005.000 | TA0005 | M1050
