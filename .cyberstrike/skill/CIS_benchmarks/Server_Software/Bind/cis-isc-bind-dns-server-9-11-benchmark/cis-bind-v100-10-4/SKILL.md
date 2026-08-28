---
name: cis-bind-v100-10-4
description: "Ensure Only the Necessary SELinux Booleans are Enabled (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, selinux]
cis_id: "10.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux, selinux]
cwe_ids: [CWE-732]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 10.4 — Ensure Only the Necessary SELinux Booleans are Enabled

## Profile Applicability

- Caching Only Name Server Level 2
- Authoritative Name Server Level 2

## Description

SELinux booleans allow or disallow specific behaviors. There are two boolean variables specific to the ISC BIND DNS server:

- `named_tcp_bind_http_port` - Allow named to tcp bind http port
- `named_write_master_zones` - Allow named to write master zones

The `named_tcp_bind_http_port` would allow enabling the BIND statistics http channel which is not recommended. The `named_write_master_zones` allows BIND to update the master files, which is necessary when dynamic updates are performed, or the server is automatically maintaining DNSSEC digital signatures.

## Rationale

Enabling only the necessary named related booleans provides a defense in depth approach, that will deny actions that are not in use or expected.

## Impact

Not specified.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

Use `getsebool` to verify the `named_tcp_bind_http_port` boolean has a value of off.

```
# getsebool named_tcp_bind_http_port
named_tcp_bind_http_port --> off
```

The `named_write_master_zones` boolean is not audited as many BIND servers will require the boolean to be enabled.

## Remediation

Perform the following to implement the recommended state:

Disable the SELinux boolean using the `setsebool` command as shown below with the `-P` option to make the change persistent.

```
# setsebool -P named_tcp_bind_http_port off
```

## Default Value

The default value for `named_tcp_bind_http_port` is `off`.

## References

None listed in benchmark.

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic          | Technique             |
| --------------- | --------------------- |
| Defense Evasion | T1562 Impair Defenses |

## Profile

- Level 2 - Authoritative Name Server
- Level 2 - Caching Only Name Server
