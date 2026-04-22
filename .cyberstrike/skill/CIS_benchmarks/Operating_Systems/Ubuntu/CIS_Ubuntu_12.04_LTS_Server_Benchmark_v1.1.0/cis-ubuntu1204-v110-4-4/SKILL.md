---
name: cis-ubuntu1204-v110-4-4
description: "Disable Prelink"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, process-hardening, prelink, binary-integrity, aide]
cis_id: "4.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.4 Disable Prelink (Scored)

## Profile Applicability

- Level 1

## Description

The prelinking feature changes binaries in an attempt to decrease their startup time.

## Rationale

The prelinking feature can interfere with the operation of AIDE, because it changes binaries. Prelinking can also increase the vulnerability of the system if a malicious user is able to compromise a common library such as libc.

## Audit Procedure

### Using Command Line

Run the following command:

```bash
dpkg -s prelink
```

## Expected Result

Ensure package status is not-installed or dpkg returns no info is available.

## Remediation

### Using Command Line

Run the command to restore binaries to a normal, non-prelinked state:

```bash
/usr/sbin/prelink -ua
```

Then remove prelink:

```bash
apt-get purge prelink
```

## Default Value

By default, prelink is not installed on Ubuntu 12.04.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
