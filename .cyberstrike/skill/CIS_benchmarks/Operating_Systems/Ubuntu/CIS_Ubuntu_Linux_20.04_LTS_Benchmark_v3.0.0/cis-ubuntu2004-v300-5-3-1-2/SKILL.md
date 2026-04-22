---
name: cis-ubuntu2004-v300-5-3-1-2
description: "Ensure latest version of libpam-modules is installed"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1.2 Ensure latest version of libpam-modules is installed (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`libpam-modules` is a package containing a set of Pluggable Authentication Modules (PAM) which allows system administrators to configure different authentication methods for user logins, providing flexibility in how users can access applications by using various authentication modules to include password checks and other security mechanisms.

## Rationale

Older versions of the `libpam-modules` package may not include the latest security and feature patches and updates.

Note: This Benchmark includes Recommendations that depend on newer `libpam-modules` features. These recommendations were written and tested against version `1.3.1-5ubuntu4.7`. The latest available version should be used.

## Audit Procedure

### Command Line

Run the following command to verify `libpam-modules` is installed:

```bash
# dpkg-query -s libpam-modules &>/dev/null && echo "libpam-modules is installed"
```

Run the following command to verify `libpam-modules` is the latest version:

```bash
# apt list --upgradable 2>&1 | grep -P '^libpam-modules\b'
```

## Expected Result

The first command should return:

```
libpam-modules is installed
```

The second command should return nothing.

## Remediation

### Command Line

Run the following command to install the latest version of `libpam-modules`:

```bash
# apt install libpam-modules
```

## References

None listed.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 0.0 Explicitly Not Mapped | | | |
| v7 | 0.0 Explicitly Not Mapped | | | |
