---
name: "CIS Ubuntu 14.04 LTS - 5.3.2 Ensure lockout for failed password attempts is configured"
description: "Verify PAM is configured to lock out users after repeated failed password attempts"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - pam
cis_id: "5.3.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.3.2 Ensure lockout for failed password attempts is configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Lock out users after _n_ unsuccessful consecutive login attempts. The first sets of changes are made to the PAM configuration files. The second set of changes are applied to the program specific PAM configuration file. The second set of changes must be applied to each program that will lock out users. Check the documentation for each secondary program for instructions on how to configure them to work with PAM.

Set the lockout number to the policy in effect at your site.

## Rationale

Locking out user IDs after _n_ unsuccessful consecutive login attempts mitigates brute force password attacks against your systems.

## Audit Procedure

Perform the following to determine the current settings for user lockout:

```bash
grep "pam_tally2" /etc/pam.d/common-auth
```

## Expected Result

```
auth required pam_tally2.so onerr=fail audit silent deny=5 unlock_time=900
```

## Remediation

Edit the `/etc/pam.d/common-auth` file and add the auth line below:

```
auth required pam_tally2.so onerr=fail audit silent deny=5 unlock_time=900
```

**Note:** If a user has been locked out because they have reached the maximum consecutive failure count defined by `deny=` in the `pam_tally2.so` module, the user can be unlocked by issuing the command `/sbin/pam_tally2 -u <username> --reset`. This command sets the failed count to 0, effectively unlocking the user.

**Note:** Use of the "audit" keyword may log credentials in the case of user error during authentication. This risk should be evaluated in the context of the site policies of your organization.

## Default Value

No lockout configured by default.

## References

- CIS Controls: 16.7 - Configure Account Lockouts

## Profile

- Level 1 - Server
- Level 1 - Workstation
