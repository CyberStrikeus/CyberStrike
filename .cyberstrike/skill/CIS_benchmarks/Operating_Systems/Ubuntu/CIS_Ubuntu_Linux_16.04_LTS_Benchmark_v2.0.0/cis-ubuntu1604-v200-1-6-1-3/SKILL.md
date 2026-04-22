---
name: cis-ubuntu1604-v200-1-6-1-3
description: "Ensure all AppArmor Profiles are in enforce or complain mode"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, apparmor, profiles, mac, enforce, complain]
cis_id: "1.6.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.6.1.3

## Profile Applicability

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
apparmor_status | grep profiles
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
apparmor_status | grep processes
```

Review the output and ensure no processes are unconfined:

```
4 processes have profiles defined.
4 processes are in enforce mode.
0 processes are in complain mode.
0 processes are unconfined but have a profile defined.
```

## Expected Result

All profiles should be in enforce or complain mode. No processes should be unconfined but have a profile defined.

## Remediation

### Command Line

Run the following command to set all profiles to enforce mode:

```bash
aa-enforce /etc/apparmor.d/*
```

*OR*

Run the following command to set all profiles to complain mode:

```bash
aa-complain /etc/apparmor.d/*
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
