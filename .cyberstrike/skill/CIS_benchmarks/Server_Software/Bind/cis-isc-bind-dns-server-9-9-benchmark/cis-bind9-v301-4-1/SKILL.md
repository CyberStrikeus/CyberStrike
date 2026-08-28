---
name: cis-bind9-v301-4-1
description: "Use TSIG Keys 256 Bits in Length (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, tsig]
cis_id: "4.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1 — Use TSIG Keys 256 Bits in Length

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

The TSIG secret keys used by the name server should be generated from a good source of entropy and should be at least 256 bits in length.

## Rationale

Weak cryptographic keys may allow cryptographic attacks to discover the key value, through repeated guesses. A strong HMAC key requires a good source of entropy and at least 256 bits in length.

## Impact

None noted.

## Audit Procedure

To check if the secret key is at least 256 bits long before encoding then the `base64` encoded value should be 44 characters long or longer with the padding and a trailing `=`. To easily count the number of characters, copy the key value into the quoted value in the command below.

```bash
$ echo -n "ezoZopbE4Q73HShuFYlf3FRvLWjtNXI5fd0TeQAYOug=" | wc -c
44
```

## Remediation

For remediation, replace any keys which are too short with a securely generated key with a length of 256 or 512. The `dnssec-keygen` command below can be used to generate a key.

```bash
$ dnssec-keygen -a HMAC-SHA256 -b 256 -n HOST ns1-ns2.cisecurity.org.

$ cat Kns1-ns2.cisecurity.org.+163+21730.key
ns1-ns2.cisecurity.org. IN KEY 512 3 163
ezoZopbE4Q73HShuFYlf3FRvLWjtNXI5fd0TeQAYOug=
```

## Default Value

The `rndc` key is generated as 128 bits during `bind-utils` package install, while the `nsupdate` session key is dynamically generated with a length of 256 bits.

## References

None listed.

## CIS Controls

| Controls Version | Control                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.2 - Encrypt All Sensitive Information Over Less-trusted Networks | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                       |
| ----------------- | ------------------------------- |
| Credential Access | T1110 - Brute Force             |
| Lateral Movement  | T1557 - Adversary-in-the-Middle |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
