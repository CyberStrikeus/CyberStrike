---
name: cis-cassandra5-3.7
description: "Review User-Defined Roles"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, linux, database, nosql, access-control, roles]
cis_id: "3.7"
cis_benchmark: "CIS Apache Cassandra 5.0 Benchmark v1.1.0"
tech_stack: [linux, cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Review User-Defined Roles (Manual)

## Profile Applicability

- Level 1 - Cassandra
- Level 1 - Cassandra on Linux

## Description

The `MEMBER_OF` column found in the `system_auth.roles` table shows roles granted to roles.

## Rationale

The `MEMBER_OF` column shows whoever has roles granted to roles and depending on the role and the privileges grant to the role should be limited. Limiting the accounts that have the certain roles reduces the chances that an attacker can exploit these capabilities.

## Impact

None

## Audit Procedure

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

By default, only the `cassandra` role exists.

## References

None

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control<br/>Define and maintain role-based access control, through determining and documenting the access rights necessary for each role within the enterprise to successfully carry out its assigned duties. Perform access control reviews of enterprise assets to validate that all privileges are authorized, on a recurring schedule at a minimum annually, or more frequently. |      |      | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.                       | ●    | ●    | ●    |
