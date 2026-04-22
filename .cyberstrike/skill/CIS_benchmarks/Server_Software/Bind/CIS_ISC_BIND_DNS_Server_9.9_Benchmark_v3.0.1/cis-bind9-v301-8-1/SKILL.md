---
name: cis-bind9-v301-8-1
description: "Apply Applicable Updates (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, operations, logging]
cis_id: "8.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.1 — Apply Applicable Updates

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

Over time, patches will be released to resolve defects in BIND. It is recommended that such patches be applied soon after they are available based on risk. High risk vulnerabilities should be patched within 30 days of availability.

## Rationale

By ensuring that BIND remains current and patched, the probability of an attacker successfully compromising BIND is reduced.

## Impact

None noted.

## Audit Procedure

Verify that the latest patch for the platform version of BIND is installed within 30 days of being available. Use the `-v` option to `named` to get the details version information.

```bash
$ /sbin/named -v
BIND 9.9.4-RedHat-9.9.4-29.el7_2.4 (Extended Support Version)
```

## Remediation

Update BIND to the most current revision available. Institute a patch process that aims to apply security updates within 30 days of their release. Subscribe to bind-announce@lists.isc.org on the https://www.isc.org web site to receive notifications of available BIND updates.

## Default Value

Not Applicable

## References

1. https://www.isc.org/

## CIS Controls

| Controls Version | Control                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 4 - Continuous Vulnerability Assessment and Remediation | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                                 |
| -------------- | ----------------------------------------- |
| Initial Access | T1190 - Exploit Public-Facing Application |
| Execution      | T1203 - Exploitation for Client Execution |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
