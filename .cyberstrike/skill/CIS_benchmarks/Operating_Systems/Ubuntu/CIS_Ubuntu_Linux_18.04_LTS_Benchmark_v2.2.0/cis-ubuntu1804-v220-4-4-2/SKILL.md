---
name: cis-ubuntu1804-v220-4-4-2
description: "Ensure lockout for failed password attempts is configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, pam, authentication]
cis_id: "4.4.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.4.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Lock out users after `n` unsuccessful consecutive login attempts. The first set of changes are made to the PAM configuration files. The second set of changes are applied to the program specific PAM configuration file. Set the lockout number to the site's policy.

- `deny = 4` - deny access if tally for this user exceeds 4
- `unlock_time = 900` - allow access after 900 seconds (15 minutes) after failed attempt. If this option is used together with `deny`, `unlock_time` is the time after a failed attempt before access can be attempted again.

## Rationale

Locking out user IDs after `n` unsuccessful consecutive login attempts mitigates brute force password attacks against your systems.

## Audit Procedure

### Command Line

Verify the pam_tally2 or pam_faillock module is configured:

```bash
grep -Pi '^\h*auth\h+(required|requisite)\h+pam_(tally2|faillock)\.so' /etc/pam.d/common-auth
```

### Expected Result

```
auth required pam_tally2.so onerr=fail audit silent deny=5 unlock_time=900
```

OR pam_faillock equivalent.

## Remediation

### Command Line

Edit `/etc/pam.d/common-auth` and add or modify the following line:

```
auth required pam_tally2.so onerr=fail audit silent deny=5 unlock_time=900
```

Edit `/etc/pam.d/common-account` and add or modify the following line:

```
account requisite pam_deny.so
account required pam_tally2.so
```

## References

1. NIST SP 800-53 Rev. 5: AC-7

## CIS Controls

v8 - 6.2 Establish an Access Revoking Process - Establish and follow a process, ideally automated, for revoking access to enterprise assets.

v7 - 16.7 Establish Process for Revoking Access.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
