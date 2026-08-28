---
name: cis-ubuntu1604-v200-1-8-1
description: "Ensure GNOME Display Manager is removed"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, gdm, gnome, display-manager, attack-surface]
cis_id: "1.8.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.8.1

## Profile Applicability

- Level 2 - Server

## Description

The GNOME Display Manager (GDM) is a program that manages graphical display servers and handles graphical user logins.

## Rationale

If a Graphical User Interface (GUI) is not required, it should be removed to reduce the attack surface of the system.

## Impact

Removing the GNOME Display manager will remove the Graphical User Interface (GUI) from the system.

## Audit Procedure

### Command Line

Run the following command and verify `gdm3` is not installed:

```bash
dpkg -s gdm3 | grep -E '(Status:|not installed)'
```

Expected output: `dpkg-query: package 'gdm3' is not installed and no information is available`

## Expected Result

The `gdm3` package should not be installed on server systems.

## Remediation

### Command Line

Run the following command to uninstall `gdm3`:

```bash
apt purge gdm3
```

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control                         |
| ---------------- | ------------------------------- |
| v7               | 2.6 Address unapproved software |

## Assessment Status

Manual
