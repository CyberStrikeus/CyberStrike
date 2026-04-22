---
name: cis-bind9-v301-4-3
description: "Use Unique Keys for Each Pair of Hosts (Scored)"
category: cis-bind
version: "3.0.1"
author: cyberstrike-official
tags: [cis, bind, dns, isc-bind, bind9, tsig]
cis_id: "4.3"
cis_benchmark: "CIS ISC BIND DNS Server 9.9 Benchmark v3.0.1"
tech_stack: [bind, isc-bind, dns, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS 4.3 — Use Unique Keys for Each Pair of Hosts

## Profile Applicability

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server

## Description

A unique TSIG key should be used for each pair of communicating hosts. For example, if there is one master authoritative name server and three slave authoritative name servers that were updated by the master, then there would need to be a unique TSIG key for at least the following:

- Master <-> Slave1
- Master <-> Slave2
- Master <-> Slave3

## Rationale

Each communication channel should have a unique key, to reduce the risk of key disclosure. If one of the TSIG keys or one of the slave servers is compromised, then the remaining TSIG keys are not disclosed.

## Impact

None noted.

## Audit Procedure

To verify each key is unique, and has unique usage, perform the following:

- The sample command below will extract the secret keys from the configuration files and count the number of occurrences of each key value.

```bash
# cat $CONFIG_FILES | egrep -o "secret.*;" | sort | uniq -c
    1 secret "R/eBXL/5xso142dGZSGJixKAAW+bO1UHlIpxZAj92Cc=";
    2 secret "P3/AuCgxdt3buLyeb/QxRmPe9IfMwsXRrKyNvQSbN1k=";
    1 secret "SGNiICKGf86GbhzpDBZOkQ==";
    1 secret "gyxEId4g2gB+pVJSKXA=";
```

The count occurrences preceding each key should be one in the output.

- Search the configuration files for duplicate uses of the same key name. The command below will extract references to key names.

```bash
# egrep "keys +{.+}"  $CONFIG_FILES
named.conf:          allow { 127.0.0.1; } keys { "rndc-key"; };
ns1-ns2.cisecurity.org.key:          keys { "ns1-ns2.cisecurity.org"; };
ns1-ns3.cisecurity.org.key:          keys { "ns1-ns3.cisecurity.org"; };
```

Each key name should be referenced only once.

## Remediation

Generate unique keys for host to host communication. The command below can be used to generate 2 files, and `<name>.key` file and a `<name>.private` file with secret keys of suitable length with base64 encoding. The files themselves are not needed, and should be securely deleted once the values are copied into a key file for including in the named configuration.

```bash
$ dnssec-keygen -a HMAC-SHA256 -b 256 -n HOST ns1-ns2.cisecurity.org
Kns1-ns2.cisecurity.org.+163+13013

$ cat Kns1-ns2.cisecurity.org.+163+13013.key
ns1-ns2.cisecurity.org. IN KEY 512 3 163
9FQ2dYCQ17HJwDi/uHgANh2dlb8M7eb+F4AjML8tTdA=
```

## Default Value

The `rndc` key is automatically generated during package installation.

## References

1. http://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-81-2.pdf

## CIS Controls

| Controls Version | Control                                          | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------ | ---- | ---- | ---- |
| v6               | 14 - Controlled Access Based on the Need to Know | Y    | Y    | Y    |

## MITRE ATT&CK Mappings

| Tactic            | Technique                       |
| ----------------- | ------------------------------- |
| Credential Access | T1552 - Unsecured Credentials   |
| Lateral Movement  | T1557 - Adversary-in-the-Middle |

## Profile

- Level 1 - Authoritative Name Server
- Level 1 - Caching Only Name Server
