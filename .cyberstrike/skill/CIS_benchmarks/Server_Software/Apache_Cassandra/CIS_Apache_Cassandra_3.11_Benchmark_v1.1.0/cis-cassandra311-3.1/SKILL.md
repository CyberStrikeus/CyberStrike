---
name: cis-cassandra311-3.1
description: "Ensure the cassandra and superuser roles are separate"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, roles, privileges]
cis_id: "3.1"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1 Ensure the cassandra and superuser roles are separate

## Profile Applicability
- Level 1 - Cassandra
- Level 2 - Cassandra
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

## Description
The default installation of Cassandra includes a superuser role named cassandra. This necessitates the creation of a separate role to be the superuser role.

## Rationale
Superuser permissions allow for the creation, deletion, and permission management of other users. Considering the cassandra role is well known it should not be a superuser or one which is used for any administrative tasks.

## Impact
The separate account must be created, assigned the superuser role, and tested for correct functionality prior to removing the superuser role from the cassandra account. Otherwise,

## Audit
To verify the configuration, run the following query:

```sql
select role, is_superuser from system_auth.roles;
```

If cassandra or any unapproved role is returned, this is a finding.

## Remediation
To remediate a misconfiguration, perform the following steps:

1. Execute the following command:

Note: Replace <NEW_ROLE_HERE> with the desired role and <NEW_PASSWORD_HERE> with a password.

2. Verify the new role is working.
3. Remove the superuser role from the cassandra account by executing the following command:

```sql
UPDATE system_auth.roles SET is_superuser=null WHERE role='cassandra'
```

## Default Value
The cassandra role is created with superuser privileges by default.

## References
Not specified in the benchmark.

## CIS Controls
- v8: 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
- v7: 4.3 Ensure the Use of Dedicated Administrative Accounts

## Profile
- Level 1 | Automated
