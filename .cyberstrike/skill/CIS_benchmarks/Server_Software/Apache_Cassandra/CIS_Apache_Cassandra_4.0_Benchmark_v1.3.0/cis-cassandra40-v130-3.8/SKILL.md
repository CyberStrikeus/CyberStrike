---
name: cis-cassandra40-v130-3.8
description: "Review Superuser/Admin Roles"
category: cis-cassandra
version: "1.3.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, passwords, roles, privileges]
cis_id: "3.8"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.3.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.8 Review Superuser/Admin Roles

## Profile Applicability

- Level 1 - Cassandra
- Level 1 - Cassandra on Linux

## Description

The `IS_SUPERUSER` privilege found in the `system_auth.roles` table governs who can control the entire Cassandra database and all of its data contained within.

## Rationale

The `IS_SUPERUSER` privilege allows whoever has it to do anything to the data and full administrator rights to the database, including changing passwords, creating, dropping roles. Limiting the accounts that have the `IS_SUPERUSER` role reduces the chances that an attacker can exploit these capabilities.

## Audit

Execute the following SQL statement to audit this setting:

```sql
select role, is_superuser from system_auth.roles;
```

Looking for `is_superuser = True`

## Remediation

Perform the following steps to remediate this setting:

Looking at those users from the query that have `is_superuser = True`, decide if that user truly needs that role, if not, for each user, issue the following SQL statement (replace `<role>` with the role from the query):

```sql
alter role <role> with superuser=false;
```

## CIS Controls

**Controls Version v8:**

- 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
  - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

**Controls Version v7:**

- 4.3 Ensure the Use of Dedicated Administrative Accounts
  - Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

## Profile

- Level 1 | Manual
