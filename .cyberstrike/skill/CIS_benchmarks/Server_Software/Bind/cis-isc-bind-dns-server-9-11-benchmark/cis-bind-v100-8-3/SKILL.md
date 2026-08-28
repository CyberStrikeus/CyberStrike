---
name: cis-bind-v100-8-3
description: "Ensure Any Signing Keys using RSA Have a Length of 2048 or Greater (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, dnssec]
cis_id: "8.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-326]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.3 — Ensure Any Signing Keys using RSA Have a Length of 2048 or Greater

## Profile Applicability

- Authoritative Name Server Level 2

## Description

If one of the RSA digital signature algorithms is used, then then key length should be at least 2048 bits. The Elliptic Curve algorithms have sufficient key length without any additional options, and will provide for smaller signed DNS responses then the RSA algorithms.

## Rationale

RSA keys of 1024 bits in length are no longer considered secure against brute force attacks. A key length of at least 2048 bits is required.

## Impact

Not specified.

## Audit Procedure

To perform an audit, search the private key files for the RSA 'Prime1:' string and check that BASE64 encoded value is at least 172 characters long. The awk command below can be used to automate the check.

```
# find . -name 'K*.private' -print0 | xargs -0 awk -e '/^Prime1:/ {print FILENAME,length($2)}'
'/^Prime1:/ {print FILENAME,length($2)}'
./Kcisecurity.org.+008+42363.private 172
./Kexample.org.+008+11725.private 172
./Kweak-rsa1024.com.+008+50106.private 88
```

## Remediation

To remediate a weak RSA key, perform the following:

- Generate a new key to replace the weak key using dnssec-keygen and one of the recommended algorithms and key lengths. Examples commands are shown below.

```
# dnssec-keygen -a RSASHA256 -b 2048 example.com
# dnssec-keygen -a ECDSAP384SHA384 cisecurity.org
```

- Implement a rollover period to phase out the weak key and replace it with the the newly generated key.
- Once the key is fully deleted from the active use, remove the file.

## Default Value

If an RSA algorithm is chosen the default key length is 1024 for the ZSK and 2048 for the KSK.

## References

1. https://en.wikipedia.org/wiki/Key_size#Asymmetric_algorithm_key_lengths
2. https://arstechnica.com/uncategorized/2007/05/researchers-307-digit-key-crack-endangers-1024-bit-rsa/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
| ---------------- | ------- | ---- | ---- | ---- |
| v7               | N/A     | N    | N    | N    |

## MITRE ATT&CK Mappings

| Tactic          | Technique               |
| --------------- | ----------------------- |
| Defense Evasion | T1600 Weaken Encryption |

## Profile

- Level 2 - Authoritative Name Server
