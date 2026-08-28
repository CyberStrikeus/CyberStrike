---
name: cis-bind-v100-4-1
description: "Use TSIG Keys 256 Bits in Length (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, tsig]
cis_id: "4.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.1 — Use TSIG Keys 256 Bits in Length

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

The TSIG secret keys used by the name server should be generated from a good source of entropy and should be at least 256 bits in length.

## Rationale

Weak cryptographic keys may allow cryptographic attacks to discover the key value, through repeated guesses. A strong HMAC key requires a good source of entropy and at least 256 bits in length.

## Impact

Not specified in the PDF.

## Audit Procedure

To check if the secret key is at least 256 bits long before encoding then the `base64` encoded value should be 44 characters long or longer with the padding and a trailing =. To easily count the number of characters, copy the key value into the quoted value in the command below.

```
$ echo -n "ezoZopbE4Q73HShuFYlf3FRvLWjtNXI5fd0TeQAYOug=" | wc -c
44
```

## Remediation

For remediation, replace any keys which are too short with a securely generated key with a length of 256 or 512. The `tsig-keygen` command below can be used to generate a key.

```
# tsig-keygen -a sha256 ns1-ns4.example.net > ns1-ns4.example.net.key
# cat ns1-ns4.example.net.key
key "ns1-ns4.example.net" {
        algorithm hmac-sha256;
        secret "ezoZopbE4Q73HShuFYlf3FRvLWjtNXI5fd0TeQAYOug=";
};
```

Ensure the key file has the appropriate file permissions, and include the file in the named configuration file.

## Default Value

The `rndc` key is generated as 256 bits during `bind-utils` package install, and the `nsupdate` session key is dynamically generated with a length of 256 bits.

## References

Not specified in the PDF.

## CIS Controls

| Controls Version | Control                                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 14.2 Encrypt All Sensitive Information Over Less-trusted Networks | N    | Y    | Y    |
| v7               | 14.4 Encrypt All Sensitive Information in Transit                 | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                 |
| ----------------- | ------------------------- |
| Credential Access | T1110 - Brute Force       |
| Defense Evasion   | T1600 - Weaken Encryption |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
