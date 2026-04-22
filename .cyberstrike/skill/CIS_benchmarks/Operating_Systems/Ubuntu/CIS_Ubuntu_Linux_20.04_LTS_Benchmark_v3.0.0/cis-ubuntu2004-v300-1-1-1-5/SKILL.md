---
name: cis-ubuntu2004-v300-1-1-1-5
description: "Ensure jffs2 kernel module is not available"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "1.1.1.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure jffs2 kernel module is not available

## Profile

Level 1 - Server, Level 1 - Workstation, Assessment: Automated

## Description

The `jffs2` (journaling flash filesystem 2) filesystem type is a log-structured filesystem used in flash memory devices.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Audit Procedure

### Command Line

Verify the `jffs2` kernel module is not available on the system - OR - has been disabled.

Run the following script to determine if the `jffs2` kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
   l_mod_name="jffs2" l_mod_type="fs"
   while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name}/-/\/" ] &&  [ -n "$(ls -A "$l_mod_path/${l_mod_name}/-/\/")" ]; then
         printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
   done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f /lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the `jffs2` kernel module is not available on the system and no further audit steps are required.

Note: Some systems may include the `jffs2` filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned, verify the `jffs2` kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the `jffs2` kernel module is not loaded:

```bash
# lsmod | grep 'jffs2'
```

Nothing should be returned

Run the following command to verify the `jffs2` kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+jffs2\b'
```

Verify the output includes:

```
blacklist jffs2
 -AND-
install jffs2 /bin/false
 -OR-
install jffs2 /bin/true
```

## Expected Result

```
blacklist jffs2
install jffs2 /bin/false
```

## Remediation

### Command Line

Run the following to unload and disable the `jffs2` kernel module:

```bash
# modprobe -r jffs2 2>/dev/null
# rmmod jffs2 2>/dev/null
```

Perform the following to disable the `jffs2` kernel module:

Create a file ending in `.conf` with `install jffs2 /bin/false` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "install jffs2 /bin/false" >> jffs2.conf
```

Create a file ending in `.conf` with `blacklist jffs2` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "blacklist jffs2" >> jffs2.conf
```

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)

MITRE ATT&CK Mappings: T1005, T1005.000 | TA0005 | M1050
