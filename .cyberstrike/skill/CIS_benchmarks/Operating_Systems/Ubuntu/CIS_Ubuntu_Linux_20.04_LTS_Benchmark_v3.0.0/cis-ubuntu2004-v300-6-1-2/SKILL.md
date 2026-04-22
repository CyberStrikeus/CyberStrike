---
name: cis-ubuntu2004-v300-6-1-2
description: "Ensure filesystem integrity is regularly checked"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, integrity]
cis_id: "6.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.2 Ensure filesystem integrity is regularly checked (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Periodic checking of the filesystem integrity is needed to detect changes to the filesystem.

## Rationale

Periodic file checking allows the system administrator to determine on a regular basis if critical files have been changed in an unauthorized fashion.

## Audit Procedure

### Command Line

Run the following command:

```bash
# systemctl list-unit-files | awk '$1~/^dailyaidecheck\.(timer|service)$/{print $1 "\t" $2}'
```

Example output:

```
dailyaidecheck.service  static
dailyaidecheck.timer    enabled
```

Verify `dailyaidecheck.timer` is `enabled` and `dailyaidecheck.service` is either `static` or `enabled`.

Run the following command to verify `dailyaidecheck.timer` is active:

```bash
# systemctl is-active dailyaidecheck.timer
```

## Expected Result

```
active
```

## Remediation

### Command Line

Run the following command to unmask `dailyaidecheck.timer` and `dailyaidecheck.service`:

```bash
# systemctl unmask dailyaidecheck.timer dailyaidecheck.service
```

Run the following command to enable and start `dailyaidecheck.timer`:

```bash
# systemctl --now enable dailyaidecheck.timer
```

## Default Value

Not configured by default.

## References

1. https://github.com/konstruktoid/hardening/blob/master/config/aidecheck.service
2. https://github.com/konstruktoid/hardening/blob/master/config/aidecheck.timer
3. NIST SP 800-53 Rev. 5: AU-2

## CIS Controls

| Controls Version | Control                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.14 Log Sensitive Data Access                                      |      |      |      |
| v7               | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques                                         | Tactics | Mitigations |
| ------------------------------------------------------------------- | ------- | ----------- |
| T1036, T1036.002, T1036.003, T1036.004, T1036.005, T1565, T1565.001 | TA0040  | M1022       |
