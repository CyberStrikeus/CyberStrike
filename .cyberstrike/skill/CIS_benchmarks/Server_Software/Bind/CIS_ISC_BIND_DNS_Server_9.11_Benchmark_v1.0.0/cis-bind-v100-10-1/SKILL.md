---
name: cis-bind-v100-10-1
description: "Ensure SELinux Is Enabled in Enforcing Mode (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, selinux]
cis_id: "10.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux, selinux]
cwe_ids: [CWE-732]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 10.1 — Ensure SELinux Is Enabled in Enforcing Mode

## Profile Applicability

- Caching Only Name Server Level 2
- Authoritative Name Server Level 2

## Description

SELinux (Security-Enhanced Linux) is a Linux kernel security module that provides mandatory access control security policies with type enforcement that are checked after the traditional discretionary access controls. It was created by the US National Security Agency and can enforce rules on files and processes in a Linux system, and restrict actions, based on defined policies.

## Rationale

DNS servers act as a foundation for most of the internet and internal traffic. Web and mobile applications, email, cloud services and VPN connections, internal LAN connections all depend on DNS to translate names and route traffic to the correct destination. With DNS being such a critical service, it is a ripe target for attacks which may allow black-hat criminals to gain access to information and servers. The threat is especially high because DNS servers are often externally accessible and continue to have serious vulnerabilities. The SELinux mandatory access controls provide a much stronger security model which can be used to implement a deny-by-default model which only allows what is explicitly permitted.

## Impact

Not specified.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented: Use the `sestatus` command to check that SELinux is enabled and that both the current mode and the configured mode are set to `enforcing`.

```
$ sestatus | grep -i mode
Current mode:                 enforcing
Mode from config file:        enforcing
```

If there is no output, or both modes are not shown as enforcing, then the configuration is not compliant.

**Note:** The chroot'd subdirectory may be used as an audit alternative to the SELinux recommendations.

## Remediation

Perform the following to implement the recommended state:

If SELinux is not enabled in the configuration file, edit the file `/etc/selinux/config` and set the value of SELINUX as `enforcing` and reboot the system for the new configuration to be effective.

```
SELINUX=enforcing
```

If the current mode is not enforcing, and an immediate reboot is not possible, the current mode can be set to enforcing with the `setenable` command shown below.

```
# setenforce 1
```

## Default Value

SELinux is enforcing by default on some Linux distributions such as Red Hat Enterprise Linux 8.

## References

1. https://en.wikipedia.org/wiki/Security-Enhanced_Linux

## CIS Controls

| Controls Version | Control                                                     | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.4 Protect Information With Access Control Lists          | Y    | Y    | Y    |
| v7               | 14.6 Protect Information through Access Control Lists       | Y    | Y    | Y    |
| v7               | 14.7 Enforce Access Control to Data through Automated Tools | N    | N    | Y    |

## MITRE ATT&CK Mappings

| Tactic               | Technique                               |
| -------------------- | --------------------------------------- |
| Privilege Escalation | T1548 Abuse Elevation Control Mechanism |

## Profile

- Level 2 - Authoritative Name Server
- Level 2 - Caching Only Name Server
