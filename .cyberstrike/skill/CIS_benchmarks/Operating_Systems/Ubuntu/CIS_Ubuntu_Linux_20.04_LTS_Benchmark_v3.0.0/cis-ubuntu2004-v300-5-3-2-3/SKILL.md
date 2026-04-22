---
name: cis-ubuntu2004-v300-5-3-2-3
description: "Ensure pam_pwquality module is enabled"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.2.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.2.3 Ensure pam_pwquality module is enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pam_pwquality.so` module performs password quality checking. This module can be plugged into the password stack of a given service to provide strength-checking for passwords. The code was originally based on pam_cracklib module and the module is backwards compatible with its options.

The action of this module is to prompt the user for a password and check its strength against a system dictionary and a set of rules for identifying poor choices.

The first action is to prompt for a single password, check its strength and then, if it is considered strong, prompt for the password a second time (to verify that it was typed correctly on the first occasion). All being well, the password is passed on to subsequent modules to be installed as the new authentication token.

## Rationale

Use of a unique, complex passwords helps to increase the time and resources required to compromise the password.

## Audit Procedure

### Command Line

Run the following command to verify that pam_pwquality is enabled:

```bash
# grep -P -- '\bpam_pwquality\.so\b' /etc/pam.d/common-password
```

## Expected Result

Output should be similar to:

```
password   requisite   pam_pwquality.so retry=3
```

## Remediation

### Command Line

Run the following script to verify the `pam_pwquality.so` line exists in a `pam-auth-update` profile:

```bash
# grep -P -- '\bpam_pwquality\.so\b' /usr/share/pam-configs/*
```

Output should be similar to:

```
/usr/share/pam-configs/pwquality:       requisite           pam_pwquality.so retry=3
/usr/share/pam-configs/pwquality:       requisite           pam_pwquality.so retry=3
```

- IF - similar output is returned:
Run the following command to update `/etc/pam.d/common-password` with the returned profile:

```bash
# pam-auth-update --enable {PROFILE_NAME}
```

Example:

```bash
# pam-auth-update pwquality
```

- IF - similar output is NOT returned:
Create a pam-auth-update profile in `/usr/share/pam-configs/` with the following lines:

```
Name: Pwquality password strength checking
Default: yes
Priority: 1024
Conflicts: cracklib
Password-Type: Primary
Password:
        requisite           pam_pwquality.so retry=3
```

Example:

```bash
#!/usr/bin/env bash

{
  arr=('Name: Pwquality password strength checking' 'Default: yes' 'Priority: 1024' 'Conflicts: cracklib' 'Password-Type: Primary' 'Password:' '        requisite                       pam_pwquality.so retry=3')
  printf '%s\n' "${arr[@]}" > /usr/share/pam-configs/pwquality
}
```

Run the following command to update `/etc/pam.d/common-password` with the `pwquality` profile:

```bash
# pam-auth-update --enable pwquality
```

Note:
- The name used for the file must be used in the `pam-auth-update --enable` command
- The `Name:` line should be easily recognizable and understood
- The `Priority:` Line is important as it effects the order of the lines in the `/etc/pam.d/` files
- If a site specific custom profile is being used in your environment to configure PAM that includes the configuration for the `pam_pwquality` module, enable that module instead

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
