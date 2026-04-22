---
name: cis-bind-v100-1-4
description: "Use Secure Upstream Caching DNS Servers (Manual)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, planning-and-architecture]
cis_id: "1.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 1.4 — Use Secure Upstream Caching DNS Servers

## Profile Applicability

- Caching Only Name Server Level 2

## Description

Caching name servers often forward queries to another caching name server to allow the name service work to be aggregated and improve performance by taking advantage of the cache of an upstream name server. The default caching name server provided by the Internet service provider is often used in this manner. This may also be a security weakness by relying on insecure servers outside the organization's control and security policies.

## Rationale

The security of all of the external connections that your systems on your network depend in part on getting accurate IP addresses for external names. If the upstream caching name server is compromised, or has its cache poisoned with malicious records, then your entire network may be subject to an attack which may redirect web, email, or VPN traffic to malicious servers, or may cause denial of services attacks. Therefore, it is important to evaluate the security of the upstream caching name servers to reduce the risk of DNS attacks propagated to your network via the upstream provider. There are a number of security companies that offer secure caching DNS services that are worth considering. Features to look for and test include:

- Blocking of traffic to websites known to contain malware.
- Configurable categories for blocking inappropriate content, such as adult content.
- Detecting and blocking of malware communications to an external command and control server.
- Prevent DNS spoofing by ensuring the integrity and authenticity of all DNS responses.

## Impact

Not specified.

## Audit Procedure

Perform the following for an audit:

- Check the network architecture and the identify all internal authorized caching DNS servers configured via DHCP or statically.
- Verify that there are network firewall and access controls rules that prevent internal systems from sending DNS queries directly to unauthorized external DNS servers. Only the authorized internal DNS servers should be allowed to send external DNS queries and they should be configured to only use authorized external DNS servers. An example direct DNS query on a Microsoft Windows system can be done via `nslookup`, and should timeout as shown below.

```
C:\> nslookup cisecuritry.org 8.8.8.8
DNS request timed out.
timeout was 2 seconds.
Server: UnKnown
Address: 8.8.8.8
. . .
```

- Review the configuration of DNS forwarders for internal caching DNS servers to ensure the that only authorized DNS servers are configured. The following perl command maybe helpful in extracting forwarders directives from the configuration files.

```
perl -ne 'print if /^ *forwarders */i .. / *};/i' $CONFIG_FILES
```

- Review the service provider's agreements, policies and statements, or speak with the vendor and consider if the security of the approved external DNS servers, meet your organizations security standards and requirement. The following features and risk mitigations are recommended for consideration:
  - Prevent spoofing of external DNS replies to redirect traffic to malicious server
  - Prevent spoofing of DNS queries to solicit large DNS replies to perform a denial of service.
  - Blocking of known malicious or infected websites
  - Blocking known botnet C&C communications.
  - Reporting, alerting and configuration on blocked DNS traffic.

## Remediation

Perform the following for remediation:

- Select an external DNS provider that sufficiently mitigates malicious DNS traffic to meet your organizational requirements.
- Review network architectural, approved internal DNS servers, and prepare to block outbound DNS traffic, except to the approved DNS servers from the internal caching name servers.
- Review, test and document the approved external DNS servers.
- Configure the internal caching-only DNS servers to forward queries to the approved external caching DNS server. The forwarders directive similar to the example below may be placed in the server options directive.

```
    forwarders { acl_of_approved_servers; };
```

- Block outbound DNS traffic, except to the approved external DNS servers from the internal caching name servers.

## Default Value

Not specified.

## References

None listed.

## CIS Controls

| Controls Version | Control                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------- | ---- | ---- | ---- |
| v6               | 12 Boundary Defense                                | N    | Y    | Y    |
| v7               | 7.4 Maintain and Enforce Network-Based URL Filters | N    | Y    | Y    |
| v7               | 7.7 Use of DNS Filtering Services                  | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic              | Technique                                 |
| ------------------- | ----------------------------------------- |
| Command and Control | T1071.004 Application Layer Protocol: DNS |
| Defense Evasion     | T1562 Impair Defenses                     |

## Profile

- Level 2 - Caching Only Name Server
