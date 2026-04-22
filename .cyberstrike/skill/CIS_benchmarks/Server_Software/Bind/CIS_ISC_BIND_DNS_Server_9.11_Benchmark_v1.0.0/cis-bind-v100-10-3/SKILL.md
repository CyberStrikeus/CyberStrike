---
name: cis-bind-v100-10-3
description: "Ensure the named_t Process Type is Not in Permissive Mode (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, selinux]
cis_id: "10.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux, selinux]
cwe_ids: [CWE-732]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 10.3 — Ensure the named_t Process Type is Not in Permissive Mode

## Profile Applicability
- Caching Only Name Server Level 2
- Authoritative Name Server Level 2

## Description
In addition to setting the entire SELinux configuration in permissive mode, it is possible to set individual process types (domains) such as `named_t` into a permissive mode as well. The permissive mode will not prevent any access or actions, instead, any actions that would have been denied are simply logged.

## Rationale
Usage of the permissive mode is helpful for testing and ensuring that SELinux will not prevent access that is necessary for the proper function of the DNS server. However, inappropriate access will not be prevented in permissive mode by SELinux.

## Impact
Not specified.

## Audit Procedure
Perform the following steps to determine if the recommended state is implemented: Check that the `named_t` process type (domain) is not in permissive mode with the `semodule` command. There should be no output if the type is not set to `permissive`.

```
# semodule -l | grep permissive_named_t
```

## Remediation
Perform the following to implement the recommended state:

If the `named_t` type is in permissive mode; the customized permissive mode should be deleted with the following `semanage` command.

```
# semanage permissive -d named_t
```

## Default Value
The `named_t` type is not in permissive mode by default.

## References
1. https://man7.org/linux/man-pages/man8/semanage-permissive.8.html

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v7 | 14.6 Protect Information through Access Control Lists | Y | Y | Y |

## MITRE ATT&CK Mappings
| Tactic | Technique |
|--------|-----------|
| Defense Evasion | T1562 Impair Defenses |

## Profile
- Level 2 - Authoritative Name Server
- Level 2 - Caching Only Name Server
