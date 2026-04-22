---
name: cis-ubuntu1604-v200-1-6-1-4
description: "Ensure all AppArmor Profiles are enforcing"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, apparmor, profiles, mac, enforce]
cis_id: "1.6.1.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.6.1.4

## Profile Applicability

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
apparmor_status | grep profiles
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

All profiles should be in enforce mode with 0 profiles in complain mode. No processes should be unconfined.

## Remediation

### Command Line

Run the following command to set all profiles to enforce mode:

```bash
aa-enforce /etc/apparmor.d/*
```

*Note: Any unconfined processes may need to have a profile created or activated for them and then be restarted.*

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 14.6 Protect Information through Access Control Lists |

## Assessment Status

Automated
