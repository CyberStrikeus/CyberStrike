---
name: cis-aws-database-6.7
description: "Ensure MemoryDB has automatic backups enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, memorydb, redis, backup, snapshot, disaster-recovery]
cis_id: "6.7"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-6.5]
prerequisites: []
severity_boost: {}
---

# 6.7 Ensure MemoryDB has automatic backups enabled (Manual)

## Description

Ensure that Amazon MemoryDB clusters that store critical or stateful data have automatic backups enabled with a non-zero retention period. This setting configures MemoryDB to take snapshots of database and retain them for a defined number of days, allowing restoration of data in case of corruption, accidental deletion, or infrastructure failure.

## Rationale

Automatic backups provide a simple and reliable way to recover MemoryDB data without relying solely on application-level safeguards. In the event of node failure, misconfiguration, or data corruption, a recent backup snapshot can be used to create a new database, significantly reducing recovery time and impact on dependent applications.

## Impact

Enabling automatic backups for MemoryDB ensures that cluster data is regularly captured in snapshots, keeping it protected and readily recoverable in case of accidental deletion, corruption, or node failure. As a result, organizations can quickly recreate clusters from recent backups and restore access to the data, minimizing downtime and business impact from unexpected data loss events.

## Audit Procedure

### Using AWS CLI

List snapshot settings for all MemoryDB clusters:

```bash
aws memorydb describe-clusters \
  --query "Clusters[*].{Name:Name,SnapshotRetentionLimit:SnapshotRetentionLimit}"
```

- SnapshotRetentionLimit > 0 => automatic snapshots enabled.
- SnapshotRetentionLimit = 0 or missing/null => automatic snapshots disabled.

## Expected Result

All MemoryDB clusters should have `SnapshotRetentionLimit` greater than 0, indicating automatic backups are enabled.

## Remediation

### Using AWS CLI

Enable automatic snapshots on a specific cluster:

```bash
aws memorydb update-cluster \
  --cluster-name <cluster-name> \
  --snapshot-retention-limit 7 \
  --snapshot-window "03:00-04:00"
```

- `--snapshot-retention-limit 7` configures a 7-day retention; use a value aligned with your policy (for example 7, 14, or 30 days).
- `--snapshot-window "03:00-04:00"` (optional) sets the daily snapshot window in UTC. Choose an off-peak period to minimize performance impact.
- MemoryDB applies these changes immediately for the cluster configuration.

## Default Value

Amazon MemoryDB for Redis has automatic backups enabled by default with a retention period of 1 day.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------- | ---- | ---- | ---- |
| v8               | 11 Data Recovery |      |      |      |

## Profile

Level 1 | Manual
