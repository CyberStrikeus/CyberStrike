---
name: cis-bind-v100-8-7
description: "Ensure Signing Keys are Unique (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, dnssec]
cis_id: "8.7"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-323]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.7 — Ensure Signing Keys are Unique

## Profile Applicability
- Authoritative Name Server Level 2

## Description
Each zone should have a unique Zone Signing Keys (ZSK) and a unique Key Signing Keys (KSK) that is different from all other keys.

## Rationale
The ZSK key typically has a shorter expiration date then the KSK, and should be unique from the KSK as well as keys used for other zones. If a private key is compromised, the damage is limited to unique key that was disclosed, rather the compromising multiple zones.

## Impact
Not specified.

## Audit Procedure
To verify each key is unique, and has unique zone usage, perform the following:

- The sample command below will extract the public keys from the key files and count the number of occurrences of each key value

```
# find $KEYDIR -name '*.key' |  xargs grep -ho 'DNSKEY .*' | sort | uniq -c
```

The count occurrences preceding each key should be one in the output.

- To find the file names of duplicates key values, reuse the find command, but have the grep command report the file names for a given key value. For example:

```
# find $KEYDIR -name '*.key' |  xargs  grep -l ' <key value>
```

## Remediation
To remediate a duplicate key, perform the following:

- Generate a new key to replace the duplicate key using dnssec-keygen and one of the recommended algorithms. An example command is shown below:

```
# dnssec-keygen -a ECDSAP256SHA256 example.org
```

- Implement a rollover period to phase out the duplicate key and replace it with the the newly generated key.
- Once the key is fully deleted from the active use, remove the file.

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
| Credential Access | T1552 Unsecured Credentials |

## Profile
- Level 2 - Authoritative Name Server
