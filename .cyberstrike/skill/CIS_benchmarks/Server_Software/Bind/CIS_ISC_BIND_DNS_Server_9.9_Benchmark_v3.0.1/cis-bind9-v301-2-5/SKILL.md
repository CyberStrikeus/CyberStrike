---
name: cis-bind9-v301-2-5
description: "Set root Ownership of BIND Configuration Files (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.5"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.5 — Set root Ownership of BIND Configuration Files

## Profile Applicability
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description
The configuration files in the ISC BIND directories should be owned by root. Of course, any files created at run time by BIND, such as `pid` files, log files and slave zone files will necessarily be owned by named.

## Rationale
Restricting ownership of the configuration files provides defense in depth and will reduce the probability of unauthorized modifications to those important files. If there was a BIND vulnerability that allowed code execution as the named user, then the code would not be able modify the configuration files.

## Impact
Not Applicable

## Audit Procedure
Run the command below to ensure that all BIND configuration files are owned by root, except for those found in the run-time directories. Ensure that the BIND benchmark variables used below are set as described in the benchmark overview, as these variables identify the run-time directories. (`$DYNDIR`, `$SLAVEDIR`, `$DATADIR`, `$RUNDIR`, `$LOGDIR`, `$TMPDIR`) If a `chroot`'ed directory is not used, then `$LOGDIR` and `$TMPDIR` are not generally a subdirectory of `$BIND_HOME`, and the two directories may be omitted, however including them will not cause any errors or false positives.

```bash
# find $BIND_HOME -type f \! -user root | egrep -v \
\^$DYNDIR\|^\$SLAVEDIR\^$DATADIR\|^\$RUNDIR\|^\$LOGDIR\|^\$TMPDIR
```

There should be no files listed in the output from the find command.

## Remediation
Perform the following:

- Capture the output of the previous audit command to a file named `nonroot-files.txt` and review any files not owned by root to ensure the files are necessary and are not expected run-time files. Delete any unnecessary files, and ensure any run-time files are being created in the appropriate run-time directory.

```bash
# find $BIND_HOME -type f \! -user root | egrep -v \
\^$DYNDIR\|^\$SLAVEDIR\^$DATADIR\|^\$RUNDIR\|^\$LOGDIR\|^\$TMPDIR > \
$TMPDIR/nonroot-files.txt
```

- The remaining non-run-time files should be changed to be owned by root, with a command like the following:

```bash
# cat $TMPDIR/nonroot-files.txt | xargs chown root
# rm $TMPDIR/nonroot-files.txt
```

## Default Value
The default rpm has all configuration files owned by root.

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
