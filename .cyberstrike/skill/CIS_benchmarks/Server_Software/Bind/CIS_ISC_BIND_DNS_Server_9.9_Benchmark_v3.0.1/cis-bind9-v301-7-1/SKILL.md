---
name: cis-bind9-v301-7-1
description: "Do Not Define a Static Source Port (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, secure-network]
cis_id: "7.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 7.1 — Do Not Define a Static Source Port

## Profile Applicability
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description
BIND can be configured to always use the same source port when communicating with other DNS servers. This capability is made possible through the `query-source` port option, and the `query-source-v6` port option. It is recommended that the source port be omitted if the `query-source` option is used, or that the port be specified as a `*`, so that the port will not be a static port number.

## Rationale
DNS attacks which involve spoofing a bogus DNS reply may require the attacker to guess the source port number of the request, if the attacker is unable to see the initial DNS query. Making the source port static makes the attack easier, as it eliminates the effort of getting the correct destination port number for the spoofed reply. Instead of a static source port, the port number should be selected randomly amount the client ephemeral ports.

## Impact
None noted.

## Audit Procedure
Verify that a static port is not specified in a query-source option or a `query-source-v6` option, using the command below.

```bash
$ egrep '^\w*query-source' $CONFIG_FILES | grep port
/etc/named.conf:    query-source address 10.1.45.53 port *;
```

If there is no output from the grep or if the port number is specified as `*`, then the configuration is compliant. Examples of a non-compliant configurations are shown below.

```
query-source port 1053;

query-source port-v6 53;
```

## Remediation
Either remove the port specification from the `query-source` or the `query-source-v6` option or use an `*` for the port number.

## Default Value
The default is to not use a static source port for queries.

## References
None listed.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9 - Limitation and Control of Network Ports, Protocols, and Services | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1557 - Adversary-in-the-Middle |
| Credential Access | T1557.002 - ARP Cache Poisoning |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
