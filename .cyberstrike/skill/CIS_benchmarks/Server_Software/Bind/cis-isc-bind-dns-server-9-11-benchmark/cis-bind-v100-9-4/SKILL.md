---
name: cis-bind-v100-9-4
description: "Disable the HTTP Statistics Server (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, operations]
cis_id: "9.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-1188]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 9.4 — Disable the HTTP Statistics Server

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

Starting in BIND 9.5.0 there was a new statistics web server included, that is a useful debugging tool in a non-production environment. The HTTP server provide data in XML format about the condition of a BIND 9 server. The statistics server provides the same statistics that are available to the statistics-file dump. This server should be left disabled.

## Rationale

A production name server should not have additional, unnecessary services running, as the additional services increases the risk of vulnerabilities.

## Impact

Not specified.

## Audit Procedure

Verify that there is NOT a statistics channel statement:

```
# grep statistics-channel $CONFIG_FILES
```

No output is expected and confirms that the HTTP service is not enabled.

## Remediation

Remove the `statistics-channel` option from the configuration file.

## Default Value

The HTTP server is disabled by default.

## References

None listed in benchmark.

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v6               | 9.1 Limit Open Ports, Protocols, and Services                      | Y    | Y    | Y    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic    | Technique                       |
| --------- | ------------------------------- |
| Discovery | T1046 Network Service Discovery |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
