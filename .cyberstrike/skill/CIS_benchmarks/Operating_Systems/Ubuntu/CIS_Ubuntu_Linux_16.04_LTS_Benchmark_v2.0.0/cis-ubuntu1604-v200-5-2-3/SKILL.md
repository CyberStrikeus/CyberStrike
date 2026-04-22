---
name: cis-ubuntu1604-v200-5-2-3
description: "Ensure sudo log file exists"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, access-control]
cis_id: "5.2.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 5.2.3

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

`sudo` can use a custom log file.

Note: visudo edits the sudoers file in a safe fashion, analogous to vipw(8). visudo locks the sudoers file against multiple simultaneous edits, provides basic sanity checks, and checks or parse errors. If the sudoers file is currently being edited you will receive a message to try again later.

## Rationale

A sudo log file simplifies auditing of sudo commands.

## Impact

None.

## Audit Procedure

### Command Line

Verify that sudo has a custom log file configured. Run the following command:

```bash
grep -Ei '^\s*Defaults\s+logfile=\S+' /etc/sudoers /etc/sudoers.d/*
```

## Expected Result

The output should include a line matching:

```
Defaults logfile="<PATH TO CUSTOM LOG FILE>"
```

Example:

```
Defaults logfile="/var/log/sudo.log"
```

## Remediation

### Command Line

Edit the file `/etc/sudoers` or a file in `/etc/sudoers.d/` with `visudo -f` and add the following line:

```
Defaults logfile="<PATH TO CUSTOM LOG FILE>"
```

Example:

```
Defaults logfile="/var/log/sudo.log"
```

## Default Value

By default, `sudo` does not have a custom log file configured.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 6.3 Enable Detailed Logging |

## Assessment Status

Automated
