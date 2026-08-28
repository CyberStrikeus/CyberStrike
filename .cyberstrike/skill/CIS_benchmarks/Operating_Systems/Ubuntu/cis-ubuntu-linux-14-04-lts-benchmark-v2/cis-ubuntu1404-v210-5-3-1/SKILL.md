---
name: "CIS Ubuntu 14.04 LTS - 5.3.1 Ensure password creation requirements are configured"
description: "Verify PAM password quality requirements enforce minimum length and complexity"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - pam
cis_id: "5.3.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.3.1 Ensure password creation requirements are configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pam_pwquality.so` module checks the strength of passwords. It performs checks such as making sure a password is not a dictionary word, it is a certain length, contains a mix of characters (e.g. alphabet, numeric, other) and more. The following are definitions of the `pam_pwquality.so` options:

- `retry=3` - Allow 3 tries before sending back a failure.

The following options are set in the `/etc/security/pwquality.conf` file:

- `minlen = 14` - password must be 14 characters or more
- `dcredit = -1` - provide at least one digit
- `ucredit = -1` - provide at least one uppercase character
- `ocredit = -1` - provide at least one special character
- `lcredit = -1` - provide at least one lowercase character

The settings shown above are one possible policy. Alter these values to conform to your own organization's password policies.

## Rationale

Strong passwords protect systems from being hacked through brute force methods.

## Audit Procedure

Run the following commands and verify all password requirements conform to organization policy and minlen is 14 or more:

```bash
grep pam_pwquality.so /etc/pam.d/common-password
grep ^minlen /etc/security/pwquality.conf
grep ^dcredit /etc/security/pwquality.conf
grep ^lcredit /etc/security/pwquality.conf
grep ^ocredit /etc/security/pwquality.conf
grep ^ucredit /etc/security/pwquality.conf
```

## Expected Result

```
password requisite pam_pwquality.so retry=3
minlen = 14
dcredit = -1
lcredit = -1
ocredit = -1
ucredit = -1
```

## Remediation

Run the following command to install the pam_pwquality module:

```bash
apt-get install libpam-pwquality
```

Edit the `/etc/pam.d/common-password` file to include the appropriate options for `pam_pwquality.so` and to conform to site policy:

```
password requisite pam_pwquality.so retry=3
```

Edit `/etc/security/pwquality.conf` to add or update the following settings to conform to site policy:

```
minlen = 14
dcredit = -1
ucredit = -1
ocredit = -1
lcredit = -1
```

## Default Value

No password quality requirements configured by default.

## References

- CIS Controls: 5.7 - User Accounts Shall Use Long Passwords
- CIS Controls: 16.12 - Use Long Passwords For All User Accounts

## Profile

- Level 1 - Server
- Level 1 - Workstation
