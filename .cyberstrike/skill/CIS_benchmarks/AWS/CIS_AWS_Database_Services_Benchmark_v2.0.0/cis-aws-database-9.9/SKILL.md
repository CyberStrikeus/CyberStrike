---
name: cis-aws-database-9.9
description: "Ensure Neptune Database has automatic backups enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, neptune, graph-database, backup, recovery, pitr]
cis_id: "9.9"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-9.8, cis-aws-database-9.10, cis-aws-database-9.11]
prerequisites: []
severity_boost: {}
---

# 9.9 Ensure Neptune Database has automatic backups enabled (Manual)

## Description

Ensure that Amazon Neptune DB clusters have automated backups enabled with a non-zero backup retention period (for example, 7 to 35 days). Neptune automatically creates continuous, incremental backups of cluster data and retains them for the configured retention period, allowing point-in-time recovery to any second within the backup window.

## Rationale

Enabling automated backups with a sufficient retention period ensures that Neptune cluster data can be quickly recovered to any point within the retention window, protecting against accidental deletions, data corruption, application errors, and infrastructure failures. Neptune backups are continuous and incremental, providing robust disaster recovery and business continuity capabilities with minimal storage overhead.

## Impact

Enabling automated backups for Neptune ensures that cluster data is continuously protected and recoverable to any point within the configured retention period (1-35 days), significantly reducing exposure to data loss and enabling rapid recovery from operational incidents.

## Audit Procedure

### Using AWS CLI

List backup retention status for all Neptune DB clusters:

```bash
aws neptune describe-db-clusters \
  --query "DBClusters[*].{DBClusterIdentifier:DBClusterIdentifier,Engine:Engine,BackupRetentionPeriod:BackupRetentionPeriod}"
```

- BackupRetentionPeriod > 0 => Automated backups are enabled (compliant).
- BackupRetentionPeriod = 0 or missing/null => Automated backups are not enabled (non-compliant).

## Expected Result

All Neptune DB clusters should have `BackupRetentionPeriod` greater than 0 (recommended: 7 or more days).

## Remediation

### Using AWS CLI

Enable automated backups on a specific Neptune cluster:

```bash
aws neptune modify-db-cluster \
  --db-cluster-identifier <cluster-identifier> \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --apply-immediately
```

- `--backup-retention-period 7` sets a 7-day retention; use a value between 1 and 35 days aligned with your policy.
- `--preferred-backup-window "03:00-04:00"` (optional) sets the daily UTC backup window during off-peak hours to minimize performance impact.
- `--apply-immediately` applies the change without waiting for the next maintenance window.

## Default Value

Neptune clusters have a default backup retention period of 1 day.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------- | ---- | ---- | ---- |
| v8               | 11 Data Recovery | x    | x    | x    |

## Profile

Level 1 | Manual
