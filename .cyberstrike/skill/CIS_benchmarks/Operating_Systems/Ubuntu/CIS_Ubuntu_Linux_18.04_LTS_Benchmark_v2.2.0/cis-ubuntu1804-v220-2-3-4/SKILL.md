---
name: cis-ubuntu1804-v220-2-3-4
description: "Ensure telnet client is not installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, telnet-client]
cis_id: "2.3.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.3.4 Ensure telnet client is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `telnet` package contains the `telnet` client, which allows users to start connections to other systems via the telnet protocol.

## Rationale

The `telnet` protocol is insecure and unencrypted. The use of an unencrypted transmission medium could allow an unauthorized user to steal credentials. The `ssh` package provides an encrypted session and stronger security and is included in most Linux distributions.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## Audit Procedure

### Command Line

Verify `telnet` is not installed. Use the following command to provide the needed information:

```bash
# dpkg-query -s telnet &>/dev/null && echo "telnet is installed"
```

Nothing should be returned.

## Expected Result

No output (empty result).

## Remediation

### Command Line

Uninstall `telnet`:

```bash
# apt purge telnet
```

## References

1. NIST SP 800-53 Rev. 5: CM-7, CM-11

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
