---
name: cis-cassandra40-v130-3.1
description: "Ensure the cassandra and superuser roles are separate"
category: cis-cassandra
version: "1.3.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, passwords, roles, privileges]
cis_id: "3.1"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.3.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1 Ensure the cassandra and superuser roles are separate

## Profile Applicability

- Level 1 - Cassandra
- Level 1 - Cassandra on Linux

## Description

The default installation of Cassandra includes a superuser role named `cassandra`. This necessitates the creation of a separate role to be the superuser role.

## Rationale

Superuser permissions allow for the creation, deletion, and permission management of other users. Considering the cassandra role is well known it should not be a superuser or one which is used for any administrative tasks.

## Impact

If a separate superuser account is not created and tested for correct functionality prior to removing the superuser role from the `cassandra` account you will no longer be able to perform certain actions, including:

- Create a role with super user status.
- Perform DROP or CREATE USER queries.

## Audit

To verify the configuration, run the following query:

```sql
select role from system_auth.roles where is_superuser= True;
```

If you get an error 2200 [ INVALID QUERY] due to where clause, add "ALLOW FILTERING to end of query so it looks like this:

```sql
select role from system_auth.roles where is_superuser= True ALLOW FILTERING;
```

Looking at the role, verify any show up with is_superuser = True and make sure it is not `cassandra` or any unapproved role. If any are found then, this is a finding.

## Remediation

To remediate a misconfiguration, perform the following steps:

1. Execute the following command:

```sql
create role '<NEW_ROLE_HERE>' with password='<NEW_PASSWORD_HERE>' and login=TRUE and superuser=TRUE ;

grant all permissions on all keyspaces to <NEW_ROLE_HERE>;
```

**Note:** Replace `<NEW_ROLE_HERE>` with the desired role and `<NEW_PASSWORD_HERE>` with a password.

2. Verify the new role is working.
3. Remove the superuser role from the `cassandra` account by executing the following command:

```sql
UPDATE system_auth.roles SET is_superuser=null WHERE role='cassandra';
```

## CIS Controls

**Controls Version v8:**

- 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
  - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

**Controls Version v7:**

- 4.3 Ensure the Use of Dedicated Administrative Accounts
  - Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

## Profile

- Level 1 | Automated
