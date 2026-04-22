---
name: cis-bind9-v301-2-2
description: "Give the BIND User Account an Invalid Shell (Automated)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.2 — Give the BIND User Account an Invalid Shell

## Profile Applicability
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description
The BIND user account, named by default, must not be used as a regular login account, and should be assigned an invalid or `nologin` shell to ensure that the account cannot be used to login.

## Rationale
Service accounts such as the `named` account represent a risk if they can be used to get a login shell to the system.

## Impact
Not Applicable

## Audit Procedure
Check the `named` login shell in the `/etc/passwd` file:

```bash
# grep named /etc/passwd
named:x:25:25:Named:/var/named:/sbin/nologin
```

The named account shell must be `/sbin/nologin` or `/dev/null` similar to the entry shown.

## Remediation
Change the named account to use the `nologin` shell as shown:

```bash
# chsh -s /sbin/nologin named
```

## Default Value
/sbin/nologin

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
