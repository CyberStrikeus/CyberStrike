---
name: cis-ubuntu2004-v300-2-3-3-2
description: "Ensure chrony is running as user _chrony"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, time-sync, chrony]
cis_id: "2.3.3.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure chrony is running as user \_chrony

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The chrony package is installed with a dedicated user account \_chrony. This account is granted the access required by the chronyd service

## Rationale

The chronyd service should run with only the required privilidges

## Audit

- IF - chrony is in use on the system, run the following command to verify the chronyd service is being run as the \_chrony user:

### Command Line

```bash
# ps -ef | awk '(/[c]hronyd/ && $1!="_chrony") { print $1 }'
```

## Expected Result

Nothing should be returned

## Remediation

Add or edit the user line to /etc/chrony/chrony.conf or a file ending in .conf in /etc/chrony/conf.d/:

### Command Line

```
user _chrony
```

**- OR -**

If another time synchronization service is in use on the system, run the following command to remove chrony from the system:

```bash
# apt purge chrony
# apt autoremove chrony
```

## Default Value

user \_chrony

## References

1. NIST SP 800-53 Rev. 5: AU-8

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 0.0 Explicitly Not Mapped<br/>Explicitly Not Mapped |      |      |      |
| v7               | 0.0 Explicitly Not Mapped<br/>Explicitly Not Mapped |      |      |      |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1562, T1562.001 | TA0002  | M1022       |
