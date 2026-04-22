---
name: cis-ubuntu1804-v220-1-2-1
description: "Ensure AIDE is installed"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, aide, file-integrity, filesystem]
cis_id: "1.2.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.1 Ensure AIDE is installed (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

AIDE takes a snapshot of filesystem state including modification times, permissions, and file hashes which can then be used to compare against the current state of the filesystem to detect modifications to the system.

## Rationale

By monitoring the filesystem state compromised files can be detected to prevent or limit the exposure of accidental or malicious misconfigurations or modified binaries.

## Audit Procedure

### Command Line

Run the following command to verify `aide` is installed:

```bash
dpkg-query -s aide &>/dev/null && echo "aide is installed"
```

Run the following command to verify `aide-common` is installed:

```bash
dpkg-query -s aide-common &>/dev/null && echo "aide-common is installed"
```

## Expected Result

```
aide is installed
aide-common is installed
```

## Remediation

### Command Line

Run the following command to install `aide` and `aide-common`:

```bash
apt install aide aide-common
```

Run the following commands to initialize AIDE:

```bash
aideinit
mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db
```

## References

1. NIST SP 800-53 Rev. 5: AU-2

## Additional Information

The prelinking feature can interfere with AIDE because it alters binaries to speed up their start up times. Run `prelink -ua` to restore the binaries to their prelinked state, thus avoiding false positives from AIDE.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.14 Log Sensitive Data Access | | | X |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data | | | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1565, T1565.001 | TA0001 | M1022 |
