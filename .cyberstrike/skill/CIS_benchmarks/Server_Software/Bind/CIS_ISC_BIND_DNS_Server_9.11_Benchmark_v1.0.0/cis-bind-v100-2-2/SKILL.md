---
name: cis-bind-v100-2-2
description: "Give the BIND User Account an Invalid Shell (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, permissions-ownership]
cis_id: "2.2"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 2.2 — Give the BIND User Account an Invalid Shell

## Profile Applicability
- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description
The BIND user account, named by default, must not be used as a regular login account, and should be assigned an invalid or `nologin` shell to ensure that the account cannot be used to login.

## Rationale
Service accounts such as the `named` account represent a risk if they can be used to get a login shell to the system.

## Impact
Not specified.

## Audit Procedure
Check the `named` login shell in the `/etc/passwd` file:

```bash
# grep named /etc/passwd
named:x:25:25:Named:/var/named:/sbin/nologin
```

The named account shell must be `/sbin/nologin` or `/bin/false` or `/dev/null` similar to the entry shown

## Remediation
Change the named account to use the `nologin` shell as shown:

```bash
# chsh -s /sbin/nologin named
```

## Default Value
/bin/false

## References
None listed.

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v6 | 16 Account Monitoring and Control | Y | Y | Y |
| v7 | 4.7 Limit Access to Script Tools | N | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Persistence | T1136 Create Account |
| Privilege Escalation | T1078 Valid Accounts |

## Profile
- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
