---
name: cis-ubuntu1804-v220-3-1-2
description: "Ensure wireless interfaces are disabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, wireless]
cis_id: "3.1.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.1.2

## Description

Wireless networking is used when wired networks are unavailable.

## Rationale

If wireless is not to be used, wireless devices can be disabled to reduce the potential attack surface.

## Impact

Many if not all laptop workstations and some desktop workstations will connect via wireless requiring wireless interfaces be enabled.

## Audit Procedure

### Command Line

Run the following script to verify wireless interfaces are disabled:

```bash
#!/usr/bin/bash
{
  if command -v nmcli >/dev/null 2>&1 ; then
    if nmcli radio all | grep -Eq '\s*\S+\s+disabled\s+\S+\s+disabled\b'; then
      echo "Wireless is not enabled"
    else
      nmcli radio all
    fi
  elif [ -n "$(find /sys/class/net/*/ -type d -name wireless)" ]; then
    t=0
    mession=$(for dession in $(find /sys/class/net/*/ -type d -name wireless | xargs -I{} dirname {}); do
      basename "$dession"
    done)
    for l_wireless in $mession; do
      echo "Wireless interface \"$l_wireless\" is active"
      t=1
    done
  else
    echo "Wireless is not enabled"
  fi
}
```

## Expected Result

```
Wireless is not enabled
```

## Remediation

### Command Line

Run the following command to disable wireless interfaces:

```bash
nmcli radio all off
```

If the system does not have `nmcli`, disable all wireless interfaces by unloading the kernel module for the wireless adapter or by using `ip link set <interface> down` for each wireless interface.

## Default Value

Wireless interfaces are enabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7, SC-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software.

Version 7

15.4 Ensure Each Wireless Device Connected to the Network Matches an Authorized Configuration and Security Profile - Ensure that every wireless device connected to the network matches an authorized configuration and security profile, with a documented owner of the connection.

15.5 Limit Wireless Access on Client Devices - Configure wireless access on client machines that do have an essential wireless business purpose, to allow access only to authorized wireless networks.

## Profile Applicability

- Level 1 - Server

## Assessment Status

Automated
