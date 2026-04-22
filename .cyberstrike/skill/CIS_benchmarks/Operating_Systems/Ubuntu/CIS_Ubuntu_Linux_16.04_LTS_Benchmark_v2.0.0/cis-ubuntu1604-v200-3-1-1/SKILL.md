---
name: cis-ubuntu1604-v200-3-1-1
description: "Disable IPv6"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, networking]
cis_id: "3.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.1.1

## Description

Although IPv6 has many advantages over IPv4, not all organizations have IPv6 or dual stack configurations implemented.

## Rationale

If IPv6 or dual stack is not to be used, it is recommended that IPv6 be disabled to reduce the attack surface of the system.

## Impact

If IPv6 is disabled through sysctl config, `SSH X11forwarding` may no longer function as expected. We recommend that SSH X11fowarding be disabled, but if required, the following will allow for `SSH X11forwarding` with IPv6 disabled through sysctl config:

Add the following line the `/etc/ssh/sshd_config` file:

```
AddressFamily inet
```

Run the following command to re-start the openSSH server:

```bash
systemctl restart sshd
```

## Audit Procedure

### Command Line

Run one of the following commands to verify IPv6 is disabled:

*IF IPv6 is disabled through grub:*

Run the following command:

```bash
grep "^\s*linux" /boot/grub/grub.cfg | grep -v "ipv6.disable=1"
```

No lines should be returned.

*OR*

*IF IPv6 is disabled through sysctl settings:*

Run the following commands:

```bash
sysctl net.ipv6.conf.all.disable_ipv6
```

```bash
sysctl net.ipv6.conf.default.disable_ipv6
```

```bash
grep -E '^\s*net\.ipv6\.conf\.(all|default)\.disable_ipv6\s*=\s*1\b(\s+#.*)?$' /etc/sysctl.conf /etc/sysctl.d/*.conf | cut -d: -f2
```

## Expected Result

For grub method: no lines should be returned.

For sysctl method:
```
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
```

And the grep should return:
```
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
```

## Remediation

### Command Line

Use **one** of the two following methods to disable IPv6 on the system:

*To disable IPv6 through the GRUB2 config:*

Edit `/etc/default/grub` and add `ipv6.disable=1` to the `GRUB_CMDLINE_LINUX` parameters:

```
GRUB_CMDLINE_LINUX="ipv6.disable=1"
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

*OR*

*To disable IPv6 through sysctl settings:*

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

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Assessment Status

Manual
