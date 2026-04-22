---
name: cis-bind9-v301-1-5
description: "Installing ISC BIND 9 (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, planning-and-architecture]
cis_id: "1.5"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.5 — Installing ISC BIND 9

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

The ISC BIND Benchmark recommends using the binary packages provided by your platform vendor for most situations in order to reduce the effort and increase the effectiveness of maintenance and security patches. The Red Hat Enterprise Linux 7 has been used for testing the benchmark.

## Rationale

The benefits of using the vendor supplied binaries include:

- Ease of installation.
- It is customized for your OS environment.
- It will be tested and have gone through QA procedures.
- Additional software you may need is likely to be included, such as `chroot` setup and startup scripts.
- Your vendor will tell you about security issues so you have to look in less places.
- Updates to fix security issues will be easier to apply.

However, building from source is suitable for those that want full control of the build process, prefer to build from source, or do not have a suitable package available for their platform. Source download and build information is available on the ISC website knowledge base at the URL reference below.

## Impact

Not Applicable

## Audit Procedure

Perform the following commands to check for an installed BIND rpm and to search the current path for the named executable.

```bash
# rpm -q bind
bind-9.9.4-29.el7_2.3.x86_64

# which named
/sbin/named
```

## Remediation

Installation depends on the operating system platform. The following commands were tested on RHEL7.

```bash
# yum install bind
. . .
# yum install bind-chroot
. . .
```

## Default Value

Not Applicable

## References

1. https://kb.isc.org/article/AA-00768/0/Getting-started-with-BIND-how-to-build-and-run-named-with-a-basic-recursive-configuration.html

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v6               | 2 - Inventory of Authorized and Unauthorized Software | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                                 |
| -------------- | ----------------------------------------- |
| Execution      | T1059 - Command and Scripting Interpreter |
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
