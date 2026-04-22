---
name: cis-bind9-v301-6-1
description: "Hide BIND Version String (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, information-leakage]
cis_id: "6.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 6.1 — Hide BIND Version String

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

BIND includes a built-in zone, `version.bind` which may be queried to get the version of the name server. The version may be set to a value of `none`, to disable reporting of the version information.

## Rationale

Making detailed BIND version information easy to obtain remotely helps attackers automate and target their attacks. The information is not necessary for the health of the server, and should not be disclosed.

## Impact

None noted.

## Audit Procedure

Use the dig command shown below to query the chaos class TXT record on `version.bind`. If there is no output from the command, or if a value of `No Info` or `None` is returned then the configuration is compliant.

```bash
$ dig @ns1.cisecurity.org version.bind chaos txt | grep '^version.bind.' | grep TXT
version.bind. 0 CH TXT "No Info"

$ dig @ns2.cisecurity.org version.bind chaos txt | grep '^version.bind.' | grep TXT
$
```

## Remediation

Add or modify the version option to have a value of `none` in the BIND global options, as shown below.

```
options {
version none;
. . .
}
```

## Default Value

Default value returns the current BIND detailed version.

## References

None listed.

## CIS Controls

| Controls Version | Control                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 9 - Limitation and Control of Network Ports, Protocols, and Services | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                              |
| -------------- | -------------------------------------- |
| Reconnaissance | T1592 - Gather Victim Host Information |
| Reconnaissance | T1592.002 - Software                   |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
