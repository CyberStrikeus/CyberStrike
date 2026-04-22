---
name: cis-ubuntu2004-v300-1-1-1-6
description: "Ensure overlay kernel module is not available"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "1.1.1.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure overlay kernel module is not available

## Profile

Level 2 - Server, Level 2 - Workstation, Assessment: Automated

## Description

`overlay` is a Linux filesystem that layers multiple filesystems to create a single unified view which allows a user to "merge" several mount points into a unified filesystem.

## Rationale

The `overlay` has known CVE's: CVE-2023-32629, CVE-2023-2640, CVE-2023-0386. Disabling the `overlay` reduces the local attack surface by removing support for unnecessary filesystem types and mitigates potential risks associated with unauthorized execution of setuid files, enhancing the overall system security.

## Impact

WARNING: If Container applications such as Docker, Kubernetes, Podman, Linux Containers (LXC), etc. are in use proceed with caution and consider the impact on containerized workloads, as disabling the `overlay` may severely disrupt containerization.

## Audit Procedure

### Command Line

Verify the `overlay` kernel module is not available on the system or has been disabled.

Run the following script to determine if the `overlay` kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
   l_mod_name="overlayfs" l_mod_type="fs"
   while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name}/-/\/" ] &&  [ -n "$(ls -A "$l_mod_path/${l_mod_name}/-/\/")" ]; then
         printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
   done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f /lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the `overlay` kernel module is not available on the system and no further audit steps are required.

Note: Some systems may include the `overlay` filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned, verify the `overlay` kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the `overlay` kernel module is not loaded:

```bash
# lsmod | grep 'overlay'
```

Nothing should be returned

Run the following command to verify the `overlay` kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+overlay\b'
```

Verify the output includes:

```
blacklist overlay
 -AND-
install overlay /bin/false
 -OR-
install overlay /bin/true
```

## Expected Result

```
blacklist overlay
install overlay /bin/false
```

## Remediation

### Command Line

Run the following to unload and disable the `overlay` kernel module:

```bash
# modprobe -r overlay 2>/dev/null
# rmmod overlay 2>/dev/null
```

Perform the following to disable the `overlay` kernel module:

Create a file ending in `.conf` with `install overlay /bin/false` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "install overlay /bin/false" >> overlay.conf
```

Create a file ending in `.conf` with `blacklist overlay` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "blacklist overlay" >> overlay.conf
```

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7
2. https://docs.kernel.org/filesystems/overlayfs.html
3. https://wiki.archlinux.org/title/Overlay_filesystem
4. https://cve.mitre.org/cgi-bin/cvekey.cgi?keyword=overlayfs

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)

MITRE ATT&CK Mappings: T1005, T1005.000 | TA0005 | M1050
