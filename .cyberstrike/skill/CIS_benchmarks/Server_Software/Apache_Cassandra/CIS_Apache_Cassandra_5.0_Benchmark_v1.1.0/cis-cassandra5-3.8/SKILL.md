---
name: cis-cassandra5-3.8
description: "Review Superuser/Admin Roles"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, linux, database, nosql, access-control, roles]
cis_id: "3.8"
cis_benchmark: "CIS Apache Cassandra 5.0 Benchmark v1.1.0"
tech_stack: [linux, cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Review Superuser/Admin Roles (Manual)

## Profile Applicability

- Level 1 - Cassandra
- Level 1 - Cassandra on Linux

## Description

The `IS_SUPERUSER` privilege found in the `system_auth.roles` table governs who can control the entire Cassandra database and all of its data contained within.

## Rationale

The `IS_SUPERUSER` privilege allows whoever has it to do anything to the data and full administrator rights to the database, including changing passwords, creating, dropping roles. Limiting the accounts that have the `IS_SUPERUSER` role reduces the chances that an attacker can exploit these capabilities.

## Impact

None

## Audit Procedure

Execute the following SQL statement to audit this setting:

```sql
select role, is_superuser from system_auth.roles;
```

Looking for `is_superuser = True`

## Remediation

Perform the following steps to remediate this setting:

Looking at those users from the query that have `is_superuser = True`, decide if that user truly needs that role, if not, for each user, issue the following SQL statement (replace `<role>` with the role name returned from the query):

```sql
alter role <role> with superuser=false;
```

## Default Value

By default, the `cassandra` role has superuser privileges.

## References

None

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br/>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ● | ● | ● |
| v7 | 4.3 Ensure the Use of Dedicated Administrative Accounts<br/>Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities. | ● | ● | ● |
