---
name: cis-bind-v100-4-5
description: "Protect TSIG Key Files During Deployment (Manual)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, tsig]
cis_id: "4.5"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.5 — Protect TSIG Key Files During Deployment

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

Do not expose the TSIG key files through insecure network transmission of the files when deployed, or via insecure permissions or shares on any intermediate systems used for the key deployment.

## Rationale

The secret key protects the authenticity and integrity of TSIG communications and disclosure of a key would allow an attacker to perform the authenticated operations such as `rndc` administrative operations, zone transfers or dynamic updates.

## Impact

Not specified in the PDF.

## Audit Procedure

Review the technical procedure for generating and deploying the TSIG keys to ensure the files are not inappropriately disclosed on the original systems where the key is generated, on any intermediate systems, or file shares. Also, ensure that the process does not allow the keys to be copied over the network via clear text of weak file transfer protocols, such as `telnet`, `ftp` or `rcp`.

## Remediation

Perform the following:

- Correct the deployment procedure to ensure secure transmission and intermediate storage protection of keys during deployment.
- Regenerate new keys via the corrected procedure and replace all previous TSIG keys.

## Default Value

Not specified in the PDF.

## References

Not specified in the PDF.

## CIS Controls

| Controls Version | Control                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.2 Encrypt All Sensitive Information Over Less-trusted Networks | N    | Y    | Y    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit                 | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                       |
| ----------------- | ------------------------------- |
| Credential Access | T1040 - Network Sniffing        |
| Collection        | T1557 - Adversary-in-the-Middle |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
