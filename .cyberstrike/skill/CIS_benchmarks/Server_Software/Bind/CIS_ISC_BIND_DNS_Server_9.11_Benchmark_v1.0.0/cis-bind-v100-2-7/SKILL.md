---
name: cis-bind-v100-2-7
description: "Set Group Read-Only for BIND Files and Non-Runtime Directories (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.7"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.7 — Set Group Read-Only for BIND Files and Non-Runtime Directories

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

All of the BIND files and all of directories except the run-time directories into which BIND will create files should have group permissions set to not be writable. Any run-time files created by BIND will be owned by BIND, and therefore need not be group writable.

## Rationale

Restricting permissions on the directories and files provides defense in depth and will reduce the probability of unauthorized modifications to important files. If there was a BIND vulnerability that allowed code execution as the named user, then the code would not be able create or modify configuration files.

## Impact

Not specified.

## Audit Procedure

Ensure the `BIND_HOME` and all the runtime directory variables are set as specified in the overview **without a trailing slash** after the directory name. Run the commands below to ensure that all BIND directories are read-only for group except for the expected run time directories where the named service will create files.

```bash
# find $BIND_HOME -type d -perm /020 | egrep -vx \
   $DYNDIR\|$SLAVEDIR\|$DATADIR\|$RUNDIR\|$LOGDIR\|$TMPDIR

# find $BIND_HOME -type f -perm /020
```

There should be no files listed in the output from the find commands.

## Remediation

Perform the following:

- Capture the output from the audit commands above into a file named `write-dirs.txt`
- Review the purpose for the identified directories and either delete them if the directory is not needed, or change the permissions of the directory to not be writable by group or other.
- The following command can be used to change the permissions of the directories that are appropriate.

```bash
xargs -a write-dirs.txt chmod g-w
```

## Default Value

The default rpm install has the following non-runtime directories with group write access.

- /var/named/

## References

None listed.

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.4 Protect Information With Access Control Lists    | N    | Y    | Y    |
| v7               | 14.6 Protect Information through Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                                         |
| --------------- | ------------------------------------------------- |
| Defense Evasion | T1222 File and Directory Permissions Modification |
| Persistence     | T1574 Hijack Execution Flow                       |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
