---
name: cis-bind9-v301-2-8
description: "Set Group and Other Permissions Read-Only for All BIND Files (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.8"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.8 — Set Group and Other Permissions Read-Only for All BIND Files

## Profile Applicability
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description
All the files in BIND home and run time directories should have group and other permissions set to not be writable. Configuration files should, of course, not be writable by named, and any run time files created by BIND will be owned by named and writable by the user. Therefore, there are no exceptions required for the run time files.

## Rationale
Restricting permissions on the files provides defense in depth and will reduce the probability of unauthorized modifications to important files. If there was a BIND vulnerability that allowed code execution as the named user, then the code would not be able to modify configuration files.

## Impact
Not Applicable

## Audit Procedure
Run the command below to ensure that all BIND files are read-only for group and other. Note that a `chroot`'ed directory will have some special files which may need to be writable. Special files includes device files, like dev/null and a socket file for logging, but the `-type f` restricts the find to just regular files.

```bash
# find $BIND_HOME $RUNDIR -type f -perm /022
```

There should be no files listed in the output from the find command.

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
The default rpm install has all BIND files without group or other write access.

## References
Not Applicable

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 14.4 - Protect Information with Access Control Lists | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1222 - File and Directory Permissions Modification |
| Persistence | T1546 - Event Triggered Execution |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
