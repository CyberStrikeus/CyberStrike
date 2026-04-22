---
name: cis-bind-v100-6-2
description: "Hide Nameserver ID (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, information-leakage]
cis_id: "6.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 6.2 — Hide Nameserver ID

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

The `server-id` option provides a server identifier that will be returned in response to an NSID query. An NSID query is described in RFC-5001, and is a method to identify servers in an environment where there are multiple DNS servers sharing the same IP address. With the use of load balancing and other IP sharing mechanisms, it can become difficult to discern exactly which name server is responding to a particular query. NSID allows a name server to respond with identifying information. The `server-id` option should be disabled with a value of `none`.

## Rationale

Enabling the NSID option may allow external parties to obtain information about the configuration and architecture of the DNS server. If it is found to be necessary to enable this service, then the identifying information should be generic. You should not use the server's geographic location, internal IP address, or any other privileged information.

## Impact

Not specified in the PDF.

## Audit Procedure

Use the dig command below to send an NSID query, on the built-in zone `id.server`, for a chaos class TXT record. There should not be any output for a compliant configuration.

```
$ dig @ns2.cisecurity.local id.server chaos txt | grep '^id.server.' | grep TXT
```

An example of a non-compliant response to an NSID query is shown below.

```
$ dig @ns1.cisecurity.local id.server chaos txt | grep '^id.server.' | grep TXT
id.server.         0        CH        TXT        "cpe-172.lima.ny.us.local"
```

## Remediation

To explicitly disable NSID support, add or modify the `server-id` option in the global BIND options with a value of `none` as shown below.

```
server-id none;
```

## Default Value

NSID is disabled by default.

## References

1. https://tools.ietf.org/html/rfc5001

## CIS Controls

| Controls Version | Control                                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 9 Limitation and Control of Network Ports, Protocols, and Services           | Y    | Y    | Y    |
| v7               | 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                                 |
| -------------- | ----------------------------------------- |
| Reconnaissance | T1590 - Gather Victim Network Information |
| Discovery      | T1082 - System Information Discovery      |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
