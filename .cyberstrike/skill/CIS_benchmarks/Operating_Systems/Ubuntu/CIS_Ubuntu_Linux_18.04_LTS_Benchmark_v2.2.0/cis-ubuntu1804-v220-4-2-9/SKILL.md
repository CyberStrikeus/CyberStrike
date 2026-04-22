---
name: cis-ubuntu1804-v220-4-2-9
description: "Ensure sshd HostbasedAuthentication is disabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.9"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.9

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `HostbasedAuthentication` parameter specifies if authentication is allowed through trusted hosts via the user of `.rhosts`, or `/etc/hosts.equiv`, along with successful public key client host authentication.

## Rationale

Even though `.rhosts` files are ineffective if support is disabled in `/etc/pam.conf`, disabling the ability to use `.rhosts` files in SSH provides an additional layer of protection.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -i hostbasedauthentication
```

### Expected Result

```
hostbasedauthentication no
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```bash
HostbasedAuthentication no
```

## Default Value

HostbasedAuthentication no

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software.

v7 - 9.2 Ensure Only Approved Ports, Protocols, and Services Are Running.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
