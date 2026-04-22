---
name: cis-ubuntu2004-v300-5-3-2-4
description: "Ensure pam_pwhistory module is enabled"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.2.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.2.4 Ensure pam_pwhistory module is enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pam_pwhistory.so` module saves the last passwords for each user in order to force password change history and keep the user from alternating between the same password too frequently.

This module does not work together with kerberos. In general, it does not make much sense to use this module in conjunction with `NIS` or `LDAP`, since the old passwords are stored on the local machine and are not available on another machine for password history checking.

## Rationale

Use of a unique, complex passwords helps to increase the time and resources required to compromise the password.

## Audit Procedure

### Command Line

Run the following command to verify that `pam_pwhistory.so` is enabled:

```bash
# grep -P -- '\bpam_pwhistory\.so\b' /etc/pam.d/common-password
```

## Expected Result

Output should be similar to:

```
password   requisite   pam_pwhistory.so remember=24 enforce_for_root use_authtok
```

## Remediation

### Command Line

Run the following script to verify the `pam_pwhistory.so` line exists in a `pam-auth-update` profile:

```bash
# grep -P -- '\bpam_pwhistory\.so\b' /usr/share/pam-configs/*
```

Output should be similar to:

```
/usr/share/pam-configs/pwhistory:       requisite   pam_pwhistory.so remember=24 enforce_for_root use_authtok
```

- IF - similar output is returned:
Run the following command to update `/etc/pam.d/common-password` with the returned profile:

```bash
# pam-auth-update --enable {PROFILE_NAME}
```

Example:

```bash
# pam-auth-update pwhistory
```

- IF - similar output is NOT returned:
Create a `pwhistory` profile in `/usr/share/pam-configs/` with the following lines:

```
Name: pwhistory password history checking
Default: yes
Priority: 1024
Password-Type: Primary
Password: requisite pam_pwhistory.so remember=24 enforce_for_root use_authtok
```

Example Script:

```bash
#!/usr/bin/env bash

{
  arr=('Name: pwhistory password history checking' 'Default: yes' 'Priority: 1024' 'Password-Type: Primary' 'Password:' '        requisite                       pam_pwhistory.so remember=24 enforce_for_root use_authtok')
  printf '%s\n' "${arr[@]}" > /usr/share/pam-configs/pwhistory
}
```

Run the following command to update `/etc/pam.d/common-password` with the `pwhistory` profile:

```bash
# pam-auth-update --enable pwhistory
```

Note:
- The name used for the file must be used in the `pam-auth-update --enable` command
- The `Name:` line should be easily recognizable and understood
- The `Priority:` Line is important as it effects the order of the lines in the `/etc/pam.d/` files
- If a site specific custom profile is being used in your environment to configure PAM that includes the configuration for the `pam_pwhistory` module, enable that module instead

## References

None listed.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | * | * | * |
| v7 | 4.4 Use Unique Passwords | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1110, T1110.001, T1110.002, T1110.003, T1178.001, T1178.002, T1178.003, T1178.004 | TA0006 | M1027 |
