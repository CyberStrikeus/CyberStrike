---
name: cis-ubuntu2004-v300-1-1-1-4
description: "Ensure hfsplus kernel module is not available"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "1.1.1.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure hfsplus kernel module is not available

## Profile

Level 1 - Server, Level 1 - Workstation, Assessment: Automated

## Description

The `hfsplus` filesystem type is a hierarchical filesystem designed to replace `hfs` that allows you to mount Mac OS filesystems.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Audit Procedure

### Command Line

Verify the `hfsplus` kernel module is not available on the system - OR - has been disabled.

Run the following script to determine if the `hfsplus` kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
   l_mod_name="hfsplus" l_mod_type="fs"
   while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name}/-/\/" ] &&  [ -n "$(ls -A "$l_mod_path/${l_mod_name}/-/\/")" ]; then
         printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
   done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f /lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the `hfsplus` kernel module is not available on the system and no further audit steps are required.

Note: Some systems may include the `hfsplus` filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned, verify the `hfsplus` kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the `hfsplus` kernel module is not loaded:

```bash
# lsmod | grep 'hfsplus'
```

Nothing should be returned

Run the following command to verify the `hfsplus` kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+hfsplus\b'
```

Verify the output includes:

```
blacklist hfsplus
 -AND-
install hfsplus /bin/false
 -OR-
install hfsplus /bin/true
```

## Expected Result

```
blacklist hfsplus
install hfsplus /bin/false
```

## Remediation

### Command Line

Run the following commands to unload the `hfsplus` kernel module:

```bash
# modprobe -r hfsplus 2>/dev/null
# rmmod hfsplus 2>/dev/null
```

Perform the following to disable the `hfsplus` kernel module:

Create a file ending in `.conf` with `install hfsplus /bin/false` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "install hfsplus /bin/false" >> hfsplus.conf
```

Create a file ending in `.conf` with `blacklist hfsplus` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "blacklist hfsplus" >> hfsplus.conf
```

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7 a
2. NIST SP 800-53A :: CM-7.1 (ii)

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)

MITRE ATT&CK Mappings: T1005, T1005.000 | TA0005 | M1050
