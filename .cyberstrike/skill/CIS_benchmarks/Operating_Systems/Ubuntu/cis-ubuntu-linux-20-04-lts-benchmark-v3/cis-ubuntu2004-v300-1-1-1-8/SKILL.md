---
name: cis-ubuntu2004-v300-1-1-1-8
description: "Ensure udf kernel module is not available"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "1.1.1.8"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure udf kernel module is not available

## Profile

Level 2 - Server, Level 2 - Workstation, Assessment: Automated

## Description

The `udf` filesystem type is the universal disk format used to implement ISO/IEC 13346 and ECMA-167 specifications. This is an open vendor filesystem type for data storage on a broad range of media. This filesystem type is necessary to support writing DVDs and newer optical disc formats.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Impact

Microsoft Azure requires the usage of `udf`.

`udf` should not be disabled on systems run on Microsoft Azure.

## Audit Procedure

### Command Line

Verify the `udf` kernel module is not available on the system - OR - has been disabled.

Run the following script to determine if the `udf` kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
   l_mod_name="udf" l_mod_type="fs"
   while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name}/-/\/" ] &&  [ -n "$(ls -A "$l_mod_path/${l_mod_name}/-/\/")" ]; then
         printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
   done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f /lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the `udf` kernel module is not available on the system and no further audit steps are required.

Note: Some systems may include the `udf` filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned, verify the `udf` kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the `udf` kernel module is not loaded:

```bash
# lsmod | grep 'udf'
```

Nothing should be returned

Run the following command to verify the `udf` kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+udf\b'
```

Verify the output includes:

```
blacklist udf
 -AND-
install udf /bin/false
 -OR-
install udf /bin/true
```

## Expected Result

```
blacklist udf
install udf /bin/false
```

## Remediation

### Command Line

Run the following commands to unload the `udf` kernel module:

```bash
# modprobe -r udf 2>/dev/null
# rmmod udf 2>/dev/null
```

Perform the following to disable the `udf` kernel module:

Create a file ending in `.conf` with `install udf /bin/false` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "install udf /bin/false" >> udf.conf
```

Create a file ending in `.conf` with `blacklist udf` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "blacklist udf" >> udf.conf
```

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)

MITRE ATT&CK Mappings: T1005, T1005.000 | TA0005 | M1050
