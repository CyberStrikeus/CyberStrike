---
name: cis-bind9-v301-2-9
description: "Isolate BIND with chroot'ed Subdirectory (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.9"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.9 — Isolate BIND with chroot'ed Subdirectory

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

The `chroot()` system call causes an application to run with limited file system access so that a subdirectory becomes the root directory for the application environment. When this is done, the application is "jailed" and no longer has access to the entire file structure but is limited to the given subdirectory.

## Rationale

Although there are ways that a `chroot` jail can be broken, most methods require that a process be running as root in order to escape. Since BIND should be run as a different user than root, a `chroot` is an effective defense, to limit access to sensitive system configuration files. In the event that BIND has a vulnerability that allows code execution, the attack will not have access to the real system files such as `/etc/password`, but will be limited to the files placed in the `chroot` subdirectory.

## Impact

Not Applicable

## Audit Procedure

Run the following two commands to find the root directory of the currently running named process. If the named process is `chroot`'ed, then the listing will show a symbolic link to the `chroot` subdirectory. If process is not `chroot`'ed, then the symbolic link will point to the real root directory `/`.

```bash
# NAMEDPID=$(pidof named)
# ls -ld /proc/$NAMEDPID/root
lrwxrwxrwx 1 named named 0 Sep 10 13:21 /proc/423/root -> /var/named/chroot
```

## Remediation

Perform the following:

- Stop the named service and install the `bind-chroot` package to provide the `chroot` directories.

```bash
# systemctl stop named.service
# yum install bind-chroot
```

- Edit the `/etc/sysconfig/named` configuration file to have a line similar to the one shown below that sets the `ROOTDIR` environment variable.

```
ROOTDIR="/var/named/chroot"
```

- Move all the configuration files and any master zone files into their respective directions under the subdirectory `/var/named/chroot/`
- It may be helpful to create symbolic links from a couple of system `/etc` files such as `/etc/named.conf` and `/etc/rndc.key` to the real files in the `chroot`'ed subdirectory, so that utilities like `rndc` will work as expected. **Do not create symbolic links or hard links from inside the chroot to external resources!** Instead use symbolic links to point from the outside resources into the `chroot`.
- Restart the named service and test the configuration.

```bash
# systemctl start named.service
```

## Default Value

The BIND service is not chroot'ed by default.

## References

Not Applicable

## CIS Controls

| Controls Version | Control                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.4 - Protect Information with Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique                                           |
| -------------------- | --------------------------------------------------- |
| Defense Evasion      | T1222 - File and Directory Permissions Modification |
| Privilege Escalation | T1611 - Escape to Host                              |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
