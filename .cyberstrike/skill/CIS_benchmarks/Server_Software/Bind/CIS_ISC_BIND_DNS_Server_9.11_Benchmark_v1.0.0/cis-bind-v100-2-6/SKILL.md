---
name: cis-bind-v100-2-6
description: "Set Group named or root for BIND Directories and Files (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.6"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.6 — Set Group named or root for BIND Directories and Files

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
All the BIND directories and files should have a group of either named or root.

## Rationale
In general, the BIND directories and files default to a group of named, however some system files may have a group of root. Examples of system files include `chroot`'ed system device files. Either group root or named is accepted, as the intent is to prevent unexpected group ids, from getting inappropriate access to BIND files. Run time directories to which BIND will need write access should have a group of named, so that write access may be granted via the group permissions.

## Impact
Not specified.

## Audit Procedure
Ensure that the BIND benchmark variables used below are set as described in the benchmark overview. Run the command below to ensure that all BIND directories and files have a group of either named or root.

```bash
# find $BIND_HOME $RUNDIR \! \( -group root -o -group named \) -ls
```

There should be no files listed in the output from the find command.

## Remediation
Run the command below to change all BIND directories and files to the group named.

```bash
chgrp -R named $BIND_HOME $RUNDIR
```

## Default Value
The default rpm install has all directories and files in the BIND home and the run time directory with a group of named.

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
