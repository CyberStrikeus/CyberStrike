---
name: cis-ubuntu2004-v300-5-3-3-2-3
description: "Ensure password complexity is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.2.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.2.3 Ensure password complexity is configured (Manual)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Password complexity can be set through:

- `minclass` - The minimum number of classes of characters required in a new password. (digits, uppercase, lowercase, others). e.g. `minclass = 4` requires digits, uppercase, lower case, and special characters.
- `dcredit` - The maximum credit for having digits in the new password. If less than `0` it is the minimum number of digits in the new password. e.g. `dcredit = -1` requires at least one digit.
- `ucredit` - The maximum credit for having uppercase characters in the new password. If less than `0` it is the minimum number of uppercase characters in the new password. e.g. `ucredit = -1` requires at least one uppercase character.
- `ocredit` - The maximum credit for having other characters in the new password. If less than `0` it is the minimum number of other characters in the new password. e.g. `ocredit = -1` requires at least one special character.
- `lcredit` - The maximum credit for having lowercase characters in the new password. If less than `0` it is the minimum number of lowercase characters in the new password. e.g. `lcredit = -1` requires at least one lowercase character.

## Rationale

Strong passwords protect systems from being hacked through brute force methods.

Requiring at least one non-alphabetic character increases the search space beyond pure dictionary words, which makes the resulting password harder to crack.

Forcing users to choose an excessively complex password, e.g. some combination of upper-case, lower-case, numbers, and special characters, has a negative impact. It places an extra burden on users and many will use predictable patterns (for example, a capital letter in the first position, followed by lowercase letters, then one or two numbers, and a "special character" at the end). Attackers know this, so dictionary attacks will often contain these common patterns and use the most common substitutions like, $ for s, @ for a, 1 for l, 0 for o.

## Impact

Passwords that are too complex in nature make it harder for users to remember, leading to bad practices. In addition, composition requirements provide no defense against common attack types such as social engineering or insecure storage of passwords.

## Audit Procedure

### Command Line

Run the following command to verify:

- `dcredit`, `ucredit`, `lcredit`, and `ocredit` are not set to a value greater than `0`
- Complexity conforms to local site policy:

```bash
# grep -Psi -- '^\h*(minclass|[dulo]credit)\b' /etc/security/pwquality.conf /etc/security/pwquality.conf.d/*.conf
```

Example output:

```
/etc/security/pwquality.conf.d/50-pwcomplexity.conf:minclass = 3
/etc/security/pwquality.conf.d/50-pwcomplexity.conf:ucredit = -2
/etc/security/pwquality.conf.d/50-pwcomplexity.conf:lcredit = -2
/etc/security/pwquality.conf.d/50-pwcomplexity.conf:dcredit = -1
/etc/security/pwquality.conf.d/50-pwcomplexity.conf:ocredit = 0
```

The example represents a requirement of three character classes, with passwords requiring two upper case, two lower case, and one numeric character.

Run the following command to verify that module arguments in the configuration file(s) are not being overridden by arguments in `/etc/pam.d/common-password`:

```bash
# grep -Psi -- '^\h*password\h+(requisite|required|sufficient)\h+pam_pwquality\.so\h+([^#\n\r]+\h+)?(minclass=\d*|[dulo]credit=-?\d*)\b' /etc/pam.d/common-password
```

Nothing should be returned.

Note:
- settings should be configured in only one location for clarity
- Settings observe an order of precedence:
  - module arguments override the settings in the `/etc/security/pwquality.conf` configuration file
  - settings in the `/etc/security/pwquality.conf` configuration file override settings in a `.conf` file in the `/etc/security/pwquality.conf.d/` directory
  - settings in a `.conf` file in the `/etc/security/pwquality.conf.d/` directory are read in canonical order, with last read file containing the setting taking precedence
- It is recommended that settings be configured in a `.conf` file in the `/etc/security/pwquality.conf.d/` directory for clarity, convenience, and durability.

## Remediation

### Command Line

Run the following command:

```bash
# grep -Pl -- '\bpam_pwquality\.so\h+([^#\n\r]+\h+)?(minclass|[dulo]credit)\b' /usr/share/pam-configs/*
```

Edit any returned files and remove the `minclass`, `dcredit`, `ucredit`, `lcredit`, and `ocredit` arguments from the `pam_pwquality.so` line(s).

Create or modify a file ending in `.conf` in the `/etc/security/pwquality.conf.d/` directory or the file `/etc/security/pwquality.conf` and add or modify the following line(s) to set complexity according to local site policy:

- `minclass = _N_`
- `dcredit = _N_` # Value should be either `0` or a number proceeded by a minus (`-`) symbol
- `ucredit = -1` # Value should be either `0` or a number proceeded by a minus (`-`) symbol
- `ocredit = -1` # Value should be either `0` or a number proceeded by a minus (`-`) symbol
- `lcredit = -1` # Value should be either `0` or a number proceeded by a minus (`-`) symbol

Example 1 - Set `minclass = 3`:

```bash
#!/usr/bin/env bash

{
  sed -ri 's/^\s*minclass\s*=/#  &/' /etc/security/pwquality.conf
  sed -ri 's/^\s*[dulo]credit\s*=/#  &/' /etc/security/pwquality.conf
  [ ! -d /etc/security/pwquality.conf.d/ ] && mkdir /etc/security/pwquality.conf.d/
  printf '\n%s' "minclass = 3" > /etc/security/pwquality.conf.d/50-pwcomplexity.conf
}
```

Example 2 - set `dcredit = -1`, `ucredit = -1`, and `lcredit = -1`:

```bash
#!/usr/bin/env bash

{
  sed -ri 's/^\s*minclass\s*=/#  &/' /etc/security/pwquality.conf
  sed -ri 's/^\s*[dulo]credit\s*=/#  &/' /etc/security/pwquality.conf
  [ ! -d /etc/security/pwquality.conf.d/ ] && mkdir /etc/security/pwquality.conf.d/
  printf '%s\n' "dcredit = -1" "ucredit = -1" "lcredit = -1" > /etc/security/pwquality.conf.d/50-pwcomplexity.conf
}
```

## Default Value

minclass = 0
dcredit = 0
ucredit = 0
ocredit = 0
lcredit = 0

## References

1. pam_pwquality(8)
2. PWQUALITY.CONF(5)
3. https://www.cisecurity.org/insights/white-papers/cis-password-policy-guide
4. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | * | * | * |
| v7 | 4.4 Use Unique Passwords | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1110, T1110.001, T1110.002, T1110.003, T1178.001, T1178.002, T1178.003, T1178.004 | TA0006 | M1027 |
