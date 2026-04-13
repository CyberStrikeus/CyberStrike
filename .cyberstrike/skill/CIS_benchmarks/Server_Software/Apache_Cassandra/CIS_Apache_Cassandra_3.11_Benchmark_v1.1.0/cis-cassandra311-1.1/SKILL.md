---
name: cis-cassandra311-1.1
description: "Ensure a separate user and group exist for Cassandra"
category: cis-cassandra
version: "1.1.0"
author: cyberstrike-official
tags: [cis, cassandra, installation, linux]
cis_id: "1.1"
cis_benchmark: "CIS Apache Cassandra 3.11 Benchmark v1.1.0"
tech_stack: [cassandra]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1 Ensure a separate user and group exist for Cassandra

## Profile Applicability
- Level 1 - Cassandra on Linux
- Level 2 - Cassandra on Linux

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

Replacing <USERID_NUMBER> with a number not already used on the server

## Default Value
No default user or group exists for Cassandra in a fresh installation.

## References
Not specified in the benchmark.

## CIS Controls
- v8: 3.3 Configure Data Access Control Lists
- v7: 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts
- v7: 4.3 Ensure the Use of Dedicated Administrative Accounts
- v7: 14.6 Protect Information through Access Control Lists

## Profile
- Level 1 | Manual
