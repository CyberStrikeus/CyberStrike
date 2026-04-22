---
name: cis-bind-v100-9-1
description: "Apply Applicable Updates (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, operations, logging]
cis_id: "9.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-1104]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 9.1 — Apply Applicable Updates

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
Over time, patches will be released to resolve defects in BIND. It is recommended that such patches be applied soon after they are available based on risk. High risk vulnerabilities should be patched within 30 days of availability.

## Rationale
By ensuring that BIND remains current and patched, the probability of an attacker successfully compromising BIND is reduced.

## Impact
Not specified.

## Audit Procedure
Verify that the latest patch for the platform version of BIND is installed within 30 days of being available. Use the `-v` option to `named` to get the details version information.

```
$ /sbin/named -v
BIND 9.11.4-P2-RedHat-9.11.4-x.x.x
```

## Remediation
Update BIND to the most current revision available. Institute a patch process that aims to apply security updates within 30 days of their release. Subscribe to bind-announce@lists.isc.org on the https://www.isc.org web site to receive notifications of available BIND updates.

## Default Value
Not Applicable

## References
1. https://www.isc.org/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 4 Continuous Vulnerability Assessment and Remediation | Y | Y | Y |
| v7 | 3 Continuous Vulnerability Management | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1190 Exploit Public-Facing Application |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
