---
name: cis-cassandra311-1.5
description: "Ensure the Cassandra service is run as a non-root user"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, linux]
cis_id: "1.5"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5 Ensure the Cassandra service is run as a non-root user

## Profile Applicability
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

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

Replacing <DIRECTORY_WHERE_CASSANDRA_INSTALLED> with the full path of where Cassandra binaries are installed.
Replacing <USERID_NUMBER> with a number not already used on the server

## Default Value
No default user exists for running Cassandra.

## References
Not specified in the benchmark.

## CIS Controls
- v8: 3.3 Configure Data Access Control Lists
- v8: 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
- v7: 4.3 Ensure the Use of Dedicated Administrative Accounts
- v7: 14.6 Protect Information through Access Control Lists

## Profile
- Level 1 | Automated
