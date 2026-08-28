---
name: cis-ubuntu1604-v200-5-4-3
description: "Ensure password reuse is limited"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.4.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure password reuse is limited

**Profile Applicability:**

- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The `/etc/security/opasswd` file stores the users' old passwords and can be checked to ensure that users are not recycling recent passwords.

## Rationale

Forcing users not to reuse their past 5 passwords make it less likely that an attacker will be able to guess the password.

## Audit Procedure

### Command Line

Run the following commands and ensure the `remember` option is '5' or more and included in all results:

```bash
grep -E '^\s*password\s+required\s+pam_pwhistory\.so\s+([^#]+\s+)?remember=([5-9]|[1-9][0-9]+)\b' /etc/pam.d/common-password
```

**Expected output:**

```
password required pam_pwhistory.so remember=5
```

## Remediation

### Command Line

Edit the `/etc/pam.d/common-password` file to include the `remember` option and conform to site policy as shown:

```
password required pam_pwhistory.so remember=5
```

## Additional Information

Changes only apply to accounts configured on the local system.

## References

None

## CIS Controls

| Controls Version | Control                                                            |
| ---------------- | ------------------------------------------------------------------ |
| v7               | 16 Account Monitoring and Control - Account Monitoring and Control |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
