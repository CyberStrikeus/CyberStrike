---
name: cis-bind-v100-3-1
description: "Ignore Erroneous or Unwanted Queries (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, restricting-queries]
cis_id: "3.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.1 — Ignore Erroneous or Unwanted Queries

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
BIND can be configured to ignore requests originating from specified network segments. This is accomplished by implementing the `blackhole` option in `named.conf`. It is recommended that this feature be implemented to ignore requests that originate outside of expected network segments.

## Rationale
By ignoring traffic that originates from unexpected networks, the server's exposure to malicious entities is reduced.

## Impact
Not specified in the PDF.

## Audit Procedure
Attempt to query the server from an address that has been placed in the `blackhole` list. If properly configured, the query will fail.

```
nslookup www.google.com ns1.example.com
```

## Remediation
Add a `blackhole` option for multicast and link local addresses, and all private RFC 1918 addresses that are not being used.

```
blackhole {
     // Private RFC 1918 addresses
     10/8; 192.168/16; 172.16/12;
     // Multicast
     224/8;
     // Link Local
     169.254/16;
};
```

## Default Value
No networks are `blackhole`'d by default.

## References
Not specified in the PDF.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9 Limitation and Control of Network Ports, Protocols, and Services | Y | Y | Y |
| v7 | 9 Limitation and Control of Network Ports, Protocols, and Services | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1562 - Impair Defenses |
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
