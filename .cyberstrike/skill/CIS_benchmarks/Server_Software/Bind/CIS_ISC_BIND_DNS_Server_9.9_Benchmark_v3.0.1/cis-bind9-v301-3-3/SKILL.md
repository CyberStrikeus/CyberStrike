---
name: cis-bind9-v301-3-3
description: "Restrict Query Origins (Manual)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, restricting-queries]
cis_id: "3.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.3 — Restrict Query Origins

## Profile Applicability
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description
BIND can be configured to restrict access to its query services based on source IP address. It is recommended that the `allow-query` option be used to restrict access to only the networks authorized to use the name server. For an external authoritative only name server, the authorized networks may include all networks, however for internal authoritative or caching name servers the authorized networks should be explicitly configured.

## Rationale
Using allow-query in conjunction with an ACL of trusted networks will reduce the risk of unauthorized access to name services content. Additionally, the exposure of vulnerabilities present in BIND's query handlers is reduced by this configuration as requests with an untrusted source will be rejected before the request is fully parsed by named. Keep in mind however, that the source IP addresses can be easily spoofed, and the firewall and network architecture also needs to protect internal name servers from external spoofed requests.

## Impact
Not Applicable

## Audit Procedure
Verify that the BIND configuration files contain a global allow-query option with only the predefined ACL `localhost` and an ACL of the explicitly authorized networks. For an external authoritative only name server, the authorized networks may be the ACL `any` which represents any IPv4 or IPV6 host, but for caching and internal name servers, the `authorized_networks` should be an ACL with an explicit list of networks. The name of the ACL does not have to be `authorized_networks`.

```bash
$ grep allow-query $CONFIG_FILES
    allow-query     { localhost; authorized_networks };
```

For an external authoritative only name server:

```bash
$ grep allow-query $CONFIG_FILES
    allow-query     { any };
```

## Remediation
For remediation:

- Create an ACL for the authorized trusted networks in the `named.conf` file.

```
acl authorized_networks { 10.10.32.0/24; 10.10.34.0/24; . . . };
```

- Add the allow-query statement to the global options of the `named.conf` file with the localhost ACL and the authorized trusted networks ACL.

```
allow-query     { localhost; authorized_networks };
```

## Default Value
The default package install allows queries only from localhost.

## References
Not Applicable

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9 - Limitation and Control of Network Ports, Protocols, and Services | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Reconnaissance | T1590 - Gather Victim Network Information |
| Discovery | T1046 - Network Service Scanning |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
