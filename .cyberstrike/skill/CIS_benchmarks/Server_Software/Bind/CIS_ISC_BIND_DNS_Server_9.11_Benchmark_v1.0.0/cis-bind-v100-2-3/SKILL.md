---
name: cis-bind-v100-2-3
description: "Lock the BIND User Account (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.3 — Lock the BIND User Account

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
The user account under which BIND runs should not have a valid password, but should be locked.

## Rationale
As a defense-in-depth measure the named user account should be locked to prevent logins, and to prevent a user from `su`'ing to `named` using a password. In general, there shouldn't be a need for anyone to have to `su` as `named`, and when there is a need, then `sudo` should be used instead, which would not require the account password.

## Impact
Not specified.

## Audit Procedure
Ensure the named account is locked using the following:

```bash
# passwd -S named
named LK 2020-02-11 -1 -1 -1 -1 (Password locked.)
```

The results must have the LK value in the second field, similar to the output shown above.

## Remediation
To remediate, lock the named account using the password command with the lock option as shown below.

```bash
# passwd -l named
Locking password for user named.
passwd: Success
```

## Default Value
Account is locked by default.

## References
None listed.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 16 Account Monitoring and Control | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Privilege Escalation | T1078 Valid Accounts |
| Credential Access | T1110 Brute Force |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
