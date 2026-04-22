---
name: cis-ubuntu1604-v200-1-3-1
description: "Ensure AIDE is installed"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, aide, file-integrity, filesystem]
cis_id: "1.3.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.3.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

AIDE takes a snapshot of filesystem state including modification times, permissions, and file hashes which can then be used to compare against the current state of the filesystem to detect modifications to the system.

## Rationale

By monitoring the filesystem state compromised files can be detected to prevent or limit the exposure of accidental or malicious misconfigurations or modified binaries.

## Audit Procedure

### Command Line

Run the following commands to verify AIDE is installed:

```bash
dpkg -s aide | grep -E '(Status:|not installed)'
```

Expected output: `Status: install ok installed`

```bash
dpkg -s aide-common | grep -E '(Status:|not installed)'
```

Expected output: `Status: install ok installed`

## Expected Result

Both `aide` and `aide-common` packages should show `Status: install ok installed`.

## Remediation

### Command Line

Install AIDE using the appropriate package manager or manual installation:

```bash
apt install aide aide-common
```

Configure AIDE as appropriate for your environment. Consult the AIDE documentation for options.

Run the following commands to initialize AIDE:

```bash
aideinit
mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db
```

## Additional Information

The prelinking feature can interfere with AIDE because it alters binaries to speed up their start up times. Run `prelink -ua` to restore the binaries to their prelinked state, thus avoiding false positives from AIDE.

## Default Value

AIDE is not installed by default.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data |

## Assessment Status

Automated
