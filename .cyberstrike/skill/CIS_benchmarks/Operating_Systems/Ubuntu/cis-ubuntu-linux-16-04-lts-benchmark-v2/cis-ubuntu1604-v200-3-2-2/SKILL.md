---
name: cis-ubuntu1604-v200-3-2-2
description: "Ensure IP forwarding is disabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, networking]
cis_id: "3.2.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.2.2

## Description

The `net.ipv4.ip_forward` and `net.ipv6.conf.all.forwarding` flags are used to tell the system whether it can forward packets or not.

## Rationale

Setting the flags to 0 ensures that a system with multiple interfaces (for example, a hard proxy), will never be able to forward packets, and therefore, never serve as a router.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.ip_forward
```

```bash
grep -E -s "^\s*net\.ipv4\.ip_forward\s*=\s*1" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /run/sysctl.d/*.conf
```

No value should be returned.

_IF IPv6 is enabled:_

Run the following commands and verify output matches:

```bash
sysctl net.ipv6.conf.all.forwarding
```

```bash
grep -E -s "^\s*net\.ipv6\.conf\.all\.forwarding\s*=\s*1" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /run/sysctl.d/*.conf
```

No value should be returned.

_OR verify IPv6 is disabled:_

Run the following script. Output will confirm if IPv6 is disabled on the system.

```bash
#!/usr/bin/bash
output=""
grubfile="$(find -L /boot -name 'grub.cfg' -type f)"
[ -f "$grubfile" ] && ! grep "^\s*linux" "$grubfile" | grep -vq ipv6.disable=1 && output="ipv6 disabled in grub config"
grep -Eqs "^\s*net\.ipv6\.conf\.all\.disable_ipv6\s*=\s*1\b" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /run/sysctl.d/*.conf && grep -Eqs "^\s*net\.ipv6\.conf\.default\.disable_ipv6\s*=\s*1\b" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /run/sysctl.d/*.conf && sysctl net.ipv6.conf.all.disable_ipv6 | grep -Eq "^\s*net\.ipv6\.conf\.all\.disable_ipv6\s*=\s*1\b" && sysctl net.ipv6.conf.default.disable_ipv6 | grep -Eq "^\s*net\.ipv6\.conf\.default\.disable_ipv6\s*=\s*1\b" && output="ipv6 disabled in sysctl config"
[ -n "$output" ] && echo -e "\n$output" || echo -e "\n*** IPv6 is enabled on the system ***"
```

## Expected Result

```
net.ipv4.ip_forward = 0
```

No value returned from the grep command.

For IPv6 (if enabled):

```
net.ipv6.conf.all.forwarding = 0
```

No value returned from the grep command.

## Remediation

### Command Line

Run the following command to restore the default parameter and set the active kernel parameter:

```bash
grep -Els "^\s*net\.ipv4\.ip_forward\s*=\s*1" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /run/sysctl.d/*.conf | while read filename; do sed -ri "s/^\s*(net\.ipv4\.ip_forward\s*)(=)(\s*\S+\b).*$/# *REMOVED* \1/" $filename; done; sysctl -w net.ipv4.ip_forward=0; sysctl -w net.ipv4.route.flush=1
```

_IF IPv6 is enabled:_

Run the following command to restore the default parameter and set the active kernel parameter:

```bash
grep -Els "^\s*net\.ipv6\.conf\.all\.forwarding\s*=\s*1" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /run/sysctl.d/*.conf | while read filename; do sed -ri "s/^\s*(net\.ipv6\.conf\.all\.forwarding\s*)(=)(\s*\S+\b).*$/# *REMOVED* \1/" $filename; done; sysctl -w net.ipv6.conf.all.forwarding=0; sysctl -w net.ipv6.route.flush=1
```

## Default Value

IP forwarding is disabled (set to 0) by default.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0

## CIS Controls

Version 7

5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
