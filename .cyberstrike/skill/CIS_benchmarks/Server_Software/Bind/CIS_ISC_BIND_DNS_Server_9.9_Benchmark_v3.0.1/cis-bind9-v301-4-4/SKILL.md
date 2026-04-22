---
name: cis-bind9-v301-4-4
description: "Restrict Access to All Key Files (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, tsig]
cis_id: "4.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.4 — Restrict Access to All Key Files

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

The TSIG keys should be readable only by the named and root accounts. No other user accounts or groups should have read access. Note that BIND often creates a session key on startup for usage by `nsupdate -l`. Both the `$BIND_HOME` and `$RUNDIR` are included since the session key should also have the recommended permissions.

## Rationale

The secret key protects the authenticity and integrity of TSIG communications and disclosure of a key would allow an attacker to perform the authenticated operations such as `rndc` administrative operations, zone transfers or dynamic updates.

## Impact

None noted.

## Audit Procedure

Perform the following to audit the recommendation:

- Find all of the TSIG key files in the `$BIND_HOME` and `$RUNDIR` directory, and capture the list to a file named `key_file.txt` in a `tmp` directory with the command below. If the `RUNDIR` is a subdirectory of `BIND_HOME`, which is typical for a `chroot`'ed directory, then some key files may be found twice. Duplicates are removed by the final sort command.

```bash
# find $BIND_HOME $RUNDIR -type f | xargs fgrep -l secret | sort -u > $TMPDIR/key_files.txt
```

- Check for appropriate ownership, group and permissions on the files with the following commands.

```bash
# find $(cat $TMPDIR/key_files.txt ) \! \( -user root -o -user named \) -ls
# find $(cat $TMPDIR/key_files.txt ) \! \( -group root -o -group named \) -ls
# find $(cat $TMPDIR/key_files.txt ) -perm /022
```

- There should be no output from the three find commands. Remove the temporary file.

```bash
rm $TMPDIR/key_files.txt
```

## Remediation

Perform the following for remediation:

- Use the command below to find secret key files. Review the list of key files, and delete any unused or unnecessary key files. Recreate the file list, after deleting any unused files.

```bash
# find $BIND_HOME $RUNDIR -type f | xargs fgrep -l secret | sort -u > $TMPDIR/key_files.txt
```

- Change the ownership, group and permissions on the key files.

```bash
# xargs -a $TMPDIR/key_files.txt chown -R root
# xargs -a $TMPDIR/key_files.txt chgrp -R named
# xargs -a $TMPDIR/key_files.txt chmod o-r
```

- Remove the temporary file.

```bash
rm $TMPDIR/key_files.txt
```

## Default Value

Ownership, Group and Permissions are correct for any default key files.

## References

None listed.

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.4 - Protect Information with Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                        |
| ----------------- | -------------------------------- |
| Credential Access | T1552 - Unsecured Credentials    |
| Credential Access | T1552.001 - Credentials In Files |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
