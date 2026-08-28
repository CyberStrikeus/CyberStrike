---
name: cis-ubuntu2004-v300-5-3-1-1
description: "Ensure latest version of pam is installed"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1.1 Ensure latest version of pam is installed (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Linux Pluggable Authentication Modules (PAM) is a suite of libraries that allow a Linux system administrator to configure methods to authenticate users. It provides a flexible and centralized way to switch authentication methods for secured applications by using configuration files instead of changing application code.

The `libpam-runtime` provides the runtime support for the PAM library.

## Rationale

Older versions of the `libpam-runtime` package may not include the latest security and feature patches and updates.

Note: This Benchmark includes Recommendations that depend on newer `libpam-runtime` features. These Recommendations were written and tested against version `1.3.1-5ubuntu4.7`. Latest available version of the package should be used.

## Audit Procedure

### Command Line

Run the following command to verify `libpam-runtime` is installed:

```bash
# dpkg-query -s libpam-runtime &>/dev/null && echo "libpam-runtime is installed"
```

Run the following command to verify `libpam-runtime` is the latest version:

```bash
# apt list --upgradable 2>&1 | grep -P '^libpam-runtime\b'
```

## Expected Result

The first command should return:

```
libpam-runtime is installed
```

The second command should return nothing.

## Remediation

### Command Line

Run the following command to install the latest version of `libpam-runtime`:

```bash
# apt install libpam-runtime
```

## References

1. PAM(7)

## CIS Controls

| Controls Version | Control                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------- | ---- | ---- | ---- |
| v8               | 0.0 Explicitly Not Mapped |      |      |      |
| v7               | 0.0 Explicitly Not Mapped |      |      |      |
