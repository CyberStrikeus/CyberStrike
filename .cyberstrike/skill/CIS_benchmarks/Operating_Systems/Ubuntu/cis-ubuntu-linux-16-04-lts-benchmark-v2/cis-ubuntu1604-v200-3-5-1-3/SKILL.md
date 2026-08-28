---
name: cis-ubuntu1604-v200-3-5-1-3
description: "Ensure ufw service is enabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.1.3

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Uncomplicated Firewall (ufw) is a frontend for iptables. ufw provides a framework for managing netfilter, as well as a command-line and available graphical user interface for manipulating the firewall.

Notes:

- When running ufw enable or starting ufw via its initscript, ufw will flush its chains. This is required so ufw can maintain a consistent state, but it may drop existing connections (eg ssh). ufw does support adding rules before enabling the firewall.
- Run the following command before running ufw enable: `ufw allow proto tcp from any to any port 22`
- The rules will still be flushed, but the ssh port will be open after enabling the firewall. Please note that once ufw is 'enabled', ufw will not flush the chains when adding or removing rules (but will when modifying a rule or changing the default policy).
- By default, ufw will prompt when enabling the firewall while running under ssh. This can be disabled by using `ufw --force enable`.

## Rationale

The ufw service must be enabled and running in order for ufw to protect the system.

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

## Audit Procedure

### Command Line

Run the following command to verify that ufw is enabled:

```bash
systemctl is-enabled ufw
```

Run the following command to verify that ufw is running:

```bash
ufw status | grep Status
```

## Expected Result

```
enabled
```

```
Status: active
```

## Remediation

### Command Line

Run the following command to enable ufw:

```bash
ufw enable
```

## References

1. http://manpages.ubuntu.com/manpages/precise/en/man8/ufw.8.html

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
