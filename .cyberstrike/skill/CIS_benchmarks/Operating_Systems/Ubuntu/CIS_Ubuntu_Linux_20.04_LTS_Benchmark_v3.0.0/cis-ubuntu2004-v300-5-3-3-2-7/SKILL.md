---
name: cis-ubuntu2004-v300-5-3-3-2-7
description: "Ensure password quality checking is enforced"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.2.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.2.7 Ensure password quality checking is enforced (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `pam_pwquality` module can be configured to either reject a password if it fails the checks, or only print a warning.

This is configured by setting the `enforcing=<N>` argument. If nonzero, a password will be rejected if it fails the checks, otherwise only a warning message will be provided.

This setting applies only to the pam_pwquality module and possibly other applications that explicitly change their behavior based on it. It does not affect pwmake(1) and pwscore(1).

## Rationale

Strong passwords help protect systems from password attacks. Types of password attacks include dictionary attacks, which attempt to use common words and phrases, and brute force attacks, which try every possible combination of characters. Also attackers may try to obtain the account database so they can use tools to discover the accounts and passwords.

## Audit Procedure

### Command Line

Run the following command to verify that `enforcing=0` has not been set in a `pwquality` configuration file:

```bash
# grep -PHsi -- '^\h*enforcing\h*=\h*0\b' /etc/security/pwquality.conf /etc/security/pwquality.conf.d/*.conf
```

Nothing should be returned.

Run the following command to verify that the `enforcing=0` argument has not been set on the `pam_pwquality` module:

```bash
# grep -PHsi -- '^\h*password\h+[^#\n\r]+\h+pam_pwquality\.so\h+([^#\n\r]+\h+)?enforcing=0\b' /etc/pam.d/common-password
```

Nothing should be returned.

## Remediation

### Command Line

Run the following command:

```bash
# grep -Pl -- '\bpam_pwquality\.so\h+([^#\n\r]+\h+)?enforcing=0\b' /usr/share/pam-configs/*
```

Edit any returned files and remove the `enforcing=0` argument from the `pam_pwquality.so` line(s).

Edit `/etc/security/pwquality.conf` and all files ending in `.conf` in the `/etc/security/pwquality.conf.d/` directory and remove or comment out any line containing the `enforcing = 0` argument:

Example:

```bash
# sed -ri 's/^\s*enforcing\s*=\s*0/# &/' /etc/security/pwquality.conf /etc/security/pwquality.conf.d/*.conf
```

## Default Value

enforcing=1

## References

1. pam_pwquality(8)
2. PWQUALITY.CONF(5)
3. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | * | * | * |
| v7 | 4.4 Use Unique Passwords | | * | * |
