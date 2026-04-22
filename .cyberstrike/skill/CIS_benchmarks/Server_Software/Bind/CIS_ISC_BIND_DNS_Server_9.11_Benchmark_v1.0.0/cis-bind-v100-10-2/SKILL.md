---
name: cis-bind-v100-10-2
description: "Ensure BIND Processes Run in the named_t Confined Context Type (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, selinux]
cis_id: "10.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux, selinux]
cwe_ids: [CWE-732]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 10.2 — Ensure BIND Processes Run in the named_t Confined Context Type

## Profile Applicability
- Caching Only Name Server Level 2
- Authoritative Name Server Level 2

## Description
SELinux includes customizable targeted policies that may be used to confine the BIND named server to enforce least privileges so that the server has only the minimal access to specified directories, files and network ports. Access is controlled by process types (domains) defined for the named process. There are about a dozen related types defined in a default named SELinux policy. The default SELinux policies work well for a default BIND installation, however testing of the SELinux policies with the specific BIND operations is highly recommended. All directories and files to be accessed by the named server process must have security labels with appropriate types. The following file context types are a sample of the most commonly used:

- `named_cache_t` - Directories and files with dynamically updated contents
- `named_conf_t` - Directories and Configuration files to be read, but not updated
- `named_exec_t` - BIND related Executables

The `seinfo` may be used list the types that are configured. For example, the following will list the relevant types that begin with named_

```
# seinfo -t | grep ' named_'
```

The `semanage fcontext` command may be used to list file context mapping. For example:

```
# semanage fcontext -l | grep ':named_'
```

## Rationale
With the proper implementation of SELinux, vulnerabilities in the BIND named server may be prevented from being exploited due to the additional restrictions. For example, a vulnerability that allows an attacker to read inappropriate system files may be prevented from execution by SELinux because the inappropriate files are not labeled with necessary `named` specific context. Likewise writing to an unexpected directory or execution of unexpected content can be prevented by similar mandatory security labels enforced by SELinux.

## Impact
Not specified.

## Audit Procedure
Perform the following steps to determine if the recommended state is implemented: Check that the BIND named process is confined to the `named_t` SELinux context. The type is listed in the third colon separated field and should be `named_t`.

```
# ps -eZ | grep named
system_u:system_r:named_t:s0        1792 ?         00:00:00 named
```

The service is non-compliant if the output does not show a process type or shows a process type other than `named_t`.

## Remediation
If the running named process is not confined to the `named_t` SELinux context. Then check the labeled context for the named binaries and set the binary files to have a context of `named_exec_t` as shown below. The `named-checkconf` executable should have `named_checkconf_exec_t` type.

```
# ls -Z   /usr/sbin/named /usr/sbin/named-checkconf /usr/sbin/unbound-anchor
          system_u:object_r:named_exec_t:s0 /usr/sbin/named
system_u:object_r:named_checkconf_exec_t:s0 /usr/sbin/named-checkconf
          system_u:object_r:named_exec_t:s0 /usr/sbin/unbound-anchor
```

If the executable files are not labeled correctly, they may be relabeled with the `chcon` command, as shown, however the file system labeling is based on the SELinux file context mapping polices and the file system will on some occasions be relabeled according to the policy.

```
# chcon -t named_exec_t /usr/sbin/named /usr/sbin/unbound-anchor
# chcon -t named_checkconf_exec_t /usr/sbin/named-checkconf
```

Since the file system may be relabeled based on SELinux policy, it's best to check the SELinux policy with `semanage fcontext -l` option. If the policy is not present, then add the pattern to the policy using the `--add` option. The `restorecon` command shown below will restore the file context label according to the current policy, which is required if a pattern was added.

```
# ### Check the Policy
# semanage fcontext -l | grep '/usr/sbin/named*'
/usr/sbin/named           regular file system_u:object_r:named_exec_t:s0
/usr/sbin/named-checkconf   regular file
system_u:object_r:named_checkconf_exec_t:
s0

# semanage fcontext -l | grep /usr/sbin/unbound-anchor
/usr/sbin/unbound-anchor    regular file system_u:object_r:named_exec_t:s0

# ### Add to the policy, if not present
# semanage fcontext --add -f f -t named_exec_t /usr/sbin/named
# semanage fcontext --add -f f -t named_exec_t /usr/sbin/unbound-anchor
# semanage fcontext --add -f f -t named_checkconf_exec_t /usr/sbin/named-checkconf

# ### Restore the file labeling accord to the SELinux policy
# restorecon -v /usr/sbin/named /usr/sbin/named-checkconf /usr/sbin/unbound-anchor
```

Restarting the BIND named service will also be required.

## Default Value
The `name_t` is the default type for ISC BIND named if SELinux is enabled.

## References
1. https://wiki.centos.org/HowTos/SELinux

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 14.4 Protect Information With Access Control Lists | Y | Y | Y |
| v7 | 14.6 Protect Information through Access Control Lists | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1548 Abuse Elevation Control Mechanism |

## Profile
- Level 2 - Authoritative Name Server
- Level 2 - Caching Only Name Server
