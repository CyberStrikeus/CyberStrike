---
name: "CIS Ubuntu 14.04 LTS - 1.6.2.2 Ensure all AppArmor Profiles are enforcing"
description: "Verify that all AppArmor profiles are loaded and in enforcing mode with no unconfined processes"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - mac
cis_id: "1.6.2.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with:
  - cis-ubuntu1404-v210-1-6-2-1
prerequisites:
  - cis-ubuntu1404-v210-1-6-2-1
severity_boost: "high"
---

# 1.6.2.2 Ensure all AppArmor Profiles are enforcing (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

AppArmor profiles define what resources applications are able to access.

## Rationale

Security configuration requirements vary from site to site. Some sites may mandate a policy that is stricter than the default policy, which is perfectly acceptable. This item is intended to ensure that any policies that exist on the system are activated.

## Audit Procedure

Run the following command and verify that profiles are loaded, no profiles are in complain mode, and no processes are unconfined:

```bash
apparmor_status
```

## Expected Result

```
apparmor module is loaded.
X profiles are loaded.
X profiles are in enforce mode.
0 profiles are in complain mode.
X processes have profiles defined.
X processes are in enforce mode.
0 processes are in complain mode.
0 processes are unconfined but have a profile defined.
```

## Remediation

Run the following command to set all profiles to enforce mode:

```bash
aa-enforce /etc/apparmor.d/*
```

Any unconfined processes may need to have a profile created or activated for them and then be restarted.

## Default Value

AppArmor profiles are loaded in enforce mode by default on Ubuntu.

## References

- CIS Controls: 14.4 Protect Information With Access Control Lists

## Profile

- Level 2 - Server
- Level 2 - Workstation
