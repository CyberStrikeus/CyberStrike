---
name: cis-bind-v100-7-2
description: "Enable DNSSEC Validation (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, secure-network, dnssec]
cis_id: "7.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 7.2 — Enable DNSSEC Validation

## Profile Applicability
- Caching Only Name Server Level 1
- Authoritative Name Server Level 1

## Description
DNS Security Extensions or DNSSEC for short provides authentication of the name servers through public key cryptography. With DNSSEC, the name server signs its responses with its private key. This allows other name servers that have the public key of the name server to verify the integrity and authenticity of the response. DNSSEC also provides for signing of public keys so that delegated sub-domains may have their keys signed by a higher-level authority. This creates a chain of trust so that any name server that trusts the public key of the higher-level signing authority can trust the signed key. It is recommended that DNSSEC be enabled and be configured to validate domains that are signed. DNSSEC and validation are enabled via the options `dnssec-enable` and `dnssec-validation`, respectively.

## Rationale
DNSSEC reliably authenticates DNS responses to prevent the DNS spoofing and cache poisoning attacks.

## Impact
Not specified in the PDF.

## Audit Procedure
Perform the following to verify compliance.

- To verify that the name server will validate the trust for DNSSEC signed domains, perform the following `delv` command on the name server. The command queries the name isc.org, which has a valid trusted DNSSEC signature.

```
$ delv @127.0.0.1 isc.org
; fully validated
isc.org.        60     IN     A     149.20.1.66
isc.org.        60     IN     RRSIG A 13 2 60 20200306020506
20200205011018 27566 isc.org.
VxlTxZDll9boCOG2jE+gt7w3memCLyyCd+thrwf5XRrKkrCjcJWL7cd0y82Pv5FHKqhgq4b
BKJOR4uNhUhWDg==
```

The compliant result should have `; fully validated` as the initial response indicating the recursive server is DNSSEC aware.

- To verify that the name server will properly reject DNSSEC signed domains with an invalid signature, perform the dig command below on the `www.dnssec-failed.org` name.

```
$ delv @127.0.0.1 www.dnssec-failed.org
;; resolution failed: SERVFAIL
```

The status value should be `resolution failed: SERVFAIL`.

## Remediation
Perform the following for remediation:

- Check the BIND configuration files, and in the global options set the option `dnssec-enable` to yes, and option `dnssec-validation` to either yes or auto as shown below. The auto setting is generally preferred as the trust anchor will not need to be manually configured.

```
dnssec-enable yes
dnssec-validation auto
```

- Restart the named server.

## Default Value
DNSSEC and DNSSEC validation are enabled by default.

## References
1. https://kb.isc.org/docs/aa-01182

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9 Limitation and Control of Network Ports, Protocols, and Services | Y | Y | Y |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Credential Access | T1557 - Adversary-in-the-Middle |
| Command and Control | T1071.004 - Application Layer Protocol: DNS |
| Defense Evasion | T1556 - Modify Authentication Process |

## Profile
- Level 1 - Caching Only Name Server
- Level 1 - Authoritative Name Server
