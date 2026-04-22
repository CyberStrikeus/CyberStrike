---
name: cis-ubuntu1204-v110-9-2-2
description: "Set Lockout for Failed Password Attempts"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, pam, account-lockout]
cis_id: "9.2.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.2.2 Set Lockout for Failed Password Attempts (Not Scored)

## Profile Applicability
- Level 1

## Description
Lock out users after *n* unsuccessful consecutive login attempts. The first sets of changes are made to the PAM configuration file `/etc/pam.d/login`. The second set of changes are applied to the program specific PAM configuration file. The second set of changes must be applied to each program that will lock out users. Check the documentation for each secondary program for instructions on how to configure them to work with PAM.

Set the lockout number to the policy in effect at your site.

## Rationale
Locking out userIDs after *n* unsuccessful consecutive login attempts mitigates brute force password attacks against your systems.

## Audit Procedure
### Using Command Line
Perform the following to determine the current settings for user lockout:
```bash
grep "pam_tally2" /etc/pam.d/login
```

## Expected Result
```
auth required pam_tally2.so onerr=fail audit silent deny=5 unlock_time=900
```

## Remediation
### Using Command Line
Edit the `/etc/pam.d/login` file and add the auth line below:
```bash
auth required pam_tally2.so onerr=fail audit silent deny=5 unlock_time=900
```

**Note:** If a user has been locked out because they have reached the maximum consecutive failure count defined by `deny=` in the `pam_tally2.so` module, the user can be unlocked by issuing the command `/sbin/pam_tally2 -u <username> --reset`. This command sets the failed count to 0, effectively unlocking the user.

## Default Value
No account lockout is configured by default.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Not Scored
