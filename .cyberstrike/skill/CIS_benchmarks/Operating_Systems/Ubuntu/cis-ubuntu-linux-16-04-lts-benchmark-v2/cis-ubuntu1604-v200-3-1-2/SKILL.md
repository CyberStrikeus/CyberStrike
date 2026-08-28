---
name: cis-ubuntu1604-v200-3-1-2
description: "Ensure wireless interfaces are disabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, networking]
cis_id: "3.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.1.2

## Description

Wireless networking is used when wired networks are unavailable. Debian contains a wireless tool kit to allow system administrators to configure and use wireless networks.

## Rationale

If wireless is not to be used, wireless devices can be disabled to reduce the potential attack surface.

## Impact

Many if not all laptop workstations and some desktop workstations will connect via wireless requiring these interfaces be enabled.

## Audit Procedure

### Command Line

Run the following script to verify no wireless interfaces are active on the system:

```bash
#!/bin/bash
if command -v nmcli >/dev/null 2>&1 ; then
  nmcli radio all | grep -Eq '\s*\S+\s+disabled\s+\S+\s+disabled\b' && echo "Wireless is not enabled" || nmcli radio all
elif [ -n "$(find /sys/class/net/*/ -type d -name wireless)" ]; then
  t=0
  drivers=$(for driverdir in $(find /sys/class/net/*/ -type d -name wireless | xargs -0 dirname); do basename "$(readlink -f "$driverdir"/device/driver)";done | sort -u)
  for dm in $drivers; do
    if grep -Eq "^\s*install\s+$dm\s+/bin/(true|false)" /etc/modprobe.d/*.conf; then
      /bin/true
    else
      echo "$dm is not disabled"
      t=1
    fi
  done
  [[ $t -eq 0 ]] && echo "Wireless is not enabled"
else
  echo "Wireless is not enabled"
fi
```

## Expected Result

```
Wireless is not enabled
```

## Remediation

### Command Line

Run the following script to disable any wireless interfaces:

```bash
#!/bin/bash
if command -v nmcli >/dev/null 2>&1 ; then
  nmcli radio all off
else
  if [ -n "$(find /sys/class/net/*/ -type d -name wireless)" ]; then
    drivers=$(for driverdir in $(find /sys/class/net/*/ -type d -name wireless | xargs -0 dirname); do basename "$(readlink -f "$driverdir"/device/driver)";done | sort -u)
    for dm in $drivers; do
      echo "install $dm /bin/true" >> /etc/modprobe.d/disable_wireless.conf
    done
  fi
fi
```

## Default Value

Wireless interfaces may be enabled by default.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0

## CIS Controls

Version 7

15.4 Disable Wireless Access on Devices if Not Required - Disable wireless access on devices that do not have a business purpose for wireless access.

15.5 Limit Wireless Access on Client Devices - Configure wireless access on client machines that do have an essential wireless business purpose, to allow access only to authorized wireless networks and to restrict access to other wireless networks.

## Profile Applicability

- Level 1 - Server
- Level 2 - Workstation

## Assessment Status

Automated
