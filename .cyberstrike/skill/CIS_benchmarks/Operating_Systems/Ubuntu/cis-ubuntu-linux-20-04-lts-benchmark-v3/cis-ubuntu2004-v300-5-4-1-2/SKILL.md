---
name: cis-ubuntu2004-v300-5-4-1-2
description: "Ensure minimum password days is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1.2 Ensure minimum password days is configured (Manual)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

`PASS_MIN_DAYS` <N> - The minimum number of days allowed between password changes. Any password changes attempted sooner than this will be rejected. If not specified, 0 will be assumed (which disables the restriction).

## Rationale

Users may have favorite passwords that they like to use because they are easy to remember and they believe that their password choice is secure from compromise. Unfortunately, passwords are compromised and if an attacker is targeting a specific individual user account, with foreknowledge of data about that user, reuse of old, potentially compromised passwords, may cause a security breach.

By restricting the frequency of password changes, an administrator can prevent users from repeatedly changing their password in an attempt to circumvent password reuse controls.

## Impact

If a users password is set by other personnel as a procedure in dealing with a lost or expired password, the user should be forced to update this "set" password with their own password. e.g. force "change at next logon".

If it is not possible to have a user set their own password immediately, and this recommendation or local site procedure may cause a user to continue using a third party generated password, `PASS_MIN_DAYS` for the effected user should be temporally changed to 0 via `chage --mindays <user>`, to allow a user to change their password immediately.

For applications where the user is not using the password at console, the ability to "change at next logon" may be limited. This may cause a user to continue to use a password created by other personnel.

## Audit Procedure

### Command Line

Run the following command to verify that `PASS_MIN_DAYS` is set to a value greater than 0 and follows local site policy:

```bash
# grep -Pi -- '^\h*PASS_MIN_DAYS\h+\d+\b' /etc/login.defs
```

Example output:

```
PASS_MIN_DAYS   1
```

Run the following command to verify all passwords have a `PASS_MIN_DAYS` greater than 0:

```bash
# awk -F: '($2~/^\$.+\$/) {if($4 < 1)print "User: " $1 " PASS_MIN_DAYS: " $4}' /etc/shadow
```

## Expected Result

Nothing should be returned

## Remediation

### Command Line

Edit `/etc/login.defs` and set `PASS_MIN_DAYS` to a value greater than 0 that follows local site policy:
Example:

```
PASS_MIN_DAYS 1
```

Run the following command to modify user parameters for all users with a password set to a minimum days greater than zero that follows local site policy:

```bash
# chage --mindays <N> <user>
```

Example:

```bash
# awk -F: '($2~/^\$.+\$/) {if($4 < 1)system ("chage --mindays 1 " $1)}' /etc/shadow
```

## Default Value

PASS_MIN_DAYS 0

## References

1. CIS Password Policy Guide
2. NIST SP 800-53 :: IA-5 (1) (d)
3. NIST SP 800-53A :: IA-5 (1).1 (v)
4. STIG ID: RHEL-08-020180 | Rule ID: SV-230364r627750 | CAT II
5. STIG ID: RHEL-08-020190 | Rule ID: SV-230365r858727 | CAT II
6. STIG ID: UBTU-20-010007 | Rule ID: SV-238202r1015140 | CAT III
7. STIG ID: UBTU-22-411025 | Rule ID: SV-260545r1015007 | CAT III

## CIS Controls

v8 - 5.2 Use Unique Passwords: Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. (IG 1, IG 2, IG 3)

v7 - 4.4 Use Unique Passwords: Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. (IG 2, IG 3)

MITRE ATT&CK Mappings: T1078, T1078.001, T1078.002, T1078.003, T1078.004, T1110, T1110.004 - Tactics: TA0006 - Mitigations: M1027
