---
name: cis-ubuntu1204-v110-8-1-2
description: "Install and Enable auditd Service"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, service]
cis_id: "8.1.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.2 Install and Enable auditd Service (Scored)

## Profile Applicability

- Level 2

## Description

Install and turn on the `auditd` daemon to record system events.

## Rationale

The capturing of system events provides system administrators with information to allow them to determine if unauthorized access to their system is occurring.

## Audit Procedure

### Using Command Line

Run the following to ensure `auditd` is installed:

```bash
dpkg -s auditd
```

Ensure package status is `installed ok installed`.

Run the following to ensure proper start links for `auditd` exist in `/etc/rc*.d`:

```bash
ls /etc/rc*.d/S*auditd
```

## Expected Result

```
/etc/rc2.d/S37auditd  /etc/rc3.d/S37auditd  /etc/rc4.d/S37auditd  /etc/rc5.d/S37auditd
```

Start links should exist for run levels 2, 3, 4, and 5.

## Remediation

### Using Command Line

Install auditd:

```bash
apt-get install auditd
```

If needed create proper start links for `auditd` in `/etc/rc*.d` by running the following command from each of the relevant directories:

```bash
ln -s ../init.d/auditd S37auditd
```

Start links should be created for run levels 2, 3, 4, and 5.

## Default Value

auditd is not installed by default on Ubuntu 12.04.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
