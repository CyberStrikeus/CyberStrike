---
name: cis-bind-v100-2-8
description: "Set Other Permissions Read-Only for All BIND Directories and Files (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.8"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.8 — Set Other Permissions Read-Only for All BIND Directories and Files

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
All the directories and files in BIND home and run time directories should have other permissions set to not be writable. Configuration files should, of course, not be writable by named, and any run time files created by BIND will be owned by named and writable by the user. A `chroot`'ed `tmp` directory only needs to be writable by the named group. Therefore, there are no exceptions required.

## Rationale
Restricting permissions on the files provides defense in depth and will reduce the probability of unauthorized modifications to important files. If there was a BIND vulnerability that allowed code execution as the named user, then the code would not be able to modify configuration files.

## Impact
Not specified.

## Audit Procedure
Run the command below to ensure that all BIND directories and files are read-only for other. Note that a `chroot`'ed directory will have some special files which may need to be writable. Special files includes device files, like dev/null and a socket file for logging, but the `-type f` and `type d` restricts the find to just directories and regular files.

```bash
# find $BIND_HOME $RUNDIR -type f -perm /002

# find $BIND_HOME $RUNDIR -type d -perm /002
```

There should be no files listed in the output from the find commands.

## Remediation
Perform the following:

- Capture the output from the audit commands above into a file with the name `$TMPDIR/write-files.txt`
- Review the purpose for the identified files and either delete them if the file is not needed, or change the permissions of the file to not be writable by group or other.
- The following commands can be used to change the permissions of the appropriate files.

```bash
# find $BIND_HOME $RUNDIR -type f -perm /022 > $TMPDIR/write-files.txt
# xargs -a $TMPDIR/write-files.txt chmod go-w
# rm $TMPDIR/write-files.txt
```

## Default Value
The default rpm install has all BIND directories and files without group or other write access.

## References
None listed.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 14.4 Protect Information With Access Control Lists | N | Y | Y |
| v7 | 14.6 Protect Information through Access Control Lists | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1222 File and Directory Permissions Modification |
| Privilege Escalation | T1574 Hijack Execution Flow |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
