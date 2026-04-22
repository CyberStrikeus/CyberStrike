---
name: cis-ubuntu2004-v300-5-4-1-5
description: "Ensure inactive password lock is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.1.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1.5 Ensure inactive password lock is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

User accounts that have been inactive for over a given period of time can be automatically disabled.

`INACTIVE` - Defines the number of days after the password exceeded its maximum age where the user is expected to replace this password.

The value is stored in the shadow password file. An input of 0 will disable an expired password with no delay. An input of -1 will blank the respective field in the shadow password file.

## Rationale

Inactive accounts pose a threat to system security since the users are not logging in to notice failed login attempts or other anomalies.

## Audit Procedure

### Command Line

Run the following command and verify `INACTIVE` conforms to site policy (no more than 45 days):

```bash
# useradd -D | grep INACTIVE
INACTIVE=45
```

Verify all users with a password have Password inactive no more than 45 days after password expires. Run the following command and Review list of users and `INACTIVE` to verify that all users `INACTIVE` conforms to site policy (no more than 45 days):

```bash
# awk -F: '($2~/^\$.+\$/) {if($7 > 45 || $7 < 0)print "User: " $1 " INACTIVE: " $7 "Days"}' /etc/shadow
```

## Expected Result

Nothing should be returned

## Remediation

### Command Line

Run the following command to set the default password inactivity period to 45 days or less that meets local site policy:

```bash
# useradd -D -f <N>
```

Example:

```bash
# useradd -D -f 45
```

Run the following command to modify user parameters for all users with a password set to a inactive age of 45 days or less that follows local site policy:

```bash
# chage --inactive <N> <user>
```

Example:

```bash
# awk -F: '($2~/^\$.+\$/) {if($7 > 45 || $7 < 0)system ("chage --inactive 45 " $1)}' /etc/shadow
```

## Default Value

INACTIVE=-1

## References

1. CIS Password Policy Guide

## CIS Controls

v8 - 5.2 Use Unique Passwords: Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. (IG 1, IG 2, IG 3)

v7 - 4.4 Use Unique Passwords: Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. (IG 2, IG 3)

MITRE ATT&CK Mappings: T1078, T1078.002, T1078.003 - Tactics: TA0001 - Mitigations: M1027
