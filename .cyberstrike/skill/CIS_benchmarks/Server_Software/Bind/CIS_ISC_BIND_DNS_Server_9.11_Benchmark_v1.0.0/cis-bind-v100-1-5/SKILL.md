---
name: cis-bind-v100-1-5
description: "Installing ISC BIND 9 (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, planning-and-architecture]
cis_id: "1.5"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.5 — Installing ISC BIND 9

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

The ISC BIND Benchmark recommends using the binary packages provided by your platform vendor for most situations in order to reduce the effort and increase the effectiveness of maintenance and security patches. Red Hat Enterprise Linux 7 and 8 have been used for testing the benchmark.

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

Not specified.

## Audit Procedure

Perform the following commands to check for an installed BIND rpm and to search the current path for the named executable, and to verify the version of bind.

```bash
# rpm -q bind
bind-9.11.-xx.xx.xx.xx

# which named
/sbin/named

# /sbin/named -v
BIND 9.11.4-xxxxx
```

## Remediation

Installation depends on the operating system platform. The following commands were tested on RHEL7 and RHEL8. On RHEL8 the yum command redirects to the newer dfm command.

```bash
# yum install bind
. . .
# yum install bind-chroot
. . .
```

## Default Value

Not specified.

## References

1. https://kb.isc.org/article/AA-00768/0/Getting-started-with-BIND-how-to-build-and-run-named-with-a-basic-recursive-configuration.html
2. https://www.isc.org/download/

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v6               | 2 Inventory of Authorized and Unauthorized Software | Y    | Y    | Y    |
| v7               | 2.1 Maintain Inventory of Authorized Software       | Y    | Y    | Y    |
| v7               | 2.2 Ensure Software is Supported by Vendor          | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                               |
| -------------- | --------------------------------------- |
| Initial Access | T1190 Exploit Public-Facing Application |
| Persistence    | T1133 External Remote Services          |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
