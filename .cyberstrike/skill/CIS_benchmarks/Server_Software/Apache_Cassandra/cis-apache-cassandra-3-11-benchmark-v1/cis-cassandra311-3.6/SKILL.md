---
name: cis-cassandra311-3.6
description: "Review User-Defined Roles"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, roles, privileges]
cis_id: "3.6"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.6 Review User-Defined Roles

## Profile Applicability

- Level 1 - Cassandra
- Level 2 - Cassandra
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description

The MEMBER_OF column found in the system_auth.roles table shows roles granted to roles.

## Rationale

The MEMBER_OF column shows whoever has roles granted to roles and depending on the role and the privileges grant to the role should be limited . Limiting the accounts that have the certain roles reduces the chances that an attacker can exploit these capabilities.

## Audit

Execute the following SQL statement to audit this setting:

```sql
select role, can_login, member_of from system_auth.roles;
```

Looking for can_login which tells you that role can log into cassandra and member_of is when roles are granted to roles.

## Remediation

Looking at those users from the query that have member_of that is NOT null, decide if that user truly needs that role, if not, for each user, issue the following SQL statement (replace <is_member> with the value of member_of returned by the query in the audit procedure)

## Default Value

No roles are granted to other roles by default.

## References

Not specified in the benchmark.

## CIS Controls

- v8: 16.11 Leverage Vetted Modules or Services for Application Security Components
- v7: 14.7 Enforce Access Control to Data through Automated Tools

## Profile

- Level 1 | Manual
