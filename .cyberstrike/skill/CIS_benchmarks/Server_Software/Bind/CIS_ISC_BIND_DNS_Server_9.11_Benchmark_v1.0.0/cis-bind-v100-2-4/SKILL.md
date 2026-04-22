---
name: cis-bind-v100-2-4
description: "Set root Ownership of BIND Directories (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.4 — Set root Ownership of BIND Directories

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

All of the directories under which ISC BIND runs should be owned by root. Of course, any files created at run time by BIND will still be owned by named, and the run time files will need to be in a directory writable by the named group.

## Rationale

Restricting ownership of the directories provides defense in depth and will reduce the probability of unauthorized modifications to those resources. If there was a BIND vulnerability that allowed code execution as the named user, then the code would not be able to modify permissions on the BIND directories owned by root.

## Impact

Not specified.

## Audit Procedure

Ensure that the variable `$BIND_HOME` is set to the directory under which BIND runs, typically the directory `/var/named/`. In the case of a `chroot`'ed configuration, the daemon will likely run under `/var/named/chroot/`, however the upper level directory of `/var/named/` should still be used as it is specific to the BIND service, and will include the `chroot` directory. Also, the variable `$RUNDIR` should be set to the directory which is used to create run-time files such as the `pid` file and session-key. Perform the following to ensure the directory ownership:

```bash
# find $BIND_HOME $RUNDIR -type d \! -user root -ls
```

There should be NO directories listed in the output from the find command.

## Remediation

To correct the directory ownership, perform the following:

```bash
find $BIND_HOME $RUNDIR -type d \! -user root | xargs chown root
```

**Note:** it is important to remember that the run time files will need to be in a directory writable by the named group. Changing the directory ownership to root might cause permissions issues, if the group permissions are not writable.

## Default Value

The following directories are owned by `named` in the default package install:

- /var/named/dynamic
- /var/named/slaves
- /var/named/data
- /run/named

## References

None listed.

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.4 Protect Information With Access Control Lists    | N    | Y    | Y    |
| v7               | 14.6 Protect Information through Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique                                         |
| -------------------- | ------------------------------------------------- |
| Privilege Escalation | T1574 Hijack Execution Flow                       |
| Defense Evasion      | T1222 File and Directory Permissions Modification |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
