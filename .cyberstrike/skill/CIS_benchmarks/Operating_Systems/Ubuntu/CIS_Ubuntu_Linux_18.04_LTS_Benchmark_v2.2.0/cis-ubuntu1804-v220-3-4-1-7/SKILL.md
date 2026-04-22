---
name: cis-ubuntu1804-v220-3-4-1-7
description: "Ensure ufw default deny firewall policy"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, ufw]
cis_id: "3.4.1.7"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.1.7

## Description

A default deny all policy on connections ensures that any unconfigured network usage will be rejected.

## Rationale

With a default accept policy the firewall will accept any packet that is not configured to be denied. It is easier to white list acceptable usage than to black list unacceptable usage.

## Impact

Any port or protocol not explicitly allowed will be blocked. Ensure that all required ports and protocols are allowed before enabling the default deny policy.

## Audit Procedure

### Command Line

Run the following command and verify that the default policy is `deny`, `reject`, or disabled for `incoming`, `outgoing`, and `routed` directions:

```bash
ufw status verbose | grep 'Default:'
```

## Expected Result

```
Default: deny (incoming), deny (outgoing), disabled (routed)
```

or

```
Default: reject (incoming), reject (outgoing), disabled (routed)
```

## Remediation

### Command Line

Run the following commands to set the default policy to deny:

```bash
ufw default deny incoming
ufw default deny outgoing
ufw default deny routed
```

## Default Value

Default policy is allow.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.4 Implement and Manage a Firewall on Servers - Implement and manage a firewall on servers, where supported.

4.5 Implement and Manage a Firewall on End-User Devices - Implement and manage a host-based firewall or port-filtering tool on end-user devices.

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
