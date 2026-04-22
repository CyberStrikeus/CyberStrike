---
name: cis-ubuntu2004-v300-1-1-1-10
description: "Ensure unused filesystems kernel modules are not available"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "1.1.1.10"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure unused filesystems kernel modules are not available

## Profile

Level 1 - Server, Level 1 - Workstation, Assessment: Manual

## Description

Filesystem kernel modules are pieces of code that can be dynamically loaded into the Linux kernel to extend its filesystem capabilities, or so-called base kernel, of an operating system. Filesystem kernel modules are typically used to add support for new hardware (as device drivers), or for adding system calls.

## Rationale

While loadable filesystem kernel modules are a convenient method of modifying the running kernel, this can be abused by attackers on a compromised system to prevent detection of their processes or files, allowing them to maintain control over the system. Many rootkits make use of loadable filesystem kernel modules in this way.

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it. The following filesystem kernel modules have known CVE's and should be made unavailable if no dependencies exist:

- `afs` - CVE-2022-37402
- `ceph` - CVE-2022-0670
- `cifs` - CVE-2022-29869
- `exfat` CVE-2022-29973
- `ext` CVE-2022-1184
- `fat` CVE-2022-22043
- `fscache` CVE-2022-3630
- `fuse` CVE-2023-0386
- `gfs2` CVE-2023-3212
- `nfs_common` CVE-2023-6660
- `nfsd` CVE-2022-43945
- `smbfs_common` CVE-2022-2585

## Impact

This list may be quite extensive and covering all edges cases is difficult. Therefore, it's crucial to carefully consider the implications and dependencies before making any changes to the filesystem kernel module configurations.

WARNING: disabling or denylisting filesystem modules that are in use on the system may be FATAL. It is extremely important to thoroughly review this list.

## Audit Procedure

### Command Line

Run the following script to:
- Look at the filesystem kernel modules available to the currently running kernel.
- Exclude mounted filesystem kernel modules that don't currently have a CVE
- List filesystem kernel modules that are not fully disabled, or are loaded into the kernel

Review the generated output.

```bash
#!/usr/bin/env bash

{
   a_output=(); a_output2=(); a_modprobe_config=(); a_excluded=(); a_available_modules=()
   a_ignore=("xfs" "vfat" "ext2" "ext3" "ext4")
   a_cve_exists=("afs" "ceph" "cifs" "exfat" "ext" "fat" "fscache" "fuse" "gfs2" "nfs_common" "nfsd" "smbfs_common")
   f_module_chk()
   {
      l_out2=""; grep -Pq -- "\b$l_mod_name\b" <<< "${a_cve_exists[*]}" && l_out2=" <- CVE exists!"
      if ! grep -Pq -- '\bblacklist\h+'"$l_mod_name"'"\b' <<< "${a_modprobe_config[*]}"; then
         a_output2+=(" - Kernel module: \"$l_mod_name\" is not fully disabled $l_out2")
      elif ! grep -Pq -- '\binstall\h+'"$l_mod_name"'"\h+(\\/usr)?\\\/bin\/(false|true)\b' <<< "${a_modprobe_config[*]}"; then
         a_output2+=(" - Kernel module: \"$l_mod_name\" is not fully disabled $l_out2")
      fi
      if lsmod | grep "$l_mod_name" &> /dev/null; then
         l_output2+=(" - Kernel module: \"$l_mod_name\" is loaded" "")
      fi
   }
   while IFS= read -r -d $'\0' l_module_dir; do
      a_available_modules+=("$(basename "$l_module_dir")")
   done < <(find "$(readlink -f /usr/lib/modules/$(uname -r)/kernel/fs || readlink -f /lib/modules/$(uname -r)/kernel/fs)" -mindepth 1 -maxdepth 1 -type d ! -empty -print0)
   while IFS= read -r l_exclude; do
      if grep -Pq -- "\b$l_exclude\b" <<< "${a_cve_exists[*]}"; then
         a_output2+=(" - ** WARNING: kernel module: \"$l_exclude\" has a CVE and is currently mounted! **")
      elif
         grep -Pq -- "\b$l_exclude\b" <<< "${a_available_modules[*]}"; then
         a_output+=(" - Kernel module: \"$l_exclude\" is currently mounted - do NOT unload or disable")
      fi
   done < <(findmnt -knD | awk '{print $2}' | sort -u)
   a_modprobe_config+=("$l_showconfig")
   done < <(modprobe --showconfig | grep -P '\h*(blacklist|install)')
   for l_mod_name in "${a_available_modules[@]}"; do
      if [ "$l_mod_name" =~ overlay ]] && l_mod_name="${l_mod_name::-2}"
         [ "$l_dl" != "y" ] && f_module_fix
      fi
   done
   [ "${#a_excluded[@]}" -gt 0 ] && printf '%s\n' "" " -- INFO --" \
      "The following intentionally skipped" \
      "${a_excluded[@]}"
   if [ "${#a_output2[@]}" -le 0 ]; then
      printf '%s\n' "" " - No unused filesystem kernel modules are enabled" "${a_output[@]}" ""
   else
      printf '%s\n' "" "-- Audit Result: --" " ** REVIEW the following **" "${a_output2[@]}"
      [ "${#a_output[@]}" -gt 0 ] && printf '%s\n' "" "-- Correctly set: --" "${a_output[@]}" ""
   fi
}
```

## Expected Result

No unused filesystem kernel modules should be enabled. The audit script should return a passing state.

## Remediation

### Command Line

- IF - the module is available in the running kernel:
  - Unload the filesystem kernel module from the kernel
  - Create a file ending in `.conf` with install filesystem kernel modules `/bin/false` in the `/etc/modprobe.d/` directory
  - Create a file ending in `.conf` with deny list filesystem kernel modules in the `/etc/modprobe.d/` directory

WARNING: unloading, disabling or denylisting filesystem modules that are in use on the system maybe FATAL. It is extremely important to thoroughly review the filesystems returned by the audit before following the remediation procedure.

Example of unloading the `gfs2` kernel module:

```bash
# modprobe -r gfs2 2>/dev/null
# rmmod gfs2 2>/dev/null
```

Example of fully disabling the `gfs2` kernel module:

```bash
# printf '%s\n' "blacklist gfs2" "install gfs2 /bin/false" >> /etc/modprobe.d/gfs2.conf
```

Note:
- Disabling a kernel module by modifying the command above for each unused filesystem kernel module
- The example `gfs2` must be updated with the appropriate module name for the command or example script below to run correctly.

## Default Value

Various filesystem kernel modules are enabled by default.

## References

1. https://cve.mitre.org/cgi-bin/cvekey.cgi?keyword=filesystem

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)
