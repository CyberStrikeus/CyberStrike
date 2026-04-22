---
name: cis-bind9-v301-5-3
description: "Securely Authenticate Update Forwarding (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, zone-transfers]
cis_id: "5.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.3 — Securely Authenticate Update Forwarding

## Profile Applicability

- Level 1 - Authoritative Name Server

## Description

A secondary authoritative name server is allowed to accept zone updates on behalf of the primary name server, and forward them to the master name server, where the zone file can be updated. In this case, the authentication of the dynamic updates is configured with the allow-update-forwarding option. The update requests must be securely authenticated with a key identifier, rather than by an IP address. The key identifier may specify a `TSIG` key, a `GSS-TSIG`, or a `SIG(0)` key.

## Rationale

Of course, allowing unauthenticated updates to a zone should not be allowed. It is necessary for the secondary authoritative name server to carefully authenticate the update request before sending it on to the primary name server, to prevent malicious DNS updates be propagated via the secondary server.

## Impact

None noted.

## Audit Procedure

Search for the allow-update-forwarding option in all of the included configuration files, and in the zone files. If any allow-update-forwarding options are present, then verify that there are no IP addresses or networks used for authentication. Instead a key identifier should be used, or the value `none` may be used to disable dynamic updates. Note that the key identifiers, may reference a `TSIG` key, `GSS-TSIG` key or `SIG(0)` key. Use the grep command below to search for allow-update-forwarding options, and verify that either key identifiers or the value `none` are used in each.

```bash
# grep allow-update-forwarding $CONFIG_FILES $ZONE_FILES
/etc/named.conf: allow-update-forwarding { none; };
/. . ./dyn.internal.org: allow-update-forwarding { key dhcp-server.internal.org.; };
```

## Remediation

Modify any `allow-update-forwarding` options to specify a securely generated `TSIG` or `SIG(0)` key identifier used by the DHCP server.

## Default Value

Dynamic updates are disabled by default.

## References

None listed.

## CIS Controls

| Controls Version | Control                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 9 - Limitation and Control of Network Ports, Protocols, and Services | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic | Technique                                 |
| ------ | ----------------------------------------- |
| Impact | T1565 - Data Manipulation                 |
| Impact | T1565.002 - Transmitted Data Manipulation |

## Profile

- Level 1 - Authoritative Name Server
