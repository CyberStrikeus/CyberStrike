---
name: cis-ubuntu2004-v300-5-3-2-1
description: "Ensure pam_unix module is enabled"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.2.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.2.1 Ensure pam_unix module is enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`pam_unix` is the standard Unix authentication module. It uses standard calls from the system's libraries to retrieve and set account information as well as authentication. Usually this is obtained from the `/etc/passwd` and if shadow is enabled, the `/etc/shadow` file as well.

The account component performs the task of establishing the status of the user's account and password based on the following shadow elements: `expire`, `last_change`, `max_change`, `min_change`, `warn_change`. In the case of the latter, it may offer advice to the user on changing their password or, through the `PAM_AUTHTOKEN_REQD` return, delay giving service to the user until they have established a new password. The entries listed above are documented in the shadow(5) manual page. Should the user's record not contain one or more of these entries, the corresponding shadow check is not performed.

The authentication component performs the task of checking the users credentials (password). The default action of this module is to not permit the user access to a service if their official password is blank.

## Rationale

The system should only provide access after performing authentication of a user.

## Audit Procedure

### Command Line

Run the following command to verify that `pam_unix` is enabled:

```bash
# grep -PH -- '\bpam_unix\.so\b' /etc/pam.d/common-{account,auth,password,session,session-noninteractive}
```

## Expected Result

Output should be similar to:

```
/etc/pam.d/common-account:account   [success=1 new_authtok_reqd=done default=ignore]   pam_unix.so
/etc/pam.d/common-auth:auth   [success=2 default=ignore]   pam_unix.so try_first_pass
/etc/pam.d/common-password:password   [success=1 default=ignore]   pam_unix.so obscure use_authtok try_first_pass yescrypt
/etc/pam.d/common-session:session   required   pam_unix.so
/etc/pam.d/common-session-noninteractive:session   required   pam_unix.so
```

## Remediation

### Command Line

Run the following command to enable the `pam_unix` module:

```bash
# pam-auth-update --enable unix
```

Note: If a site specific custom profile is being used in your environment to configure PAM that includes the configuration for the `pam_faillock` module, enable that module instead.

## References

1. NIST SP 800-53 Rev. 5: IA-5(1)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1110, T1110.001, T1110.002, T1110.003, T1178.001, T1178.002, T1178.003, T1178.004 | TA0006 | M1027 |
