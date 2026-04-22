---
name: cis-ubuntu2004-v300-4-2-4
description: "Ensure ufw service is enabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, ufw]
cis_id: "4.2.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.2.4

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

UncomplicatedFirewall (ufw) is a frontend for iptables. ufw provides a framework for managing netfilter, as well as a command-line and available graphical user interface for manipulating the firewall.

Note:
- When running ufw enable or starting ufw via its initscript, ufw will flush its chains. This is required so ufw can maintain a consistent state, but it may drop existing connections (eg ssh). ufw does support adding rules before enabling the firewall.
- Run the following command before running `ufw enable`.

```bash
ufw allow proto tcp from any to any port 22
```

- The rules will still be flushed, but the ssh port will be open after enabling the firewall. Please note that once ufw is 'enabled', ufw will not flush the chains when adding or removing rules (but will when modifying a rule or changing the default policy)
- By default, ufw will prompt when enabling the firewall while running under ssh. This can be disabled by using `ufw --force enable`

## Rationale

The ufw service must be enabled and running in order for ufw to protect the system

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

## Audit Procedure

### Command Line

Run the following command to verify that the `ufw` daemon is enabled:

```bash
systemctl is-enabled ufw.service
```

Run the following command to verify that the `ufw` daemon is active:

```bash
systemctl is-active ufw
```

Run the following command to verify ufw is active:

```bash
ufw status
```

## Expected Result

```
enabled
active
Status: active
```

## Remediation

### Command Line

Run the following command to unmask the `ufw` daemon:

```bash
systemctl unmask ufw.service
```

Run the following command to enable and start the `ufw` daemon:

```bash
systemctl --now enable ufw.service
```

Run the following command to enable ufw:

```bash
ufw enable
```

## Default Value

Not applicable.

## References

1. http://manpages.ubuntu.com/manpages/precise/en/man8/ufw.8.html
2. NIST SP 800-53 Rev. 5: SC-7
3. STIG ID: UBTU-20-010434 | Rule ID: SV-238355r958672 | CAT II
4. STIG ID: UBTU-22-251015 | Rule ID: SV-260515r958672 | CAT II

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0005 | M1018
