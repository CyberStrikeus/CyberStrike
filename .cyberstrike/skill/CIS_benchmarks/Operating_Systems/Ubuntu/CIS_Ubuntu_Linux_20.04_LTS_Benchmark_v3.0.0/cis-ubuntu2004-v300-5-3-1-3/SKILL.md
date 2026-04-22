---
name: cis-ubuntu2004-v300-5-3-1-3
description: "Ensure latest version of libpam-pwquality is installed"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1.3 Ensure latest version of libpam-pwquality is installed (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`libpwquality` provides common functions for password quality checking and scoring them based on their apparent randomness. The library also provides a function for generating random passwords with good pronounceability.

This module can be plugged into the password stack of a given service to provide some plug-in strength-checking for passwords. The code was originally based on `pam_cracklib` module and the module is backwards compatible with its options.

## Rationale

Strong passwords reduce the risk of systems being hacked through brute force methods.

Older versions of the `libpam-pwquality` package may not include the latest security and feature patches and updates.

Recommendations were written and tested against version `1.3.1-5ubuntu4.7`. The latest available version should be used.

## Audit Procedure

### Command Line

Run the following command to verify `libpam-pwquality` is installed:

```bash
# dpkg-query -s libpam-pwquality &>/dev/null && echo "libpam-pwquality is installed"
```

Run the following command to verify `libpam-pwquality` is the latest version:

```bash
# apt list --upgradable 2>&1 | grep -P '^libpam-pwquality\b'
```

## Expected Result

The first command should return:

```
libpam-pwquality is installed
```

The second command should return nothing.

## Remediation

### Command Line

Run the following command to install the latest version of `libpam-pwquality`:

```bash
# apt install libpam-pwquality
```

## References

1. https://packages.debian.org/buster/libpam-pwquality

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | * | * | * |
| v7 | 4.4 Use Unique Passwords | | * | * |
