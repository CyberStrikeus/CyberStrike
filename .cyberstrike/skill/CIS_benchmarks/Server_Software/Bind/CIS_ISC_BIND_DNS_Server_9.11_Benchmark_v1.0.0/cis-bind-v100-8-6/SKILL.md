---
name: cis-bind-v100-8-6
description: "Ensure Full Digital Chain of Trust can be Validated (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, dnssec]
cis_id: "8.6"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-345]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.6 — Ensure Full Digital Chain of Trust can be Validated

## Profile Applicability
- Authoritative Name Server Level 2

## Description
For each authoritative domain ensure the digital signatures are is fully trusted starting from the root zone.

## Rationale
In order for the the digital signatures to be trusted by other systems, The parent zone must be a DS (delegated signer) record that verifies the authenticity of he child zones KSK (key signing key). The delegated signature forms a chain of trust, delegated down from the root zone.

## Impact
Not specified.

## Audit Procedure
To audit the chain of trust use the delv command to query an external independent validating name server. Such as:

```
$ delv @8.8.8.8 cisecurity.org
; fully validated
cisecurity.org.21599   IN      A       10.1.2.3
cisecurity.org.21599   IN      RRSIG   A 8 2 43200 20200328213257
20200224211144 42363 cisecurity.org. gqTNFiJ. . .2n4Q==
```

The output of "fully validated" indicates the zone is compliant. Other answers are not compliant, and may include "no valid signature found" and "unsigned answer".

## Remediation
If the zone has a valid signature but the signature is not trusted, the delegation from the parent zone, or the registrar may not be properly configured. Check with your parent zone administrator or with your name registrar's process to be sure the required information has been provided and that sufficient time has been allowed for new DS record to propagate. Each registrar may have slightly different processes. Generating a DS record from the KSK will liklkey provide some of the required information.

```
# dnssec-dsfromkey -a SHA-256 Kexample.com.+013+09798.key
example.com. IN DS 9798 13 2 D9AA106E44 . . .
```

## Default Value
Not specified.

## References
None listed in benchmark.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v7 | N/A | N | N | N |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1562 Impair Defenses |

## Profile
- Level 2 - Authoritative Name Server
