---
name: cis-bind-v100-9-5
description: "Response Rate Limiting and DDOS Mitigation (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, operations]
cis_id: "9.5"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-770]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 9.5 — Response Rate Limiting and DDOS Mitigation

## Profile Applicability
- Authoritative Name Server Level 1

## Description
Responses to excessive, nearly identical UDP requests can be controlled by configuring a response rate-limit clause in an options or view statement. At this time, Response Rate Limiting is only recommended for authoritative servers.

## Rationale
The response rate limiting mechanism keeps an authoritative name server from being effectively used to amplify reflected distributed denial of service (DDoS) attacks. Short truncated responses will be sent when the rate-limited is exceeded. Legitimate non-spoofed clients will react to a dropped or truncated response by retrying with UDP or with TCP respectively. While the truncated or dropped responses to spoofed requests intended will greatly diminished the effectiveness of the attack.

## Impact
Not specified.

## Audit Procedure
To determine if the recommended state is implemented, check that the authoritative name server configuration file has an options statement with a rate-limit clause that sets the responses-per-second to a value of `5` or less. Keep in mind, the responses per second value only limits the responses to nearly identical requests from the same IP address.

## Remediation
To implement the recommended state, add or update a rate-limit clause in the server's options statement. Add a responses-per-second value of `5` or less, similar to the example below.

```
options {
 . . .
    rate-limit {
        // Limit Response to Rapid Identical Queries for DDOS mitigation
        responses-per-second 5;
    . . .
};
```

## Default Value
Default value is `0` or no rate limit.

## References
1. https://kb.isc.org/docs/aa-00994
2. https://www.us-cert.gov/ncas/alerts/TA13-088A
3. https://kb.isc.org/docs/aa-01148

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v7 | 8 Malware Defenses | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Impact | T1498.002 Reflection Amplification |

## Profile
- Level 1 - Authoritative Name Server
