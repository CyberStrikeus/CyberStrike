---
name: cis-ubuntu1804-v220-3-1-1
description: "Ensure IPv6 status is identified"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, ipv6]
cis_id: "3.1.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.1.1

## Description

If IPv6 is to be used in the environment, or the system has IPv6 enabled, ensure that it is configured properly.

If IPv6 is not to be used in the environment, disable it to reduce the attack surface of the system.

## Rationale

If IPv6 or dual stack is not to be used, it is recommended that IPv6 be disabled to reduce the attack surface of the system.

## Impact

Required network connectivity may be impacted. Consult the documentation for the environment to determine if IPv6 is required.

## Audit Procedure

### Command Line

Run the following script to verify IPv6 status is identified:

```bash
#!/usr/bin/bash
{
  grubfile=$(find /boot -type f \( -name 'grubenv' -o -name 'grub.conf' -o -name 'grub.cfg' \) -exec grep -Pl -- '^\h*(kernelopts=|linux|kernel)' {} \;)
  searchloc="/run/sysctl.d/*.conf /etc/sysctl.d/*.conf /usr/local/lib/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /lib/sysctl.d/*.conf /etc/sysctl.conf"

  if [ -s "$grubfile" ]; then
    ! grep -P -- "^\h*(kernelopts=|linux|kernel)" "$grubfile" | grep -vq -- ipv6.disable=1 && echo -e "\nIPv6 Disabled in \"$grubfile\""
  fi

  if grep -Pqs -- "^\h*net\.ipv6\.conf\.all\.disable_ipv6\h*=\h*1\h*(#.*)?$" $searchloc && \
     grep -Pqs -- "^\h*net\.ipv6\.conf\.default\.disable_ipv6\h*=\h*1\h*(#.*)?$" $searchloc && \
     sysctl net.ipv6.conf.all.disable_ipv6 | grep -Pqs -- "=\h*1\b" && \
     sysctl net.ipv6.conf.default.disable_ipv6 | grep -Pqs -- "=\h*1\b"; then
    echo -e "\nIPv6 Disabled via sysctl"
  fi

  if [ ! -s "$grubfile" ] && ! grep -Pqs -- "^\h*net\.ipv6\.conf\.all\.disable_ipv6\h*=\h*1\h*(#.*)?$" $searchloc && ! grep -Pqs -- "^\h*net\.ipv6\.conf\.default\.disable_ipv6\h*=\h*1\h*(#.*)?$" $searchloc; then
    echo -e "\nIPv6 is enabled on the system"
  fi
}
```

## Expected Result

If IPv6 is not enabled on the system, output should include:

```
IPv6 Disabled in "<grubfile>"
```

or

```
IPv6 Disabled via sysctl
```

If IPv6 is enabled on the system, output should include:

```
IPv6 is enabled on the system
```

## Remediation

### Command Line

If IPv6 is to be disabled, use one of the two following methods to disable IPv6 on the system:

**To disable IPv6 through the GRUB2 config:**

Edit `/etc/default/grub` and add `ipv6.disable=1` to the `GRUB_CMDLINE_LINUX` parameters:

```
GRUB_CMDLINE_LINUX="ipv6.disable=1"
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

**OR**

**To disable IPv6 through sysctl settings:**

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv6.conf.all.disable_ipv6=1
sysctl -w net.ipv6.conf.default.disable_ipv6=1
sysctl -w net.ipv6.route.flush=1
```

## Default Value

IPv6 is enabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Manual
