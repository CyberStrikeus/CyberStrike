---
name: cis-ubuntu1604-v200-5-4-2
description: "Ensure lockout for failed password attempts is configured"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.4.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure lockout for failed password attempts is configured

**Profile Applicability:**

- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

Lock out users after _n_ unsuccessful consecutive login attempts. The first sets of changes are made to the PAM configuration files. The second set of changes are applied to the program specific PAM configuration file. The second set of changes must be applied to each program that will lock out users. Check the documentation for each secondary program for instructions on how to configure them to work with PAM.

- `deny=n` - n represents the number of failed attempts before the account is locked
- `unlock_time=n` - n represents the number of seconds before the account is unlocked
- `audit` - Will log the user name into the system log if the user is not found.
- `silent` - Don't print informative messages. Set the lockout number and unlock time in accordance with local site policy.

## Rationale

Locking out user IDs after _n_ unsuccessful consecutive login attempts mitigates brute force password attacks against your systems.

## Audit Procedure

### Command Line

Verify password lockouts are configured. These settings are commonly configured with the `pam_tally2.so` modules found in `/etc/pam.d/common-auth`:

```bash
grep "pam_tally2" /etc/pam.d/common-auth
```

**Expected output:**

```
auth required pam_tally2.so onerr=fail audit silent deny=5 unlock_time=900
```

Verify the `pam_deny.so` module and `pam_tally2.so` modules are included in `/etc/pam.d/common-account`:

```bash
grep -E "pam_(tally2|deny)\.so" /etc/pam.d/common-account
```

**Expected output:**

```
account requisite                       pam_deny.so
account required                        pam_tally2.so
```

## Remediation

### Command Line

Edit the `/etc/pam.d/common-auth` file and add the auth line below:

```
auth required pam_tally2.so onerr=fail audit silent deny=5 unlock_time=900
```

Edit the `/etc/pam.d/common-account` file and add the account lines below:

```
account    requisite    pam_deny.so
account    required     pam_tally2.so
```

## Additional Information

- Add `pam_tally2` to the account section `account required pam_tally2.so` for the counter to reset to 0 when using sudo.
- Use of the "audit" keyword may log credentials in the case of user error during authentication. This risk should be evaluated in the context of the site policies of your organization.
- If a user has been locked out because they have reached the maximum consecutive failure count defined by `deny=` in the `pam_tally2.so` module, the user can be unlocked by issuing the command `/sbin/pam_tally2 -u <username> --reset`. This command sets the failed count to 0, effectively unlocking the user.

## References

None

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 16.7 Establish Process for Revoking Access - Establish and follow an automated process for revoking system access by disabling accounts immediately upon termination or change of responsibilities of an employee or contractor. Disabling these accounts, instead of deleting accounts, allows preservation of audit trails. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
