---
name: cis-ubuntu2004-v300-5-3-3-1-3
description: "Ensure password failed attempts lockout includes root account"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.1.3 Ensure password failed attempts lockout includes root account (Automated)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

`even_deny_root` - Root account can become locked as well as regular accounts.

`root_unlock_time=n` - This option implies even_deny_root option. Allow access after n seconds to root account after the account is locked. In case the option is not specified the value is the same as of the unlock_time option.

## Rationale

Locking out user IDs after n unsuccessful consecutive login attempts mitigates brute force password attacks against your systems.

## Impact

Use of `unlock_time=0` or `root_unlock_time=0` may allow an attacker to cause denial of service to legitimate users.

## Audit Procedure

### Command Line

Run the following command to verify that `even_deny_root` and/or `root_unlock_time` is enabled:

```bash
# grep -Pi -- '^\h*(even_deny_root|root_unlock_time\h*=\h*\d+)\b' /etc/security/faillock.conf
```

Example output:

```
even_deny_root
```

--AND/OR--

```
root_unlock_time = 60
```

Run the following command to verify that - IF - `root_unlock_time` is set, it is set to `60` (One minute) or more:

```bash
# grep -Pi -- '^\h*root_unlock_time\h*=\h*([1-9]|[1-5][0-9])\b' /etc/security/faillock.conf
```

Nothing should be returned.

Run the following command to check the `pam_faillock.so` module for the `root_unlock_time` argument. Verify -IF- `root_unlock_time` is set, it is set to `60` (One minute) or more:

```bash
# grep -Pi -- '^\h*auth\h+([^#\n\r]+\h+)pam_faillock\.so\h+([^#\n\r]+\h+)?root_unlock_time\h*=\h*([1-9]|[1-5][0-9])\b' /etc/pam.d/common-auth
```

Nothing should be returned.

## Remediation

### Command Line

Edit `/etc/security/faillock.conf`:

- Remove or update any line containing `root_unlock_time`, - OR - set it to a value of `60` or more
- Update or add the following line:

```
even_deny_root
```

Run the following command:

```bash
# grep -Pl -- '\bpam_faillock\.so\h+([^#\n\r]+\h+)?(even_deny_root|root_unlock_time)' /usr/share/pam-configs/*
```

Edit any returned files and remove the `even_deny_root` and `root_unlock_time` arguments from the `pam_faillock.so` line(s).

## Default Value

disabled

## Additional Information

If a user has been locked out because they have reached the maximum consecutive failure count defined by `deny=` in the `pam_faillock.so` module, the user can be unlocked by issuing the command `faillock --user <USERNAME> --reset`. This command sets the failed count to 0, effectively unlocking the user.

## References

None listed.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 6.2 Establish an Access Revoking Process | * | * | * |
| v7 | 16.7 Establish Process for Revoking Access | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1110, T1110.001, T1110.003 | TA0006 | M1027 |
