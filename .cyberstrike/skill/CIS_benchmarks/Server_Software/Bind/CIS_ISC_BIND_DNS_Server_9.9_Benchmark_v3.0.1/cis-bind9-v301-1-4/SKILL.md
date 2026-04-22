---
name: cis-bind9-v301-1-4
description: "Use Secure Upstream Caching DNS Servers (Manual)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, planning-and-architecture]
cis_id: "1.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.4 — Use Secure Upstream Caching DNS Servers

## Profile Applicability
- Level 1 - Caching Only Name Server

## Description
Caching name servers often forward queries to another caching name server to allow the name service work to be aggregated and improve performance by taking advantage of the cache of an upstream name server. The default caching name server provided by the Internet service provider is often used in this manner. This may also be a security weakness by relying on insecure servers outside the organization's control and security policies.

## Rationale
The security of all of the external connections that your systems on your network depend in part on getting accurate IP addresses for external names. If the upstream caching name server is compromised, or has its cache poisoned with malicious records, then your entire network may be subject to an attack which may redirect web, email, or VPN traffic to malicious servers, or may cause denial of services attacks. Therefore, it is important to evaluate the security of the upstream caching name servers to reduce the risk of DNS attacks propagated to your network via the upstream provider. There are a number of security companies that offer secure caching DNS services that are worth considering. Features to look for and test include:

- Blocking of traffic to websites known to contain malware.
- Configurable categories for blocking inappropriate content, such as adult content.
- Detecting and blocking of malware communications to an external command and control server.
- Prevent DNS spoofing by ensuring the integrity and authenticity of all DNS responses.

## Impact
Not Applicable

## Audit Procedure
Perform the following for an audit:

- Check the network architecture and the identify all internal authorized caching DNS servers configured via DHCP or statically.
- Verify that there are network firewall and access controls rules that prevent internal systems from sending DNS queries directly to unauthorized external DNS servers. Only the authorized internal DNS servers should be allowed to send external DNS queries and they should be configured to only use authorized external DNS servers. An example direct DNS query on a Microsoft Windows system can be done via `nslookup`, and should timeout as shown below.

```
C:\> nslookup cisecurityy.org 8.8.8.8
DNS request timed out.
timeout was 2 seconds.
Server: UnKnown
Address: 8.8.8.8
. . .
```

- Review the service provider's agreements, policies and statements, or speak with the vendor and consider if the security of the approved external DNS servers, meet your organizations security standards and requirement. The following features and risk mitigations are recommended for consideration:
  - Prevent spoofing of external DNS replies to redirect traffic to malicious server
  - Prevent spoofing of DNS queries to solicit large DNS replies to perform a denial of service.
  - Blocking of known malicious or infected websites
  - Blocking known botnet C&C communications.
  - Reporting, alerting and configuration on blocked DNS traffic.

## Remediation
Perform the following for remediation:

- Review network architectural, approved internal DNS servers, and block outbound DNS traffic, except for the approved DNS servers.
- Select an external DNS provider that sufficiently mitigates malicious DNS traffic to meet your organizational requirements
- Review, test and document the approved external DNS servers, and configure the internal caching-only DNS servers to use the approved external caching DNS server.

## Default Value
Not Applicable

## References
Not Applicable

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 12 - Boundary Defense | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Initial Access | T1195 - Supply Chain Compromise |
| Command and Control | T1071.004 - Application Layer Protocol: DNS |

## Profile
- Level 1 - Caching Only Name Server
