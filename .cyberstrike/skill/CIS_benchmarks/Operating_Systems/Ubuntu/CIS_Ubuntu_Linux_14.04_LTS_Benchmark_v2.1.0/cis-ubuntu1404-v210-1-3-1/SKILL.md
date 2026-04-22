---
name: "CIS Ubuntu 14.04 LTS - 1.3.1 Ensure AIDE is installed"
description: "Verify that AIDE file integrity checking tool is installed for filesystem monitoring"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - integrity
cis_id: "1.3.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with:
  - cis-ubuntu1404-v210-1-3-2
prerequisites: []
severity_boost: "medium"
---

# 1.3.1 Ensure AIDE is installed (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

AIDE takes a snapshot of filesystem state including modification times, permissions, and file hashes which can then be used to compare against the current state of the filesystem to detect modifications to the system.

## Rationale

By monitoring the filesystem state compromised files can be detected to prevent or limit the exposure of accidental or malicious misconfigurations or modified binaries.

## Audit Procedure

Run the following command and verify AIDE is installed:

```bash
dpkg -s aide
```

## Expected Result

The output should show that the `aide` package is installed with status `install ok installed`.

## Remediation

Run the following command to install AIDE:

```bash
apt-get install aide aide-common
```

Configure AIDE as appropriate for your environment. Consult the AIDE documentation for options. Initialize AIDE:

```bash
aideinit
```

## Default Value

AIDE is not installed by default.

## Notes

The prelinking feature can interfere with AIDE because it alters binaries to speed up their start up times. Run `prelink -ua` to restore the binaries to their prelinked state, thus avoiding false positives from AIDE.

## References

1. AIDE stable manual: http://aide.sourceforge.net/stable/manual.html

## Profile

- Level 1 - Server
- Level 1 - Workstation
