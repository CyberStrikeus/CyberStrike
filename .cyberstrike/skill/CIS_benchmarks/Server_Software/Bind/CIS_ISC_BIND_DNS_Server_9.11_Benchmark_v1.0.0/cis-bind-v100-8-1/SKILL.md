---
name: cis-bind-v100-8-1
description: "Install the Haveged Package for Enhanced Entropy (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, dnssec]
cis_id: "8.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.1 — Install the Haveged Package for Enhanced Entropy

## Profile Applicability
- Authoritative Name Server Level 2

## Description
Install the haveged package to provide enhanced entropy for generating cryptographic keys. Haveged is a user space entropy daemon which is not dependent upon the standard mechanisms for harvesting randomness for the system entropy pool. Haveged uses HAVEGE (HArdware Volatile Entropy Gathering and Expansion) to maintain a pool of 1 million random bytes used to fill /dev/random.

## Rationale
It is important for authoritative DNS servers deploying DNSSEC domains to have a good source of entropy to generate secure cryptographic keys. DNS servers are typically not multi-user systems and generally deployed as headless servers. In such situations generating keys without enhanced entropy can be painfully time-consuming, or may lack sufficient entropy. The haveged daemon ensures that keys can be generated timely and securely.

## Impact
Not specified.

## Audit Procedure
To verify compliance, run the following `pgrep` command to ensure the `haveged` process is running.

```
$ pgrep -f $(which haveged)
2948
```

Output with any process ID is compliant. No output indicates the `haveged` process is not running.

## Remediation
Install the `haveged` package with the appropriate package manager and configure it to start, as shown below.

```
# yum install haveged
# systemctl enable haveged
# systemctl start haveged
```

## Default Value
The haveged package is not installed or enabled by default.

## References
None listed in benchmark.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v7 | N/A | N | N | N |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1600 Weaken Encryption |

## Profile
- Level 2 - Authoritative Name Server
