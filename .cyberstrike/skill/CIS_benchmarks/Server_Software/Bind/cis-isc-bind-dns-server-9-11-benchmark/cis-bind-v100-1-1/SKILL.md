---
name: cis-bind-v100-1-1
description: "Use a Split-Horizon Architecture (Manual)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, planning-and-architecture]
cis_id: "1.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.1 — Use a Split-Horizon Architecture

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

Running a Split-Horizon DNS architecture refers to running authoritative DNS servers and services for external DNS queries separate from the internal authoritative DNS servers, which answer all queries originating from within the organization. The external servers are configured to provide only a limited amount of information for the services needed for communication with external clients and services. Typically, the information published in the externally available DNS is the minimal needed for the Internet services such as email, web and gateway systems such as VPNs. The separate internal DNS service typically provides a richer information set typically needed by internal clients. Likewise, names servers should physically and logically separated fit only one of the benchmark profiles, and not both:

- Authoritative Name Server
- Caching Only Name Server

## Rationale

The three goals of Split-Horizon are to:

1. Minimize the amount and type of externally available information.
2. Physical and logical separation of external and internal DNS services.
3. Servers roles are either an Authoritative Name Server, or a Caching Recursive Resolver, but not both.

Separating the external and internal DNS servers in this manner adheres to a defense-in-depth approach that limits the potential damage and impact should the external name server be compromised, since it does not service internal clients, nor does it have information on the internal systems and services.

BIND 9 Views can be used to provide different responses based on the source IP address, and have been suggested by some as a means to implement split-horizon without having to separate the internal and external servers. However, the usage of views without separating the servers does not accomplish the second goal. In addition, the usage of views often erroneously assumes that source IP addresses are a reliable security control and cannot be spoofed. Therefore, it is necessary that the internal DNS server be located internally in a way that firewalls and other network controls will ensure external malicious queries will not reach the internal server.

## Impact

Not specified.

## Audit Procedure

Perform the following to audit for compliance:

Review the network and DNS architecture, and identify the external authoritative DNS servers along with the internal authoritative DNS servers to ensure they are separate and serve only external and only internal clients respectively. Review the external DNZ zones to ensure only minimal name information is included in the external zones. Perform a query of an internal only name to the external DNS servers to ensure they do not provide a positive response.

## Remediation

Perform the following for remediation:

Implement Split-Horizon Architecture to separate external and internal DNS services. The external DNS servers should respond only to names of approved external services, such as web, email and VPN services.

## Default Value

Not Applicable

## References

1. https://www.sans.org/reading-room/whitepapers/dns/current-issues-dns-32988
2. http://www.deer-run.com/~hal/EUGLUGBINDTalk.pdf

## CIS Controls

| Controls Version | Control             | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------- | ---- | ---- | ---- |
| v6               | 12 Boundary Defense | N    | Y    | Y    |
| v7               | 12 Boundary Defense | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique                               |
| --------------- | --------------------------------------- |
| Defense Evasion | T1562 Impair Defenses                   |
| Discovery       | T1590 Gather Victim Network Information |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
