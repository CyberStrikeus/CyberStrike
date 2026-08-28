---
name: cis-ubuntu1804-v220-2-2-17
description: "Ensure rsync service is either not installed or is masked"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, services, rsync]
cis_id: "2.2.17"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.17 Ensure rsync service is either not installed or is masked (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `rsync` service can be used to synchronize files between systems over network links.

## Rationale

The `rsync` service presents a security risk as the rsync protocol is unencrypted. The rsync package should be removed or if required for dependencies, the rsync service should be stopped and masked to reduce the attack area of the system.

## Audit Procedure

### Command Line

Run the following command to verify `rsync` is not installed:

```bash
# dpkg-query -s rsync &>/dev/null && echo "rsync is installed"
```

Nothing should be returned.

-- OR --

Run the following commands to verify that `rsync` is inactive and masked:

```bash
# systemctl is-active rsync
inactive

# systemctl is-enabled rsync
masked
```

## Expected Result

Either rsync is not installed (no output), or rsync service is inactive and masked.

## Remediation

### Command Line

Run the following command to remove `rsync`:

```bash
# apt purge rsync
```

-- OR --

Run the following commands to stop and mask `rsync`:

```bash
# systemctl stop rsync
# systemctl mask rsync
```

## References

1. NIST SP 800-53 Rev. 5: CM-6, CM-7

## CIS Controls

- v8: 4.8 - Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
- v7: 9.2 - Ensure Only Approved Ports, Protocols and Services Are Running
