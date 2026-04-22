---
name: cis-bind9-v301-2-3
description: "Lock the BIND User Account (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.3 — Lock the BIND User Account

## Profile Applicability
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description
The user account under which BIND runs should not have a valid password, but should be locked.

## Rationale
As a defense-in-depth measure the named user account should be locked to prevent logins, and to prevent a user from `su`'ing to `named` using a password. In general, there shouldn't be a need for anyone to have to `su` as `named`, and when there is a need, then `sudo` should be used instead, which would not require the account password.

## Impact
Not Applicable

## Audit Procedure
Ensure the named account is locked using the following:

```bash
# passwd -S named
named LK 2016-07-10 -1 -1 -1 -1 (Password locked.)
```

The results will be similar to the output shown above.

## Remediation
Lock the named account password if not already locked.

## Default Value
Account is locked by default.

## References
Not Applicable

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 16 - Account Monitoring and Control | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1078 - Valid Accounts |
| Persistence | T1136 - Create Account |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
