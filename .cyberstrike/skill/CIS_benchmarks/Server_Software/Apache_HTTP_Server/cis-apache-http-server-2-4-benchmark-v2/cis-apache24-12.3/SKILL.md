---
name: cis-apache24-12.3
description: "Ensure Apache AppArmor Profile is in Enforce Mode"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, apparmor, hardening]
cis_id: "12.3"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.3 Ensure Apache AppArmor Profile is in Enforce Mode

## Profile Applicability

- Level 2

## Description

AppArmor profiles may be in one of three modes: disabled, complain or enforce. In the `complain` mode, any violations of the access controls are logged but the restrictions are not enforced. Also, once a profile mode has been changed, it is recommended to restart the Apache server, otherwise the currently running process may not be confined by the policy.

## Rationale

The `complain` mode is useful for testing and debugging a profile, but is not appropriate for production. Only the confined process running in enforce mode will prevent attacks that violate the configured access controls.

## Audit

Perform the following steps to determine if the recommended state is implemented:

Use the `aa-unconfined` command to check that the apache2 policy is enforced, and that the currently running apache2 processes are confined. The output should include both `confined by` and `(enforce)`.

```
# aa-unconfined --paranoid | grep apache2
1899 /usr/sbin/apache2 confined by '/usr/sbin/apache2 (enforce)'
1902 /usr/sbin/apache2 confined by '/usr/sbin/apache2 (enforce)'
1903 /usr/sbin/apache2 confined by '/usr/sbin/apache2 (enforce)'
...
```

**Note:** Non-compliant results may include `not confined` or `(complain)` such as the following:

```
3304 /usr/sbin/apache2 not confined
2502 /usr/sbin/apache2 confined by '/usr/sbin/apache2 (complain)'
4004 /usr/sbin/apache2 confined by
'/usr/sbin/apache2//HANDLING_UNTRUSTED_INPUT (complain)'
```

## Remediation

Perform the following to implement the recommended state:

1. Set the profile state to enforce mode.
2. `# aa-enforce apache2`
3. Setting /usr/sbin/apache2 to enforce mode.

## Default Value

The default Apache profile is very permissive.

## References

1. https://wiki.ubuntu.com/AppArmor

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 2.5 Allowlist Authorized Software<br>Use technical controls, such as application allowlisting, to ensure that only authorized software can execute or be accessed. Reassess bi-annually, or more frequently.          |      | ●    | ●    |
| v7               | 2.7 Utilize Application Whitelisting<br>Utilize application whitelisting technology on all assets to ensure that only authorized software executes and all unauthorized software is blocked from executing on assets. |      |      | ●    |

## Profile

- Level 2 | Automated
