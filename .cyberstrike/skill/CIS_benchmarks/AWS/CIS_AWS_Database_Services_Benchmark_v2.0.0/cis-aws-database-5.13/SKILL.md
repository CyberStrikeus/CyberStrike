---
name: cis-aws-database-5.13
description: "Ensure ElastiCache has automatic backups enabled"
category: cis-database
version: "2.0.0"
author: cyberstrike-official
tags: [cis, aws, database, elasticache, redis, backup, snapshots, disaster-recovery]
cis_id: "5.13"
cis_benchmark: "CIS AWS Database Services Benchmark v2.0.0"
tech_stack: [aws]
cwe_ids: []
chains_with: [cis-aws-database-5.11, cis-aws-database-5.12]
prerequisites: []
severity_boost: {}
---

# 5.13 Ensure ElastiCache has automatic backups enabled

## Description

Ensure that Amazon ElastiCache clusters that store critical or stateful data have automatic backups enabled with a non-zero retention period. This setting configures ElastiCache to take daily snapshots of caches and retain them for a defined number of days, allowing restoration of data in case of corruption, accidental deletion, or infrastructure failure.

## Rationale

Automatic backups provide a simple and reliable way to recover ElastiCache data without relying solely on application-level safeguards. In the event of node failure, misconfiguration, or data corruption, a recent backup snapshot can be used to create a new cache or replication group, significantly reducing recovery time and impact on dependent applications.

## Impact

Enabling automatic backups for ElastiCache ensures that cache data is regularly captured in snapshots, keeping it protected and readily recoverable in case of accidental deletion, corruption, or node failure. As a result, organizations can quickly recreate cache clusters from recent backups and restore access to the cached data, minimizing downtime and business impact from unexpected data loss events.

## Audit Procedure

### Using AWS CLI

**1. List backup settings for all cache clusters (node-based):**

```bash
aws elasticache describe-cache-clusters \
  --show-cache-node-info \
  --query "CacheClusters[*].{Id:CacheClusterId,Engine:Engine,SnapshotRetentionLimit:SnapshotRetentionLimit}"
```

- SnapshotRetentionLimit > 0 => automatic backups enabled.
- SnapshotRetentionLimit = 0 or null => automatic backups disabled.

**2. List backup settings for all replication groups (Redis/Valkey):**

```bash
aws elasticache describe-replication-groups \
  --query "ReplicationGroups[*].{Id:ReplicationGroupId,Engine:Engine,SnapshotRetentionLimit:SnapshotRetentionLimit}"
```

- Again, treat SnapshotRetentionLimit = 0 as non-compliant for this control.

## Expected Result

All cache clusters and replication groups storing critical data have SnapshotRetentionLimit > 0.

## Remediation

### Using AWS CLI

Enable backups on a replication group (Redis/Valkey):

```bash
aws elasticache modify-replication-group \
  --replication-group-id <replication-group-id> \
  --snapshot-retention-limit 7 \
  --snapshotting-cluster-id <primary-cache-cluster-id> \
  --apply-immediately
```

- replication-group-id is your replication group (e.g., my-redis-rg).
- primary-cache-cluster-id is the cache cluster ID that should be used as the daily snapshot source (often the primary node, like my-redis-rg-001).
- snapshot-retention-limit 7 sets a 7-day retention; choose a value (1-35 days) per your policy.
- Optionally set or adjust --preferred-maintenance-window or a specific --snapshot-window if supported for your engine/version.
- Use --apply-immediately for immediate effect; omit it to apply in the next maintenance window.
- You can find the cluster IDs with:

```bash
aws elasticache describe-cache-clusters \
  --show-cache-node-info \
  --query "CacheClusters[*].{Id:CacheClusterId,ReplicationGroupId:ReplicationGroupId}"
```

## Default Value

By default, SnapshotRetentionLimit is 0 (automatic backups disabled) for ElastiCache clusters.

## References

1. https://aws.amazon.com/products/databases/

## CIS Controls

| Controls Version | Control          | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------- | ---- | ---- | ---- |
| v8               | 11 Data Recovery |      | x    | x    |

## Profile

Level 1 | Manual
