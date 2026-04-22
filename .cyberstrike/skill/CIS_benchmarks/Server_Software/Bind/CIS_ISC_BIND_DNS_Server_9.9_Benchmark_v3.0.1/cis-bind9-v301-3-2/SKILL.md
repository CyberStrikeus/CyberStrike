---
name: cis-bind9-v301-3-2
description: "Restrict Recursive Queries (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, restricting-queries]
cis_id: "3.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.2 — Restrict Recursive Queries

## Profile Applicability
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description
A recursive DNS query is your typical DNS query from a client to a caching DNS server. It places the burden of finding the answer on the caching DNS server which will recursively query other DNS servers authoritative for the domains, until it gets the answer which is then returned to the client. The DNS server will then cache the answer to that query until its time-to-live expires in order to provide a quick answer to future queries for the same name. BIND can be configured to restrict fulfillment of recursive lookups to only authorized network segments and hosts. This is made possible by the `allow-recursion` option. Caching non-authoritative name servers should only allow recursive queries from clients on their own authorized networks. Authoritative name servers should not allow recursive queries, except to the local host.

## Rationale
Recursive DNS queries are commonly used in malicious attacks, including DNS amplification attacks and DNS cache poisoning attacks. A DNS amplification attack is a form of a reflected distributed denial-of-service attack, where multiple publicly accessible servers are sent recursive queries with the source IP address spoofed to be that of the victim. A high volume of relatively large DNS responses then flood the victim. For a DNS cache poisoning attack, the attacker may perform a query, and then provide a bogus response for the server to store in the cache. The bogus response may redirect clients to a different IP address which is provided by the attacker. Once the cache is poisoned, then clients visiting web sites, connecting to mail servers or VPNs may be connected with a malicious server configured to attack the client or steal credentials.

Limiting recursive queries to trusted networks does not prevent all of the DNS attacks possible, but it does make the attacks much more difficult and dramatically limits the scope of possible attacks so that detection and response are manageable.

## Impact
Not Applicable

## Audit Procedure
From the command prompt on Windows or Linux, send a recursive DNS request for a domain name for which the server not authoritative from a client that is not permitted to perform recursive queries:

```bash
$ nslookup www.cisecurity.com 10.10.3.53
. . .

** server can't find www.cisecurity.com: REFUSED
```

The expected result is for the query to be refused.

## Remediation

**Authoritative Name Server:**

For an authoritative name, insert the following either into the global options or into every zone section.

```
allow-recursion { localhost; };
```

**Caching Name Server:**

- Define an ACL named `trusted_clients` which will identify the networks which are expected to use the DNS caching server, and will be allowed to send recursive DNS queries.

```
acl trusted_clients { 10.19.4.0/28; . . . }
```

- Insert the following into the global options.

```
allow-recursion { localhost; trusted_clients };
```

## Default Value
The allow-recursion option is not defined by default.

## References
1. https://www.us-cert.gov/ncas/alerts/TA13-088A
2. https://www.godaddy.com/help/what-risks-are-associated-with-recursive-dns-queries-1184

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9.1 - Limit Open Ports, Protocols, and Services | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Impact | T1498 - Network Denial of Service |
| Command and Control | T1071.004 - Application Layer Protocol: DNS |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
