---
name: cis-ubuntu1604-v200-3-5-3-3-4
description: "Ensure ip6tables firewall rules exist for all open ports"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.3.3.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.3.3.4

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Any ports that have been opened on non-loopback addresses need firewall rules to govern traffic.

Note:

- Changing firewall settings while connected over network can result in being locked out of the system.
- Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.
- The remediation command opens up the port to traffic from all sources. Consult iptables documentation and set any restrictions in compliance with site policy.

## Rationale

Without a firewall rule configured for open ports default firewall policy will drop all packets to these ports.

## Audit Procedure

### Command Line

Run the following command to determine open ports:

```bash
ss -6tuln
```

Run the following command to determine firewall rules:

```bash
ip6tables -L INPUT -v -n
```

Verify all open ports listening on non-localhost addresses have at least one firewall rule. The last line identified by the "tcp dpt:22 state NEW" identifies it as a firewall rule for new connections on tcp port 22.

OR verify IPv6 is disabled. Run the following script. Output will confirm if IPv6 is disabled on the system.

```bash
#!/usr/bin/bin/bash

output=""
grubfile="$(find -L /boot -name 'grub.cfg' -type f)"
[ -f "$grubfile" ] && ! grep "^\s*linux" "$grubfile" | grep -vq ipv6.disable=1 && output="ipv6 disabled in grub config"
grep -Eqs "^\s*net\.ipv6\.conf\.all\.disable_ipv6\s*=\s*1\b" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /run/sysctl.d/*.conf && grep -Eqs "^\s*net\.ipv6\.conf\.default\.disable_ipv6\s*=\s*1\b" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /run/sysctl.d/*.conf && sysctl net.ipv6.conf.all.disable_ipv6 | grep -Eq "^\s*net\.ipv6\.conf\.all\.disable_ipv6\s*=\s*1\b" && sysctl net.ipv6.conf.default.disable_ipv6 | grep -Eq "^\s*net\.ipv6\.conf\.default\.disable_ipv6\s*=\s*1\b" && output="ipv6 disabled in sysctl config"
[ -n "$output" ] && echo -e "\n$output" || echo -e "\n*** IPv6 is enabled on the system ***"
```

## Remediation

### Command Line

For each port identified in the audit which does not have a firewall rule establish a proper rule for accepting inbound connections:

```bash
ip6tables -A INPUT -p <protocol> --dport <port> -m state --state NEW -j ACCEPT
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
