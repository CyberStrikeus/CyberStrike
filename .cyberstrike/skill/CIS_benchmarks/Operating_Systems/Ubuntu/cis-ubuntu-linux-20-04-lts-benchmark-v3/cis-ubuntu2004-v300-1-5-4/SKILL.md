---
name: cis-ubuntu2004-v300-1-5-4
description: "Ensure prelink is not installed"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, prelink, hardening, integrity]
cis_id: "1.5.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.4 Ensure prelink is not installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

`prelink` is a program that modifies ELF shared libraries and ELF dynamically linked binaries in such a way that the time needed for the dynamic linker to perform relocations at startup significantly decreases.

## Rationale

The prelinking feature can interfere with the operation of AIDE, because it changes binaries. Prelinking can also increase the vulnerability of the system if a malicious user is able to compromise a common library such as libc.

## Audit Procedure

### Command Line

Verify `prelink` is not installed:

```bash
# dpkg-query -s prelink &>/dev/null && echo "prelink is installed"
```

Nothing should be returned.

## Expected Result

No output should be returned, confirming prelink is not installed.

## Remediation

### Command Line

Run the following command to restore binaries to normal:

```bash
# prelink -ua
```

Uninstall `prelink` using the appropriate package manager or manual installation:

```bash
# apt purge prelink
```

## References

1. NIST SP 800-53 Rev. 5: CM-6, CM-1, CM-3

## CIS Controls

| Controls Version | Control                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.14 Log Sensitive Data Access                                      |      |      | \*   |
| v7               | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data |      |      | \*   |

MITRE ATT&CK Mappings: T1055, T1055.009, T1065, T1065.001 | TA0002 | M1050
