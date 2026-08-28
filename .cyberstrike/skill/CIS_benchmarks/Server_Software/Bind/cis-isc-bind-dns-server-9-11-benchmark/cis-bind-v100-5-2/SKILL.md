---
name: cis-bind-v100-5-2
description: "Securely Authenticate Dynamic Updates (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, zone-transfers]
cis_id: "5.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.2 — Securely Authenticate Dynamic Updates

## Profile Applicability

- Authoritative Name Server Level 1

## Description

Dynamic updates are used to automate the updating of zones. Dynamic updates are typically used with DHCP; however, updates may include other records. The allow-update option allows deleting or adding any resource records of a zone except the SOA and NS records, and should not be used. Instead the update-policy option allows a more granular policy to be specified so that only specific resource record types and a specific sub-domain may be updated. The update-policy must be securely authenticated with a key identifier, rather than by an IP address. The key identifier may specify a `TSIG` key, a `GSS-TSIG` key, or a `SIG(0)` key.

## Rationale

Allowing other systems to make permanent updates to your zones is of course not allowed by default, and needs to be carefully secured. Consider the power of an attack that could update the zone to direct clients and servers to the malicious server of the attacker's choice. The attack would not be restricted to just HTTP, but every connection and protocol that uses a name and allows weak authentication may be subject to redirection and a variety of man-in-the-middle and protocol downgrade attacks. Therefore, it is important that all dynamic updates be securely authenticated using a cryptographic key, and not rely on an IP address.

## Impact

Not specified in the PDF.

## Audit Procedure

Perform the following steps:

- Search for the allow-update option in all of the included configuration files, and in the zone files. If any allow-update options are present, other than `none` or `localhost`, as shown below, then the configuration is not compliant.

```
# grep allow-update $CONFIG_FILES $ZONE_FILES
/etc/named.conf: allow-update { none; };
/. . . /data/cisecurity.org: allow-update { "localhost"; };
```

- Search for any update-policy options in all of the zone files. Any update policies found, should not contain any IP addresses, network CIDR notations, or any ACL names that represents an IP addresses. The only entries in the update-policy should be key identifiers or `local` as shown below. All of the following are compliant.

```
# grep update-policy $ZONE_FILES
/. . ./data/internal.org: update-policy { grant ns1-dhcp-update-key name dyn.internal.org A; };
/. . ./data/cisecurity.local: update-policy { grant dyn_update_key self office.cisecurity.local A; };
/. . ./data/test.local: update-policy { local; };
```

## Remediation

Perform the following steps for remediation:

- Remove any `allow-update` options from the global options configuration.
- Replace or add `allow-update` options to the zone files to specify a securely generated TSIG or SIG(0) key identifier, along with the appropriate domain or sub-domain, and the appropriate resource record type.

## Default Value

Dynamic updates are not allowed by default.

## References

Not specified in the PDF.

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v6               | 9 Limitation and Control of Network Ports, Protocols, and Services | Y    | Y    | Y    |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials                | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic              | Technique                                   |
| ------------------- | ------------------------------------------- |
| Defense Evasion     | T1556 - Modify Authentication Process       |
| Impact              | T1565 - Data Manipulation                   |
| Command and Control | T1071.004 - Application Layer Protocol: DNS |

## Profile

- Level 1 - Authoritative Name Server
