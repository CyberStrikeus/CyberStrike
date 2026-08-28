---
name: cis-ubuntu1804-v220-4-2-7
description: "Ensure sshd DisableForwarding is enabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.7"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.7

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

`DisableForwarding` disables all forwarding features, including X11, ssh-agent, TCP and StreamLocal. This overrides all other forwarding-related options and can simplify restricted configurations.

## Rationale

Leaving port forwarding mechanisms enabled can expose the organization to security risks and back-channels. SSH includes a port-forwarding mechanism that enables tunneling of network protocols and allows for unauthorized communication to bypass firewall restrictions.

## Impact

SSH tunnels are widely used in many corporate environments. In some environments the applications themselves may have limited native support for security and may rely on SSH tunnels for encryption and security. Disabling SSH forwarding may impact these systems. Review the need for SSH forwarding before disabling it.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i disableforwarding
```

### Expected Result

```
disableforwarding yes
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
DisableForwarding yes
```

## Default Value

DisableForwarding no

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

v7 - 9.2 Ensure Only Approved Ports, Protocols, and Services Are Running.

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Assessment Status

Automated
