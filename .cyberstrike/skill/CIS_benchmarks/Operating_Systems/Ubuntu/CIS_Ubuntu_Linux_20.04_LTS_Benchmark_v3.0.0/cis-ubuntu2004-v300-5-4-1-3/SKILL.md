---
name: cis-ubuntu2004-v300-5-4-1-3
description: "Ensure password expiration warning days is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1.3 Ensure password expiration warning days is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PASS_WARN_AGE` parameter in `/etc/login.defs` allows an administrator to notify users that their password will expire in a defined number of days.

`PASS_WARN_AGE` <N> - The number of days warning given before a password expires. A zero means warning is given only upon the day of expiration, a negative value means no warning is given. If not specified, no warning will be provided.

## Rationale

Providing an advance warning that a password will be expiring gives users time to think of a secure password. Users caught unaware may choose a simple password or write it down where it may be discovered.

## Audit Procedure

### Command Line

Run the following command and verify `PASS_WARN_AGE` is 7 or more and follows local site policy:

```bash
# grep -Pi -- '^\h*PASS_WARN_AGE\h+\d+\b' /etc/login.defs
```

Example output:

```
PASS_WARN_AGE 7
```

Run the following command to verify all passwords have a `PASS_WARN_AGE` of 7 or more:

```bash
# awk -F: '($2~/^\$.+\$/) {if($6 < 7)print "User: " $1 " PASS_WARN_AGE: " $6}' /etc/shadow
```

## Expected Result

Nothing should be returned

## Remediation

### Command Line

Edit `/etc/login.defs` and set `PASS_WARN_AGE` to a value of 7 or more that follows local site policy:
Example:

```
PASS_WARN_AGE 7
```

Run the following command to modify user parameters for all users with a password set to a minimum warning to 7 or more days that follows local site policy:

```bash
# chage --warndays <N> <user>
```

Example:

```bash
# awk -F: '($2~/^\$.+\$/) {if($6 < 7)system ("chage --warndays 7 " $1)}' /etc/shadow
```

## Default Value

PASS_WARN_AGE 7

## References

None specified.

## CIS Controls

v8 - 5.2 Use Unique Passwords: Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. (IG 1, IG 2, IG 3)

v7 - 4.4 Use Unique Passwords: Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. (IG 2, IG 3)

MITRE ATT&CK Mappings: T1078 - Tactics: TA0006 - Mitigations: M1027
