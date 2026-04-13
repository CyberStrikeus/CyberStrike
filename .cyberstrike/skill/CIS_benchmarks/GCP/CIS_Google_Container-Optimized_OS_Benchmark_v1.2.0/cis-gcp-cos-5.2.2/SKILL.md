---
name: cis-gcp-cos-5.2.2
description: "Ensure password reuse is limited"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, pam, password-policy, password-reuse]
cis_id: "5.2.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.2 Ensure password reuse is limited (Manual)

## Description

The `/etc/security/opasswd` file stores the users' old passwords and can be checked to ensure that users are not recycling recent passwords.

## Rationale

Forcing users not to reuse their past 5 passwords make it less likely that an attacker will be able to guess the password.

Note that these change only apply to accounts configured on the local system.

## Audit Procedure

Verify remembered password history is 5 or more. This setting is commonly configured with the `pam_unix.so` or `pam_pwhistory.so` remember options found in `/etc/pam.d/common-password` or `/etc/pam.d/system-auth`. Examples:

```bash
password required pam_pwhistory.so remember=5
password required pam_unix.so remember=5
```

## Expected Result

The `remember` option should be set to 5 or more in the PAM configuration for `pam_pwhistory.so` or `pam_unix.so`.

## Remediation

Set remembered password history to conform to site policy. Many distributions provide tools for updating PAM configuration, consult your documentation for details. If no tooling is provided edit the appropriate `/etc/pam.d/` configuration file and add or modify the `pam_pwhistory.so` or `pam_unix.so` lines to include the `remember` option:

```
password required pam_pwhistory.so remember=5
password required pam_unix.so remember=5
```

Additional Information:

Consult your documentation for the appropriate PAM file and module.

Additional module options may be set, recommendation only covers those listed here.

## Profile

- Level 2 - Server
