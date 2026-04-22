---
name: cis-ubuntu1204-v110-4-1
description: "Restrict Core Dumps"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, process-hardening, core-dumps, security-limits, sysctl]
cis_id: "4.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.1 Restrict Core Dumps (Scored)

## Profile Applicability

- Level 1

## Description

A core dump is the memory of an executable program. It is generally used to determine why a program aborted. It can also be used to glean confidential information from a core file. The system provides the ability to set a soft limit for core dumps, but this can be overridden by the user.

## Rationale

Setting a hard limit on core dumps prevents users from overriding the soft variable. If core dumps are required, consider setting limits for user groups (see `limits.conf(5)`). In addition, setting the `fs.suid_dumpable` variable to 0 will prevent setuid programs from dumping core. The `apport` service if active will override the `fs.suid_dumpable` variable setting and automatically create core dump reports. The `whoopsie` service monitors `apport` core dump reports and transmits them to Canonical.

## Audit Procedure

### Using Command Line

Perform the following to determine if core dumps are restricted:

```bash
grep "hard core" /etc/security/limits.conf
sysctl fs.suid_dumpable
```

Ensure no start conditions are listed for the apport or whoopsie services:

```bash
initctl show-config apport apport
initctl show-config whoopsie whoopsie
```

## Expected Result

The first command should return: `* hard core 0`
The second command should return: `fs.suid_dumpable = 0`
The apport and whoopsie services should have no start conditions or be disabled.

## Remediation

### Using Command Line

Add the following line to the `/etc/security/limits.conf` file:

```
* hard core 0
```

Add the following line to the `/etc/sysctl.conf` file:

```
fs.suid_dumpable = 0
```

Uninstall the `apport` and `whoopsie` packages or comment out any start lines in `/etc/init/apport.conf` and `/etc/init/whoopsie.conf` files:

```
#start on runlevel [2345]
```

## Default Value

By default, core dumps are enabled and `apport` may be active on Ubuntu 12.04.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
