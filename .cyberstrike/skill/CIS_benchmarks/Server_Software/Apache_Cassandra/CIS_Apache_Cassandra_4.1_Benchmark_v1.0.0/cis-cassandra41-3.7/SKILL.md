---
name: cis-cassandra41-3.7
description: "Review User-Defined Roles"
category: cis-cassandra
version: "1.0.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, roles, privileges, review]
cis_id: "3.7"
cis_benchmark: "CIS Apache Cassandra 4.1 Benchmark v1.0.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.7 Review User-Defined Roles

## Profile Applicability

- Level 1 - Cassandra
- Level 1 - Cassandra on Linux

## Description

The `MEMBER_OF` column found in the `system_auth.roles` table shows roles granted to roles.

## Rationale

The `MEMBER_OF` column shows whoever has roles granted to roles and depending on the role and the privileges grant to the role should be limited. Limiting the accounts that have the certain roles reduces the chances that an attacker can exploit these capabilities.

## Audit

Execute the following SQL statement to audit this setting:

```sql
select role, can_login, member_of from system_auth.roles;
```

Looking for `can_login` which tells you that role can log into cassandra and `member_of` is when roles are granted to roles.

## Remediation

Looking at those users from the query that have member_of that is NOT null, decide if that user truly needs that role, if not, for each user, issue the following SQL statement (replace `<is_member>` with the value of `member_of` returned by the query in the audit procedure)

```sql
revoke <is_member> from role;
```

## Default Value

No roles are granted to other roles by default.

## References

Not specified in the benchmark.

## CIS Controls

**v8:**

- 6.8 Define and Maintain Role-Based Access Control
  - Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently.

**v7:**

- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

- Level 1 | Manual
