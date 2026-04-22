---
name: cis-ubuntu2004-v300-1-3-1-4
description: "Ensure all AppArmor Profiles are enforcing"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, apparmor, profiles, enforce]
cis_id: "1.3.1.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.1.4 Ensure all AppArmor Profiles are enforcing (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

AppArmor profiles define what resources applications are able to access.

## Rationale

Security configuration requirements vary from site to site. Some sites may mandate a policy that is stricter than the default policy, which is perfectly acceptable. This item is intended to ensure that any policies that exist on the system are activated.

## Audit Procedure

### Command Line

Run the following commands and verify that profiles are loaded and are not in complain mode:

```bash
# apparmor_status | grep profiles
```

Review output and ensure that profiles are loaded, and in enforce mode:

```
34 profiles are loaded.
34 profiles are in enforce mode.
0 profiles are in complain mode.
2 processes have profiles defined.
```

Run the following command and verify that no processes are unconfined:

```bash
apparmor_status | grep processes
```

Review the output and ensure no processes are unconfined:

```
2 processes have profiles defined.
2 processes are in enforce mode.
0 processes are in complain mode.
0 processes are unconfined but have a profile defined.
```

## Expected Result

- All profiles should be in enforce mode with 0 profiles in complain mode
- No processes should be unconfined

## Remediation

### Command Line

Run the following command to set all profiles to enforce mode:

```bash
# aa-enforce /etc/apparmor.d/*
```

Note: Any unconfined processes may need to have a profile created or activated for them and then be restarted.

## References

1. NIST SP 800-53 Rev. 5: AC-3

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

MITRE ATT&CK Mappings: T1068, T1068.000, T1565, T1565.001, T1565.003 | TA0005 | M1048
