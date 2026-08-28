---
name: cis-ubuntu2004-v300-3-1-2
description: "Ensure wireless interfaces are not available"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, network]
cis_id: "3.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1.2 Ensure wireless interfaces are not available (Automated)

## Profile

- Level 1 - Server

## Description

Wireless networking is used when wired networks are unavailable.

## Rationale

-IF- wireless is not to be used, wireless devices can be disabled to reduce the potential attack surface.

## Impact

Many if not all laptop workstations and some desktop workstations will connect via wireless requiring these interfaces be enabled.

## Audit Procedure

### Command Line

Run the following script to verify no wireless interfaces are active on the system:

```bash
#!/usr/bin/env bash

{
  l_output="" l_output2=""
  module_chk()
  {
      # Check how module will be loaded
      l_loadable="$(modprobe -n -v "$l_mname")"
      if grep -Pq -- '^\h*install \\/bin\\/(true|false)' <<< "$l_loadable"; then
          l_output="$l_output\n - module: \"$l_mname\" is not loadable: \"$l_loadable\""
      else
          l_output2="$l_output2\n - module: \"$l_mname\" is loadable: \"$l_loadable\""
      fi
      # Check is the module currently loaded
      if ! lsmod | grep "$l_mname" > /dev/null 2>&1; then
          l_output="$l_output\n - module: \"$l_mname\" is not loaded"
      else
          l_output2="$l_output2\n - module: \"$l_mname\" is loaded"
      fi
      # Check if the module is deny listed
      if modprobe --showconfig | grep -Pq -- "^\h*blacklist\h+$l_mname\b"; then
          l_output="$l_output\n - module: \"$l_mname\" is deny listed in: \"$(grep -Pl -- \
"^\h*blacklist\h+$l_mname\b" /etc/modprobe.d/*)\""
      else
          l_output2="$l_output2\n - module: \"$l_mname\" is not deny listed"
      fi
  }
  if [ -n "$(find /sys/class/net/*/ -type d -name wireless)" ]; then
      l_dname=$(for driverdir in $(find /sys/class/net/*/ -type d -name wireless | xargs -0 dirname); do
basename "$(readlink -f "$driverdir"/device/driver/module)";done | sort -u)
      for l_mname in $l_dname; do
          module_chk
      done
  fi
  # Report results. If no failures output in l_output2, we pass
  if [ -z "$l_output2" ]; then
      echo -e "\n- Audit Result:\n  ** PASS **"
      if [ -z "$l_output" ]; then
          echo -e "\n - System has no wireless NICs installed"
      else
          echo -e "\n$l_output\n"
      fi
  else
      echo -e "\n- Audit Result:\n  ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
      [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
  fi
}
```

## Expected Result

Audit Result: ** PASS ** - System has no wireless NICs installed, or all wireless modules are not loadable, not loaded, and deny listed.

## Remediation

### Command Line

Run the following command to disable any wireless interfaces:

```bash
# find /lib/modules/`uname -r`/kernel/drivers/net/wireless -name '*.ko' -printf 'install %f
/bin/false\nblacklist %f\n\n' | sed 's/\.ko//1' >> /etc/modprobe.d/blacklist-wireless.conf
```

Note: the `*.conf` file in `/etc/modprobe.d/` in the above command can renamed as needed.

## Default Value

Wireless interfaces are enabled if wireless hardware is present.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 15.4 Disable Wireless Access on Devices if Not Required                         |      |      | x    |
| v7               | 15.5 Limit Wireless Access on Client Devices                                    |      |      | x    |
