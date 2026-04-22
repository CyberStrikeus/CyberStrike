---
name: cis-bind-v100-3-4
description: "Restrict Queries of the Cache (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, restricting-queries]
cis_id: "3.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 3.4 — Restrict Queries of the Cache

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
The BIND option `allow-query-cache` may be used to restrict or allow BIND to provide answers to queries from the current cache of previously resolved queries. An authoritative only name server should not allow cache queries, except from the localhost. A caching only name server should allow cache queries only from the list of authorized networks.

## Rationale
Caching only name servers are critical to the security of all of the clients and servers using them, only the local authorized networks should be allowed to perform queries of the server's cache. In addition to malicious malformed queries, an attacker could use information about what is or is not in the name server's cache to help setup a DNS attack against the systems using the caching name server.

## Impact
Not specified in the PDF.

## Audit Procedure
From the command prompt on a Microsoft Windows or Linux client not on the authorized network, send a non-recursive DNS request for a domain name for which the server is not authoritative, as shown below.

```
$ nslookup -norecurs www.cisecurity.org 10.3.5.53
Server: UnKnown
Address: 10.3.5.53
*** UnKnown can't find www.cisecurity.org: Query refused

-or-

** server can't find www.cisecurity.org: REFUSED
```

The correct response should say `REFUSED`, or `Query Refused` as shown above. If an IP address is returned, then the server accepted the quest and returned the value from the cache. If the reply includes any of the phrases `can't find` or `No Answer`, or `Server failed` similar to the samples below, then the request was allowed, and the value was not in the cache.

```
Example of Query responses that were allowed, but not in the cache

*** Can't find www.cisecurity.org: No answer

*** UnKnown can't find www.cisecurity.org: Server failed
```

## Remediation
**Authoritative Only Name Server:**
For an authoritative name, insert the following either into the global options or into every zone section.

```
allow-query-cache { localhost; };
```

**Caching Only Name Server:**
Use the previously defined an ACL named `trusted_clients` which will identify the networks which are expected to use the DNS caching server, and will be allowed to send DNS cache queries.

```
allow-query-cache { localhost; trusted_clients };
```

## Default Value
If the `allow-query-cache` option is not present in the configuration, the default value is the `allow-recursion` setting. If the `allow-recursion` setting is not present, then the `allow-query` setting is used, unless recursion is set to no. If recursion is set to no, then the default value is none. Otherwise, if `allow-query` is also not present then the default value is `localnets` and localhost.

## References
1. https://kb.isc.org/article/AA-00845/0/BIND-9.9-Administrator-Reference-Manual-ARM.html

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9 Limitation and Control of Network Ports, Protocols, and Services | Y | Y | Y |
| v7 | 9 Limitation and Control of Network Ports, Protocols, and Services | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Discovery | T1590.002 - Gather Victim Network Information: DNS |
| Command and Control | T1071.004 - Application Layer Protocol: DNS |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
