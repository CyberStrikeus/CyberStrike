---
name: cis-aws-database-8.4
description: "Ensure Amazon Keyspaces tables have Point-in-Time Recovery (PITR) enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, keyspaces, cassandra, backup, pitr, recovery]
cis_id: "8.4"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-8.1, cis-aws-database-8.2, cis-aws-database-8.3]
prerequisites: []
severity_boost: {}
---

# 8.4 Ensure Amazon Keyspaces tables have Point-in-Time Recovery (PITR) enabled (Manual)

## Description
Ensure that Amazon Keyspaces tables have Point-in-Time Recovery (PITR) enabled. When PITR is enabled, Amazon Keyspaces automatically creates continuous backups of table data, allowing tables to be restored to any point in time within the last 35 days. This protection is applied at the table level and provides defense against accidental writes, deletions, and other data loss scenarios.

## Rationale
Enabling PITR on Amazon Keyspaces tables provides continuous, automatic backup protection without requiring manual snapshot management or impacting table performance or availability. In the event of accidental data corruption, malicious writes, or system failures, PITR allows rapid recovery to any second within the last 35 days, significantly reducing data loss exposure and recovery time.

## Impact
Enabling PITR for Amazon Keyspaces ensures that table data is continuously protected and recoverable to any point within 35 days, providing strong defense against accidental loss and corruption while maintaining full table performance and availability.

## Audit Procedure

### Using AWS CLI
List PITR status for all tables in a keyspace:

```bash
aws keyspaces get-table \
  --keyspace-name <keyspace-name> \
  --table-name <table-name>
```

- If the value of pointInTimeRecovery = DISABLED, this means PITR is turned off

## Expected Result
The `pointInTimeRecovery` value should be `ENABLED` for all tables.

## Remediation

### Using AWS CLI
Enable PITR on a specific table:

```bash
aws keyspaces update-table \
  --keyspace-name <keyspace-name> \
  --table-name <table-name> \
  --point-in-time-recovery status=ENABLED
```

- This command enables PITR on the specified table in the keyspace.
- The change takes effect immediately with no performance impact.

## Default Value
PITR is disabled by default on Amazon Keyspaces tables.

## References
1. https://aws.amazon.com/products/databases/

## CIS Controls
| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 11 Data Recovery | x | x | x |

## Profile
Level 1 | Manual
