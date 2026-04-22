---
name: cis-ubuntu2004-v300-5-3-3-2-6
description: "Ensure password dictionary check is enabled"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.2.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.2.6 Ensure password dictionary check is enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pwquality dictcheck` option sets whether to check for the words from the `cracklib` dictionary.

## Rationale

If the operating system allows the user to select passwords based on dictionary words, this increases the chances of password compromise by increasing the opportunity for successful guesses, and brute-force attacks.

## Audit Procedure

### Command Line

Run the following command to verify that the `dictcheck` option is not set to `0` (disabled) in a pwquality configuration file:

```bash
# grep -Psi -- '^\h*dictcheck\h*=\h*0\b' /etc/security/pwquality.conf /etc/security/pwquality.conf.d/*.conf
```

Nothing should be returned.

Run the following command to verify that the `dictcheck` option is not set to `0` (disabled) as a module argument in a PAM file:

```bash
# grep -Psi -- '^\h*password\h+(requisite|required|sufficient)\h+pam_pwquality\.so\h+([^#\n\r]+\h+)?dictcheck\h*=\h*0\b' /etc/pam.d/common-password
```

Nothing should be returned.

Note:

- Settings observe an order of precedence:
  - module arguments override the settings in the `/etc/security/pwquality.conf` configuration file
  - settings in the `/etc/security/pwquality.conf` configuration file override settings in a `.conf` file in the `/etc/security/pwquality.conf.d/` directory
  - settings in a `.conf` file in the `/etc/security/pwquality.conf.d/` directory are read in canonical order, with last read file containing the setting taking precedence
- It is recommended that settings be configured in a `.conf` file in the `/etc/security/pwquality.conf.d/` directory for clarity, convenience, and durability.

## Remediation

### Command Line

Edit any file ending in `.conf` in the `/etc/security/pwquality.conf.d/` directory and/or the file `/etc/security/pwquality.conf` and comment out or remove any instance of `dictcheck = 0`:

Example:

```bash
# sed -ri 's/^\s*dictcheck\s*=/#  &/' /etc/security/pwquality.conf /etc/security/pwquality.conf.d/*.conf
```

Run the following command:

```bash
# grep -Pl -- '\bpam_pwquality\.so\h+([^#\n\r]+\h+)?dictcheck\b' /usr/share/pam-configs/*
```

Edit any returned files and remove the `dictcheck` argument from the `pam_pwquality.so` line(s).

## Default Value

dictcheck = 1

## References

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

| Controls Version | Control                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------ | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords | \*   | \*   | \*   |
| v7               | 4.4 Use Unique Passwords |      | \*   | \*   |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques                                                        | Tactics | Mitigations |
| ---------------------------------------------------------------------------------- | ------- | ----------- |
| T1110, T1110.001, T1110.002, T1110.003, T1178.001, T1178.002, T1178.003, T1178.004 | TA0006  | M1027       |
