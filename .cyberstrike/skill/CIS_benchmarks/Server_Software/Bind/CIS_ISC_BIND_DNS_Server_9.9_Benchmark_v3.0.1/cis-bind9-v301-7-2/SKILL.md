---
name: cis-bind9-v301-7-2
description: "Enable DNSSEC Validation (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, secure-network, dnssec]
cis_id: "7.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 7.2 — Enable DNSSEC Validation

## Profile Applicability

- Level 1 - Caching Only Name Server

## Description

DNS Security Extensions or DNSSEC for short provides authentication of the name servers through public key cryptography. With DNSSEC, the name server signs its responses with its private key. This allows other name servers that have the public key of the name server to verify the integrity and authenticity of the response. DNSSEC also provides for signing of public keys so that delegated sub-domains may have their keys signed by a higher-level authority. This creates a chain of trust so that any name server that trusts the public key of the higher-level signing authority can trust the signed key. It is recommended that DNSSEC be enabled and be configured to validate domains that are signed. DNSSEC and validation are enabled via the options `dnssec-enable` and `dnssec-validation`, respectively.

## Rationale

DNSSEC reliably authenticates DNS responses to prevent the DNS spoofing and cache poisoning attacks.

## Impact

None noted.

## Audit Procedure

Perform the following to verify compliance.

- To verify that the name server will validate the trust for DNSSEC signed domains, perform the following dig command on the name server. The command queries the name www.isc.org, which has a valid trusted DNSSEC signature.

```bash
$ dig @127.0.0.1 www.isc.org. A +dnssec +multiline | grep 'flags:'
;; flags: qr rd ra ad; QUERY: 1, ANSWER: 2, AUTHORITY: 5, ADDITIONAL: 13
; EDNS: version: 0, flags: do; udp: 4096
```

The compliant result should have the Authenticated Data (`ad`) flag in the header, and the DNSSEC OK (`do`) flag indicating the recursive server is DNSSEC aware.

- To verify that the name server will properly reject DNSSEC signed domains with an invalid signature, perform the dig command below on the www.dnssec-failed.org name.

```bash
$  dig @127.0.0.1 www.dnssec-failed.org. A | egrep 'status:|flags:'
;; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 37402

;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 0, ADDITIONAL: 1
; EDNS: version: 0, flags:; udp: 4096
```

The status value should be `SERVFAIL` with `ANSWER: 0`.

## Remediation

Perform the following for remediation:

- Check the BIND configuration files, and in the global options set the two options `dnssec-enable` and `dnssec-validation` to yes as shown below:

```
dnssec-enable yes
dnssec-validation yes
```

- Restart the named server.

## Default Value

DNSSEC and DNSSEC validation are enabled by default.

## References

1. https://users.isc.org/~jreed/dnssec-guide/dnssec-guide.html#easy-start-guide-for-recursive-servers

## CIS Controls

| Controls Version | Control                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 9 - Limitation and Control of Network Ports, Protocols, and Services | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                       |
| -------------- | ------------------------------- |
| Initial Access | T1557 - Adversary-in-the-Middle |
| Impact         | T1565 - Data Manipulation       |

## Profile

- Level 1 - Caching Only Name Server
