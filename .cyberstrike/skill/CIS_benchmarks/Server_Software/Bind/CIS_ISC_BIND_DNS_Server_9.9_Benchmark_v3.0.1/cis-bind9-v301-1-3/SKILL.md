---
name: cis-bind9-v301-1-3
description: "Dedicated Name Server Role (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, planning-and-architecture]
cis_id: "1.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.3 — Dedicated Name Server Role

## Profile Applicability
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description
A name server may be an authoritative name server for one or more domains for which it is configured to provide information. An authoritative-only name server only answers queries on the domains for which it is configured, and will reject queries for other domains. A caching name server will answer queries any domain. The caching name server gets answers by sending recursive DNS queries to other name servers and then storing the answer in its cache to provide a quicker response to the next query for that name. A caching-only name server is not authoritative for any domain. The BIND DNS names server should be configured to be either a caching-only or an authoritative-only name server, but not both.

## Rationale
DNS name servers are a foundational part of your network architecture and the security of other network services depend on their integrity. It is important to separate the roles of caching and authoritative name servers to minimize functionality and reduce risk for each server. Each name server role faces different threats in addition to direct attacks on the server. For example, the caching name server faces unique threats of malicious replies with bogus answers or over-sized answers intended to deny service. The authoritative name server is a critical part of the infrastructure should not be exposed to these additional attacks.

## Impact
Not Applicable

## Audit Procedure

**Authoritative-Only Name Server:**

To audit an authoritative name server, ensure it doesn't answer queries for other non-authoritative domain names. The following command may be run on a Linux system other than the name server to verify the query status is refused.

```bash
# dig @<ip_address_of_nameserver> <non_authoritative_name> | grep status
;; ->>HEADER<<- opcode: QUERY, status: REFUSED, id: 52410
```

Alternatively the BIND configuration file `name.conf` and all included configuration files may be searched for the allow-recursion statement. No configured occurrences other than localhost and local loopback should be found.

```bash
# grep allow-recursion $CONFIG_FILES
named.conf: allow-recursion { 127.0.0.1; };
```

**Caching-Only Name Server:**

To audit a caching-only name server, send a query with the no recursion specified for a valid authoritative name in the organization.

```bash
# dig +norecurse @<ip_address_of_nameserver> <authoritative_name> | grep status
;; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 12379
```

Alternatively the BIND configuration file `name.conf` and all included configuration files may be searched for the zone statements. Zone that contain a local host name or a local loopback IP addresses should be allowed.

```bash
# grep -w zone $CONFIG_FILES

named.rfc1912.zones:zone "localhost.localdomain" IN {
named.rfc1912.zones:zone "localhost" IN {
named.rfc1912.zones:zone "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.ip6.arpa" IN {
named.rfc1912.zones:zone "1.0.0.127.in-addr.arpa" IN {
named.rfc1912.zones:zone "0.in-addr.arpa" IN {
```

## Remediation

**Authoritative-Only Name Server:** For the authoritative-only name server add or modify the allow-recursion statement to only include the localhost to as shown below.

```
options {
. . .
allow-rescursion { local; };
```

**Caching-Only Name Server:** For the caching-only name server remove the non-local zone statements from the configuration file and restart the server.

## Default Value
Not Applicable

## References
Not Applicable

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 9 - Limitation and Control of Network Ports, Protocols, and Services | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Discovery | T1046 - Network Service Scanning |
| Initial Access | T1190 - Exploit Public-Facing Application |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
