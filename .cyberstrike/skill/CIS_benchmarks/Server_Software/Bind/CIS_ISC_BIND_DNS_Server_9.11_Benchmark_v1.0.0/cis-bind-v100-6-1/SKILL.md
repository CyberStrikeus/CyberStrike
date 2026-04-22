---
name: cis-bind-v100-6-1
description: "Hide BIND Version String (Automated)"
category: cis-bind
version: "1.0"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, information-leakage]
cis_id: "6.1"
cis_benchmark: "CIS ISC BIND DNS Server 9.11 Benchmark v1.0.0"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 6.1 — Hide BIND Version String

## Profile Applicability

- Authoritative Name Server Level 1
- Caching Only Name Server Level 1

## Description

BIND includes a built-in zone, `version.bind` which may be queried to get the version of the name server. The version may be set to a value of `none`, to disable reporting of the version information.

## Rationale

Making detailed BIND version information easy to obtain remotely helps attackers automate and target their attacks. The information is not necessary for the health of the server, and should not be disclosed.

## Impact

Not specified in the PDF.

## Audit Procedure

Use the dig command shown below to query the chaos class TXT record on `version.bind`. If there is no output from the command, or if a value of `No Info` or `None` is returned then the configuration is compliant.

```
$ dig @ns1.cisecurity.org version.bind chaos txt | grep '^version.bind.' | grep TXT
version.bind. 0 CH TXT "No Info"

$ dig @ns2.cisecurity.org version.bind chaos txt | grep '^version.bind.' | grep TXT
$
```

## Remediation

Add or modify the version option to have a value of `none` in the BIND global options, as shown below.

```
options {
version "none";
. . .
}
```

## Default Value

Default value returns the current BIND detailed version.

## References

Not specified in the PDF.

## CIS Controls

| Controls Version | Control                                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------- | ---- | ---- | ---- |
| v6               | 9 Limitation and Control of Network Ports, Protocols, and Services           | Y    | Y    | Y    |
| v7               | 13.2 Remove Sensitive Data or Systems Not Regularly Accessed by Organization | N    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic         | Technique                                            |
| -------------- | ---------------------------------------------------- |
| Reconnaissance | T1592.002 - Gather Victim Host Information: Software |
| Discovery      | T1082 - System Information Discovery                 |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
