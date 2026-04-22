---
name: cis-cassandra311-3.3
description: "Ensure there are no unnecessary roles or excessive privileges"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, roles, privileges]
cis_id: "3.3"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3 Ensure there are no unnecessary roles or excessive privileges

## Profile Applicability

- Level 1 - Cassandra
- Level 2 - Cassandra
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description

Verify each role is require and has only the privileges needed to do its job.

## Rationale

Roles which are unneeded, have super user or other potentially excessive privileges may be an avenue for a hacker to gain access to or modify data in the database.

## Audit

As a superuser, retrieve all roles:

```sql
list roles;
```

Retrieve all permissions for all roles

```sql
select * from system_auth.role_permissions;
```

If there are any unnecessary roles or roles with excessive privileges this is a finding.

## Remediation

Remove any unnecessary roles and/or permissions in accordance with organizational needs.

## Default Value

Only the cassandra role exists by default with superuser privileges.

## References

1. http://cassandra.apache.org/doc/latest/cql/security.html

## CIS Controls

- v8: 6.8 Define and Maintain Role-Based Access Control
- v7: 14.6 Protect Information through Access Control Lists

## Profile

- Level 1 | Manual
