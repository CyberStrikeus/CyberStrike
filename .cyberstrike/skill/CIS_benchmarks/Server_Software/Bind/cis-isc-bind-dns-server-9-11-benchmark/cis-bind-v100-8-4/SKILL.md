---
name: cis-bind-v100-8-4
description: "Restrict Access to Zone and Key Signing Keys (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, dnssec]
cis_id: "8.4"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: [CWE-732]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 8.4 — Restrict Access to Zone and Key Signing Keys

## Profile Applicability

- Authoritative Name Server Level 2

## Description

The files and directories for Zone Signing Keys (ZSK) and Key Signing Keys (KSK) should be read-only by the named user, with no access to other.

## Rationale

The named daemon does not require write access to the key files or the directories, Implementing a minimal read-only access provides an additional layer of denfense, so that if the service was exploited, the exploit would not be able to modify signing keys. Likewise restricting read access to the keys will prevent inappropriate disclosure of the private keys.

## Impact

Not specified.

## Audit Procedure

Ensure the KEYDIR variable is set to the top directory or directories that contains all of the key files for all of the authoritative zones. Then perform the following:

```
find $KEYDIR -perm /027 -ls
```

Any files or directories that are not compliant will be listed in the output along with their permissions.

## Remediation

Perform the following:

```
chmod  -R g-w,o-rwX $KEYDIR
```

## Default Value

The BIND signing key files and directory do not exist by default.

## References

None listed in benchmark.

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v7               | 14.6 Protect Information through Access Control Lists | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                   |
| ----------------- | --------------------------- |
| Credential Access | T1552 Unsecured Credentials |

## Profile

- Level 2 - Authoritative Name Server
