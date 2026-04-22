---
name: cis-ubuntu2004-v300-4-3-10
description: "Ensure nftables rules are permanent"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.10"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.10

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

nftables is a subsystem of the Linux kernel providing filtering and classification of network packets/datagrams/frames.

The nftables service reads the `/etc/nftables.conf` file for a nftables file or files to include in the nftables ruleset.

A nftables ruleset containing the input, forward, and output base chains allow network traffic to be filtered.

Note: Saving the script and following the instruction in the Configure nftables section overview will implement the rules in the configure nftable section, open port 22(ssh) from anywhere, and applies nftables ruleset on boot.

## Rationale

Changes made to nftables ruleset only affect the live system, you will also need to configure the nftables ruleset to apply on boot

## Audit Procedure

### Command Line

Run the following commands to verify that input, forward, and output base chains are configured to be applied to a nftables ruleset on boot:
Run the following command to verify the input base chain:

```bash
[ -n "$(grep -E '^\s*include' /etc/nftables.conf)" ] && awk '/hook input/,/}/' $(awk '$1 ~ /^\s*include/ { gsub("\"","",$2);print $2 }' /etc/nftables.conf)
```

Output should be similar to:

```
        type filter hook input priority 0; policy drop;

        # Ensure loopback traffic is configured
        iif "lo" accept
        ip saddr 127.0.0.0/8 counter packets 0 bytes 0 drop
        ip6 saddr ::1 counter packets 0 bytes 0 drop

        # Ensure established connections are configured
        ip protocol tcp ct state established accept
        ip protocol udp ct state established accept

        # Accept port 22(SSH) traffic from anywhere
        tcp dport ssh accept
```

Review the input base chain to ensure that it follows local site policy
Run the following command to verify the forward base chain:

```bash
[ -n "$(grep -E '^\s*include' /etc/nftables.conf)" ] && awk '/hook forward/,/}/' $(awk '$1 ~ /^\s*include/ { gsub("\"","",$2);print $2 }' /etc/nftables.conf)
```

Output should be similar to:

```
    # Base chain for hook forward named forward (Filters forwarded network packets)
    chain forward {
            type filter hook forward priority 0; policy drop;
    }
```

Review the forward base chain to ensure that it follows local site policy.
Run the following command to verify the output base chain:

```bash
[ -n "$(grep -E '^\s*include' /etc/nftables.conf)" ] && awk '/hook output/,/}/' $(awk '$1 ~ /^\s*include/ { gsub("\"","",$2);print $2 }' /etc/nftables.conf)
```

Output should be similar to:

```
    # Base chain for hook output named output (Filters outbound network packets)
    chain output {
            type filter hook output priority 0; policy drop;
            # Ensure outbound and established connections are configured
            ip protocol tcp ct state established,related,new accept
            ip protocol udp ct state established,related,new accept

    }
```

Review the output base chain to ensure that it follows local site policy.

## Expected Result

All three base chains (input, forward, output) are present in the nftables configuration files referenced by `/etc/nftables.conf`.

## Remediation

### Command Line

Edit the `/etc/nftables.conf` file and un-comment or add a line with `include <Absolute path to nftables rules file>` for each nftables file you want included in the nftables ruleset on boot
Example:

```bash
vi /etc/nftables.conf
```

Add the line:

```
include "/etc/nftables.rules"
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031
