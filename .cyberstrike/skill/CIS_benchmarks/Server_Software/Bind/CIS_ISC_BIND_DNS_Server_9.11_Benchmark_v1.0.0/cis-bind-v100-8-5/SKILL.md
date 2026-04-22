---
name: cis-bind-v100-8-5
description: "Ensure each Zone has a Valid Digital Signature (Manual)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, dnssec]
cis_id: "8.5"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-345]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.5 — Ensure each Zone has a Valid Digital Signature

## Profile Applicability
- Authoritative Name Server Level 2

## Description
For each zone of the authoritative name server, verify that the signed zone file has a valid signature for each algorithm in the zone DNSKEY RRSet.

## Rationale
The zone must have a valid signature before it can be trusted by validating DNSSEC name resolvers.

## Impact
Not specified.

## Audit Procedure
Perform the following command on each zone providing the signed zone file. The example file name is 'cisecurity.org.signed' for the domain cisecurity.org. If the signed zone file is not generated from inline signing, then the format may be ASCII, and the `-I raw` should be omitted.

```
# dnssec-verify -I raw -o cisecurity.org cisecurity.org.signed
Loading zone 'cisecurity.org' from file 'cisecurity.org.signed'
Verifying the zone using the following algorithms: ECDSAP256SHA256.
Zone fully signed:
Algorithm: ECDSAP256SHA256: KSKs: 1 active, 0 stand-by, 0 revoked
                            ZSKs: 1 active, 0 stand-by, 0 revoked
```

The compliant output will include the string `Zone fully signed:`.

## Remediation
Perform either of the following:

- Enable in-line signing in each zone configuration by setting `inline-signing` to `yes` value. For example:

```
zone "cisecurity.org" {
      type master;
      file "/etc/named/masters/cisecurity.org";
      key-directory "/etc/named/keys";
      inline-signing yes;
      auto-dnssec maintain;
};
```

- Reload the server configuration and zones.

```
rndc reload
```

Or if using manual or scripted zone signing instead of inline-signing, then perform the following.

- Include the signing keys at the end of the zone file to be signed. Such as:

```
$include Kcisecurity.com.+013+09768.key
$include Kcisecurity.com.+013+45248.key
```

- Then sign each zone file with the `dnssec-signzone` command such as:

```
dnssec-signzone -o cisecurity.com ../masters/cisecurity.com
Kcisecurity.com.+013+09768.key Kcisecurity.com.+013+45248.key
```

- Reload the configuration and zones.

```
rndc reload
```

## Default Value
Not specified.

## References
None listed in benchmark.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1562 Impair Defenses |

## Profile
- Level 2 - Authoritative Name Server
