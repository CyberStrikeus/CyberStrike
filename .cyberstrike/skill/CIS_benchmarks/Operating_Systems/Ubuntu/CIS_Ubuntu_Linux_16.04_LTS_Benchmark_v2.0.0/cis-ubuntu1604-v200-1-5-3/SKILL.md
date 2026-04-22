---
name: cis-ubuntu1604-v200-1-5-3
description: "Ensure prelink is disabled"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, prelink, file-integrity, hardening]
cis_id: "1.5.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.5.3

## Profile Applicability

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
dpkg -s prelink | grep -E '(Status:|not installed)'
```

Expected output: `dpkg-query: package 'prelink' is not installed and no information is available`

## Expected Result

The `prelink` package should not be installed.

## Remediation

### Command Line

Run the following command to restore binaries to normal:

```bash
prelink -ua
```

Uninstall `prelink` using the appropriate package manager or manual installation:

```bash
apt purge prelink
```

## Default Value

prelink is not installed by default.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data |

## Assessment Status

Automated
