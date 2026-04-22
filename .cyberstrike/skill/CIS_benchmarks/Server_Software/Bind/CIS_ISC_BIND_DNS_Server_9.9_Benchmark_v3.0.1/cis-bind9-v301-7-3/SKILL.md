---
name: cis-bind9-v301-7-3
description: "Disable the dnssec-accept-expired Option (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, secure-network, dnssec]
cis_id: "7.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 7.3 — Disable the dnssec-accept-expired Option

## Profile Applicability
- Level 1 - Caching Only Name Server

## Description
The `dnssec-accept-expired` option allows BIND to accept expired signatures during validation. The option should be disabled so that expired signatures will not be accepted.

## Rationale
Allowing expired signatures would leave the server vulnerable to replay attacks.

## Impact
None noted.

## Audit Procedure
Verify the `dnssec-accept-expired` option is not present in the configuration files, or is set to a value of `no`.

```bash
# grep dnssec-accept-expired $INCLUDE_FILES
/var/named/chroot/etc/named.conf:    dnssec-accept-expired no;
```

## Remediation
Change the `dnssec-accept-expired` option to have a value of `no`, or remove the option from the configuration files.

## Default Value
The `dnssec-accept-expired` option is disabled by default.

## References
None listed.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9 - Limitation and Control of Network Ports, Protocols, and Services | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1557 - Adversary-in-the-Middle |
| Impact | T1565 - Data Manipulation |

## Profile
- Level 1 - Caching Only Name Server
