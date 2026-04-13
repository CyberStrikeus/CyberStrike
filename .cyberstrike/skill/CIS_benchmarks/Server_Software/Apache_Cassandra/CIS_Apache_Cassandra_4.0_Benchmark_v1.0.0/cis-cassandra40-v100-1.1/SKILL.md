---
name: cis-cassandra40-v100-1.1
description: "Ensure a separate user and group exist for Cassandra"
category: cis-cassandra
version: "1.0.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, user-management]
cis_id: "1.1"
cis_benchmark: "CIS Apache Cassandra 4.0 Benchmark v1.0.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1 Ensure a separate user and group exist for Cassandra

## Profile Applicability
- Level 1 - Cassandra on Linux

## Description
Create separate userid and group for Cassandra.

## Rationale
All processes need to run as a user with least privilege. This mitigates the potential impact of malware to the system.

## Audit
Logon to the server where Cassandra is installed.
To confirm existence of the group, execute the following command:

```bash
$ getent group | grep cassandra
```

To confirm existence of the user, execute the following command:

```bash
$ getent passwd | grep cassandra
```

If either the group or user do not exist, or if the user is not a member of the group, this is a finding.

## Remediation
Create a group for cassandra(if it does not already exist)

```bash
sudo groupadd cassandra
```

Create a user which is only used for running Cassandra and its related processes.

```bash
sudo useradd -m -d /home/cassandra -s /bin/bash -g cassandra -u <USERID_NUMBER> cassandra
```

Replacing `<USERID_NUMBER>` with a number not already used on the server

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
- Level 1 - Cassandra on Linux | Manual
