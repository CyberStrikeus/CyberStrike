---
name: cis-bind-v100-8-2
description: "Ensure Signing Keys are Generated with a Secure Algorithm (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, dnssec]
cis_id: "8.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-327]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.2 — Ensure Signing Keys are Generated with a Secure Algorithm

## Profile Applicability

- Authoritative Name Server Level 2

## Description

When Zone Signing Keys (ZSK) or Key Signing Keys (KSK) are generated there are several secure DNSSEC digital signature algorithms that are recommended. The algorithms are listed below with the standard DNSSEC algorithm number followed by the common name, and then the BIND 9 mnemonic name used by `dnssec-keygen`.

```
- 8       RSA/SHA-256     RSASHA256
- 10      RSA/SHA-512     RSASHA512
- 13      ECDSA/SHA-256   ECDSAP256SHA256
- 14      ECDSA/SHA-384   ECDSAP384SHA384
- 15      Ed25519         ED25519
```

## Rationale

A secure public key algorithm along with a secure hash algorithm, are part of the foundation for a secure digital secure. Weaknesses in older public key algorithms continue to develop, and it is important to use a recommended algorithm that is expected to be secure for the near future.

## Impact

Not specified.

## Audit Procedure

To audit the key algorithms in use, search the private key files for the line that starts with `Algorithm:`, using the following commands.

```
# cd $BIND_HOME
# find . -name 'K*.private' -print0 | xargs -0 grep '^Algorithm:'
./keys/Kcisecurity.org.+008+42383.private:Algorithm: 8 (RSASHA256)
./keys/Kcisecurity.org.+008+11955.private:Algorithm: 8 (RSASHA256)
./keys/Keccky.com.+013+49638.private:Algorithm: 13 (ECDSAP256SHA256)
./keys/Kweakkey.com.+003+36233.private:Algorithm: 3 (DSA)
```

Any algorithms other than `RSASHA256`, `RSASHA512`, `ECDSAP256SHA256`, `ECDSAP384SHA384` or `ED25519` are not compliant. Likewise, the algorithm number must be one of: `8`, `10`, `13`, `14` or `15`.

## Remediation

To remediate a weak key, perform the following:

- Generate a new key to replace the weak key using `dnssec-keygen` and one of the recommended algorithms. Examples commands are shown below.

```
# dnssec-keygen -a RSASHA256 -b 2048 example.com
# dnssec-keygen -a ECDSAP384SHA384 cisecurity.org
```

- Implement a rollover period to phase out the weak key and replace it with the newly generated key.
- Once the key is fully deleted from active use, remove the file.

## Default Value

The default algorithm is RSASHA1.

## References

1. https://tools.ietf.org/id/draft-ietf-dnsop-algorithm-update-01.html#rfc.section.1.1
2. https://bind.isc.org/doc/arm/9.11/man.dnssec-keygen.html
3. https://www.isc.org/dnssec/

## CIS Controls

| Controls Version | Control                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 18.5 Use Only Standardized and Extensively Reviewed Encryption Algorithms | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique               |
| --------------- | ----------------------- |
| Defense Evasion | T1600 Weaken Encryption |

## Profile

- Level 2 - Authoritative Name Server
