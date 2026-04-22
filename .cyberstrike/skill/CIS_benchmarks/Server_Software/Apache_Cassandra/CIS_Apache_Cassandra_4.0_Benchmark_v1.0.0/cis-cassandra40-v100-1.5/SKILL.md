---
name: cis-cassandra40-v100-1.5
description: "Ensure the Cassandra service is run as a non-root user"
category: cis-cassandra
version: "1.0.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, privileges]
cis_id: "1.5"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.0.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5 Ensure the Cassandra service is run as a non-root user

## Profile Applicability

- Level 1 - Cassandra on Linux

## Description

Though Cassandra database may be run as root, it should run as another non-root user.

## Rationale

One of the best ways to reduce your exposure to attack is to create a unique, unprivileged user and group for the server application. A best practice is to follow is ensuring processes run with a user with least privilege.

## Audit

Logon to the server where Cassandra is running and run the following command

```bash
ps -aef | grep cassandra | grep java | cut -d' ' -f1
```

This will show who is running the Cassandra binary.
If the user is root or has excessive privileges then this is a finding.

## Remediation

Create a group for cassandra (if it does not already exist)

```bash
sudo groupadd cassandra
```

Create a user which is only used for running Cassandra and its related processes.

Replacing `<DIRECTORY_WHERE_CASSANDRA_INSTALLED>` with the full path of where Cassandra binaries are installed.
Replacing `<USERID_NUMBER>` with a number not already used on the server

```bash
sudo useradd -m -d /home/cassandra -s /bin/bash -g cassandra -u <USERID_NUMBER> cassandra
```

## Default Value

N/A

## References

N/A

## CIS Controls

- **v8 3.3** Configure Data Access Control Lists
  - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.
- **v8 5.4** Restrict Administrator Privileges to Dedicated Administrator Accounts
  - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.
- **v7 4.3** Ensure the Use of Dedicated Administrative Accounts
  - Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.
- **v7 14.6** Protect Information through Access Control Lists
  - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile

- Level 1 - Cassandra on Linux | Automated
