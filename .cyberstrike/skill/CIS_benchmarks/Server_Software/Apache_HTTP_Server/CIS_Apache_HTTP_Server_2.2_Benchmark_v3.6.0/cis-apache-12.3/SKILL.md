---
name: cis-apache-12.3
description: "Ensure the Apache AppArmor Profile Is in Enforce Mode"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, apparmor, mandatory-access-control, mac]
cis_id: "12.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Apache AppArmor Profile Is in Enforce Mode

## Description

AppArmor profiles may be in one of three modes: disabled, complain, or enforce. In the complain mode, any violations of the access controls are logged but the restrictions are not enforced. Also, once a profile mode has been changed, it is recommended to restart the Apache server, otherwise the currently running process may not be confined by the policy.

## Rationale

The complain mode is useful for testing and debugging a profile but is not appropriate for production. Only the confined process running in enforce mode will prevent attacks that violate the configured access controls.

## Impact

None documented

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Use the `aa-unconfined` command to check that the apache2 policy is enforced, and that the currently running apache2 processes are confined. The output should include both `confined by` and `(enforce)`.

```bash
# aa-unconfined --paranoid | grep apache2
1899 /usr/sbin/apache2 confined by '/usr/sbin/apache2 (enforce)'
1902 /usr/sbin/apache2 confined by '/usr/sbin/apache2 (enforce)'
1903 /usr/sbin/apache2 confined by '/usr/sbin/apache2 (enforce)'
. . .
```

Note that non-compliant results may include `not confined` or `(complain)`, such as the following:

```bash
3304 /usr/sbin/apache2 not confined
2502 /usr/sbin/apache2 confined by '/usr/sbin/apache2 (complain)'
4004 /usr/sbin/apache2 confined by
'/usr/sbin/apache2//HANDLING_UNTRUSTED_INPUT (complain)'
```

## Remediation

Perform the following to implement the recommended state:

1. Set the profile state to enforce mode.

```bash
# aa-enforce /usr/sbin/apache2
# /etc/init.d/apparmor reload
```

## Default Value

The default Apache profile is very permissive.

## References

1. https://wiki.ubuntu.com/AppArmor

## CIS Controls

Version 6

2 Inventory of Authorized and Unauthorized Software
Inventory of Authorized and Unauthorized Software

Version 7

14.7 Enforce Access Control to Data through Automated Tools
Use an automated tool, such as host-based Data Loss Prevention, to enforce access controls to data even when data is copied off a system.

## Profile

Level 2 | Scored
