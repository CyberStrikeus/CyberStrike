---
name: cis-bind9-v301-8-4
description: "Disable the HTTP Statistics Server (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, operations]
cis_id: "8.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.4 — Disable the HTTP Statistics Server

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

Starting in BIND 9.5.0 there was a new statistics web server included, that is a useful debugging tool in a non-production environment. The HTTP server provides data in XML format about the condition of a BIND 9 server. The statistics server provides the same statistics that are available to the statistics-file dump. This server should be left disabled.

## Rationale

A production name server should not have additional, unnecessary services running, as the additional services increases the risk of vulnerabilities.

## Impact

None noted.

## Audit Procedure

Verify that there is NOT a statistics channel statement:

```bash
# grep statistics-channel $CONFIG_FILES
```

No output is expected and confirms that the HTTP service is not enabled.

## Remediation

Remove the `statistics-channel` option from the configuration file.

## Default Value

The HTTP server is disabled by default.

## References

None listed.

## CIS Controls

| Controls Version | Control                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------- | ---- | ---- | ---- |
| v6               | 9.1 - Limit Open Ports, Protocols, and Services | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                              |
| -------------- | -------------------------------------- |
| Reconnaissance | T1592 - Gather Victim Host Information |
| Discovery      | T1046 - Network Service Discovery      |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
