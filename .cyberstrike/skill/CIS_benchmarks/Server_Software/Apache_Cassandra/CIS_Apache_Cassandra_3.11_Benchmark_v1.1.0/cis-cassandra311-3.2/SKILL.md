---
name: cis-cassandra311-3.2
description: "Ensure that the default password changed for the cassandra role"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, passwords]
cis_id: "3.2"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2 Ensure that the default password changed for the cassandra role

## Profile Applicability

- Level 1 - Cassandra
- Level 2 - Cassandra
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description

The cassandra role has a default password which must be changed.

## Rationale

Failure to change the default password for the cassandra role may pose a risk to the database in the form of unauthorized access.

## Audit

Connect to Cassandra database to verify whether the cassandra role has default password.

```bash
cqlsh -u cassandra -p cassandra
```

If the connection is successful this is a finding.

## Remediation

Change the password for the casssandra role by issuing the following command:

Where <NEWPASSWORD_HERE> is replaced with the password of your choosing.

## Default Value

```
cassandra
```

## References

1. http://cassandra.apache.org/doc/latest/operating/security.html

## CIS Controls

- v8: 5.2 Use Unique Passwords
- v7: 4.4 Use Unique Passwords

## Profile

- Level 1 | Automated
