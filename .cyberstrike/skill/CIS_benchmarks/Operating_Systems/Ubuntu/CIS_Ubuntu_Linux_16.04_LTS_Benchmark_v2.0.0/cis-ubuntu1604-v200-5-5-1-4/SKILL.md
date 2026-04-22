---
name: cis-ubuntu1604-v200-5-5-1-4
description: "Ensure inactive password lock is 30 days or less"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.1.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure inactive password lock is 30 days or less

**Profile Applicability:**
- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

User accounts that have been inactive for over a given period of time can be automatically disabled. It is recommended that accounts that are inactive for 30 days after password expiration be disabled.

## Rationale

Inactive accounts pose a threat to system security since the users are not logging in to notice failed login attempts or other anomalies.

## Audit Procedure

### Command Line

Run the following command and verify `INACTIVE` conforms to site policy (no more than 30 days):

```bash
useradd -D | grep INACTIVE
```

**Expected output:**

```
INACTIVE=30
```

Verify all users with a password have Password inactive no more than 30 days after password expires. Run the following command and Review list of users and INACTIVE to verify that all users' INACTIVE conforms to site policy (no more than 30 days):

```bash
awk -F: '(/^[^:]+:[^!*]/ && ($7~/(\s*|-1)/ || $7>30)){print $1 " " $7}' /etc/shadow
```

**Expected Result:**

No `<user>:<INACTIVE>` should be returned.

## Remediation

### Command Line

Run the following command to set the default password inactivity period to 30 days:

```bash
useradd -D -f 30
```

Modify user parameters for all users with a password set to match:

```bash
chage --inactive 30 <user>
```

## Default Value

INACTIVE=-1

## Additional Information

A value of -1 would disable this setting.

## References

None

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 4.4 Use Unique Passwords - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
