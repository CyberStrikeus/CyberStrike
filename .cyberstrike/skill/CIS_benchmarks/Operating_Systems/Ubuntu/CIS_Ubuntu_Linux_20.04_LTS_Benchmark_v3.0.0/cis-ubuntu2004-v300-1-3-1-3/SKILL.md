---
name: cis-ubuntu2004-v300-1-3-1-3
description: "Ensure all AppArmor Profiles are not disabled"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, apparmor, profiles, mandatory-access-control]
cis_id: "1.3.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.1.3 Ensure all AppArmor Profiles are not disabled (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

AppArmor profiles define what resources applications are able to access.

## Rationale

Security configuration requirements vary from site to site. Some sites may mandate a policy that is stricter than the default policy, which is perfectly acceptable. This item is intended to ensure that any policies that exist on the system are activated.

## Audit Procedure

### Command Line

Run the following command and verify that profiles are loaded, and are in either enforce or complain mode:

```bash
# apparmor_status | grep profiles
```

Review output and ensure that profiles are loaded, and in either enforce or complain mode:

```
37 profiles are loaded.
35 profiles are in enforce mode.
2 profiles are in complain mode.
4 processes have profiles defined.
```

Run the following command and verify no processes are unconfined:

```bash
# apparmor_status | grep processes
```

Review the output and ensure no processes are unconfined:

```
4 processes have profiles defined.
4 processes are in enforce mode.
0 processes are in complain mode.
0 processes are unconfined but have a profile defined.
```

## Expected Result

- Profiles should be loaded and in either enforce or complain mode
- No processes should be unconfined

## Remediation

### Command Line

Run the following command to set all profiles to enforce mode:

```bash
# aa-enforce /etc/apparmor.d/*
```

- OR -

Run the following command to set all profiles to complain mode:

```bash
# aa-complain /etc/apparmor.d/*
```

Note: Any unconfined processes may need to have a profile created or activated for them and then be restarted.

## References

1. NIST SP 800-53 Rev. 5: AC-3

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

MITRE ATT&CK Mappings: T1497 | TA0005
