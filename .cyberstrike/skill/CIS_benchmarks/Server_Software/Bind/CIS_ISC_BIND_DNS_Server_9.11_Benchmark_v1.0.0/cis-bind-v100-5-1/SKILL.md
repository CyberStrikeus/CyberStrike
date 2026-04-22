---
name: cis-bind-v100-5-1
description: "Securely Authenticate Zone Transfers (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, zone-transfers]
cis_id: "5.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 5.1 — Securely Authenticate Zone Transfers

## Profile Applicability
- Authoritative Name Server Level 2

## Description
A zone transfer is a mechanism commonly used by DNS deployments to replicate zone information from master/primary servers to slave/secondary servers. Each pair of name servers participating in zone transfers should authenticate the requests and ensure the integrity of the responses by using a unique shared secret TSIG key. BIND can be configured to respond only to authenticated transfer requests by using the `allow-transfer` statement with a key statement, that restricts the transfers to servers that provide a MAC using the named key.

## Rationale
A zone transfer is a popular information disclosure attack as it provides the entire list of resource records for a zone. There should be very few systems such as the slave name servers that should be authorized to perform a zone transfer for your domains. Authentication of transfer requests should not be made using only an IP address, since IP addresses can be spoofed, but rather by using TSIG keys.

## Impact
Not specified in the PDF.

## Audit Procedure
Perform the following:

- Search all of the included configuration files and zone files for the `allow-transfer` option.

```
grep -C 1 allow-transfer $CONFIG_FILES $ZONE_FILES
```

- If there are no `allow-transfer` statements found, then the configuration allows zone transfers, and is not compliant.
- If the only value in the address match list of all the `allow-transfer` statements is the value `none`, either with or without quotes, then the configuration is compliant. Examples output is shown below.

```
allow-transfer { none; };
allow-transfer {"none";};
```

- If **all** of the address list values of the `allow-transfer` statements have the keyword `key` followed by a name, then the configuration is compliant.

```
allow-transfer { key ns1-ns2.cisecurity.org.; };
```

- If the predefined address value of `any` appears in the `allow-transfer` statement, then the configuration is not compliant. If any of the address list values contains ACL names, IP addresses or network ranges, then the configuration is also not compliant.

```
allow-transfer { any; }
allow-transfer { 10.10.42.56; key ns1-ns2.cisecurity.org.; }
```

- Additionally, it is possible to confirm if a transfer is allowed to an IP address without a key, by performing the following command on the system with the suspected allowed IP address. An error of `Transfer failed` is the expected result. If a list of resource records is returned, then the transfer was allowed without a key, and the configuration is non-compliant.

```
$ dig @ns1.cisecurity.org cisecurity.org axfr
; <<>> DiG 9.9 . . .
; (1 server found)
;; global options: +cmd
; Transfer failed.
```

## Remediation
Generate TSIG keys 256 bits in length, unique for each host-to-host communication. Securely Transfer the keys and configure the keys to be required in all `allow-transfer` statements.

## Default Value
If the `allow-transfer` statement is missing, then transfers are allowed to any host.

## References
Not specified in the PDF.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9.1 Limit Open Ports, Protocols, and Services | Y | Y | Y |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Reconnaissance | T1590.002 - Gather Victim Network Information: DNS |
| Discovery | T1018 - Remote System Discovery |

## Profile
- Level 2 - Authoritative Name Server
