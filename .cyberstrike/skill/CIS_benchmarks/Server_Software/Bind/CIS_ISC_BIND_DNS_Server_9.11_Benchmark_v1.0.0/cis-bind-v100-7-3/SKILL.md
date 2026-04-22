---
name: cis-bind-v100-7-3
description: "Disable the dnssec-accept-expired Option (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, secure-network, dnssec]
cis_id: "7.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 7.3 — Disable the dnssec-accept-expired Option

## Profile Applicability

- Caching Only Name Server Level 1
- Authoritative Name Server Level 1

## Description

The `dnssec-accept-expired` option allows BIND to accept expired signatures during validation. The option should be disabled so that expired signatures will not be accepted.

## Rationale

Allowing expired signatures would leave the server vulnerable to replay attacks.

## Impact

Not specified in the PDF.

## Audit Procedure

Verify the `dnssec-accept-expired` option is not present in the configuration files, or is set to a value of `no`.

```
# grep dnssec-accept-expired $CONFIG_FILES
/var/named/chroot/etc/named.conf:     dnssec-accept-expired no;
```

## Remediation

Change the `dnssec-accept-expired` option to have a value of `no`, or remove the option from the configuration files.

## Default Value

The `dnssec-accept-expired` option is disabled by default.

## References

Not specified in the PDF.

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v6               | 9 Limitation and Control of Network Ports, Protocols, and Services | Y    | Y    | Y    |
| v7               | 16.7 Establish Process for Revoking Access                         | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic              | Technique                                     |
| ------------------- | --------------------------------------------- |
| Credential Access   | T1557 - Adversary-in-the-Middle               |
| Defense Evasion     | T1550 - Use Alternate Authentication Material |
| Command and Control | T1071.004 - Application Layer Protocol: DNS   |

## Profile

- Level 1 - Caching Only Name Server
- Level 1 - Authoritative Name Server
