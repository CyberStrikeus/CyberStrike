---
name: cis-ubuntu1204-v110-8-2-4
description: "Create and Set Permissions on rsyslog Log Files"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, rsyslog, permissions, log-files]
cis_id: "8.2.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.2.4 Create and Set Permissions on rsyslog Log Files (Scored)

## Profile Applicability

- Level 1

## Description

A log file must already exist for `rsyslog` to be able to write to it.

## Rationale

It is important to ensure that log files exist and have the correct permissions to ensure that sensitive `rsyslog` data is archived and protected.

## Audit Procedure

### Using Command Line

For each `<logfile>` listed in the `/etc/rsyslog.conf` file, perform the following command and verify that the `<owner>:<group>` is `root:root` and the permissions are `0600` (for sites that have not implemented a secure group) and `root:securegrp` with permissions of `0640` (for sites that have implemented a secure group):

```bash
ls -l <logfile>
```

## Expected Result

Log files should be owned by `root:root` with permissions `0600` or `root:securegrp` with permissions `0640`.

## Remediation

### Using Command Line

For sites that have **not** implemented a secure admin group:

Create the `/var/log/` directory and for each `<logfile>` listed in the `/etc/rsyslog.conf` or `/etc/rsyslog.d/*` files, perform the following commands:

```bash
touch <logfile>
chown root:root <logfile>
chmod og-rwx <logfile>
```

For sites that **have** implemented a secure admin group:

Create the `/var/log/` directory and for each `<logfile>` listed in the `/etc/rsyslog.conf` file, perform the following commands (where `securegrp` is the name of the security group):

```bash
touch <logfile>
chown root:<securegrp> <logfile>
chmod g-wx,o-rwx <logfile>
```

## Default Value

By default, log files may have varying permissions depending on the installation.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- See the rsyslog.conf(5) man page for more information.

## Profile

Level 1 - Scored
