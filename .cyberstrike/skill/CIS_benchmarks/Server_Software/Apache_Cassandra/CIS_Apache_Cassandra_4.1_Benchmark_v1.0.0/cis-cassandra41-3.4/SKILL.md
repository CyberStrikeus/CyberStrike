---
name: cis-cassandra41-3.4
description: "Ensure that Cassandra is run using a non-privileged, dedicated service account"
category: cis-cassandra
version: "1.0.0"
author: cyberstrike-official
tags: [cis, cassandra, access-control, service-accounts, least-privilege]
cis_id: "3.4"
cis_benchmark: "CIS Apache Cassandra 4.1 Benchmark v1.0.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.4 Ensure that Cassandra is run using a non-privileged, dedicated service account

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description
As with any service installed on a host, it can be provided with its own user context. Providing a dedicated user to the service provides the ability to precisely constrain the service within the larger host context.

## Rationale
Utilizing a non-privileged account for Cassandra to execute as may reduce the impact of a Cassandra-born vulnerability. A restricted account will be unable to access resources unrelated to Cassandra, such as operating system configurations.

## Audit
Execute the following command at a terminal prompt to assess this recommendation:

```bash
ps -ef | egrep "^cassandra.*$"
```

If no lines are returned, then this is a finding.

**NOTE:** It is assumed that the Cassandra user is `cassandra`. Additionally, you may consider running `sudo -l` as the Cassandra user or to check the `sudoers` file.

## Remediation
Create a user which is only used for running Cassandra and directly related processes. This user must not have administrative rights to the system.

## Default Value
No default - depends on installation method.

## References
Not specified in the benchmark.

## CIS Controls
**v8:**
- 3.3 Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.
- 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
  - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

**v7:**
- 4.3 Ensure the Use of Dedicated Administrative Accounts
  - Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.
- 14.6 Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile
- Level 1 | Automated
