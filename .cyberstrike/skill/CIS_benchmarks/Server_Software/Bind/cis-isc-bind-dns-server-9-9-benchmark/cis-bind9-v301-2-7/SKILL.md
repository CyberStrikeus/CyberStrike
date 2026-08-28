---
name: cis-bind9-v301-2-7
description: "Set Group and Other Permissions Read-Only for BIND Non-Runtime Directories (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.7"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.7 — Set Group and Other Permissions Read-Only for BIND Non-Runtime Directories

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

All the BIND directories except the run-time directories into which BIND will create files should have group and other permissions set to not be writable. No directories in the `BIND_HOME` or the `RUNDIR` should have other write permissions, even a `chroot`'ed `tmp` directory only needs to be writable by the named group.

## Rationale

Restricting permissions on the directories provides defense in depth and will reduce the probability of unauthorized modifications to important files. If there was a BIND vulnerability that allowed code execution as the named user, then the code would not be able create or modify configuration files.

## Impact

Not Applicable

## Audit Procedure

Ensure the `BIND_HOME` and runtime directory variables are set as specified in the overview without a trailing slash on the directory name. Run the commands below to ensure that all BIND directories are read-only for other, and read-only for group except for the expected run time directories where the named service will create files.

```bash
# find $BIND_HOME -type d -perm /020 | egrep -vx \
$DYNDIR\|$SLAVEDIR\|$DATADIR\|$RUNDIR\|$LOGDIR\|$TMPDIR

# find $BIND_HOME $RUNDIR -type d -perm /002
```

There should be no files listed in the output from the find commands.

## Remediation

Perform the following:

- Capture the output from the audit commands above into a file named `write-dirs.txt`
- Review the purpose for the identified directories and either delete them if the directory is not needed, or change the permissions of the directory to not be writable by group or other.
- The following command can be used to change the permissions of the directories that are appropriate.

```bash
xargs -a write-dirs.txt chmod go-w
```

## Default Value

The default rpm install has all non-runtime directories without group or other write access.

## References

Not Applicable

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.4 - Protect Information with Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                                           |
| --------------- | --------------------------------------------------- |
| Defense Evasion | T1222 - File and Directory Permissions Modification |
| Persistence     | T1546 - Event Triggered Execution                   |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
