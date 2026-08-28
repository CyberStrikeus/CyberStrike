---
name: cis-ubuntu2004-v300-6-1-1
description: "Ensure AIDE is installed"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, integrity]
cis_id: "6.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.1 Ensure AIDE is installed (Automated)

## Profile

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
# dpkg-query -s aide &>/dev/null && echo "aide is installed"
```

Run the following command to verify `aide-common` is installed:

```bash
# dpkg-query -s aide-common &>/dev/null && echo "aide-common is installed"
```

## Expected Result

```
aide is installed
aide-common is installed
```

## Remediation

### Command Line

Install AIDE using the appropriate package manager or manual installation:

```bash
# apt install aide aide-common
```

Configure AIDE as appropriate for your environment. Consult the AIDE documentation for options.
Run the following commands to initialize AIDE:

```bash
# aideinit
# mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db
```

## Default Value

Not installed by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2
2. STIG ID: UBTU-20-010450 | Rule ID: SV-238371r958944 | CAT II
3. STIG ID: UBTU-22-651010 | Rule ID: SV-260582r958944 | CAT II

## CIS Controls

| Controls Version | Control                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.14 Log Sensitive Data Access                                      |      |      |      |
| v7               | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1565, T1565.001            | TA0001  | M1022       |
